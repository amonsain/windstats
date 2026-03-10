#!/usr/bin/env node
/**
 * fetch-initial-mf.js
 * Fetch initial des 60 derniers jours pour la station Météo-France.
 * À lancer UNE FOIS en local : node fetch-initial-mf.js
 * Ensuite l'action GitHub prend le relais (incrémental automatique).
 *
 * Prérequis : MF_API_KEY dans l'environnement
 *   export MF_API_KEY=votre_clé
 *   node fetch-initial-mf.js
 *
 * Reprise automatique : si le script est interrompu, relancez-le —
 * il repart depuis le dernier quart d'heure enregistré dans data/31042012.json
 */

const fs   = require('fs');
const path = require('path');
const https = require('https');

// ── Config ──────────────────────────────────────────────────────────────────
const STATION_ID  = '31042012';
const HISTORY_DAYS = 60;
const STEP_MS      = 15 * 60 * 1000;   // 15 min
const WAIT_MS      = 620;               // ~96 req/min, sous le rate limit de 100
const SAVE_EVERY   = 50;                // sauvegarde intermédiaire toutes les N requêtes
const OUTPUT_FILE  = path.join(__dirname, 'data', `${STATION_ID}.json`);
const MF_API_KEY   = process.env.MF_API_KEY;

if (!MF_API_KEY) {
  console.error('❌  MF_API_KEY manquant. Faites : export MF_API_KEY=votre_clé');
  process.exit(1);
}

// ── Helpers ──────────────────────────────────────────────────────────────────
const pad = n => String(n).padStart(2, '0');

function toHourKey(date) {
  // "2026-03-10T14:30"
  const m = Math.floor(date.getUTCMinutes() / 15) * 15;
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth()+1)}-${pad(date.getUTCDate())}` +
         `T${pad(date.getUTCHours())}:${pad(m)}`;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Fetch une mesure MF ──────────────────────────────────────────────────────
function fetchOneMF(date) {
  const iso = date.toISOString().replace(/\.\d+Z$/, 'Z');
  const queryPath = `/public/DPObs/v1/station/infrahoraire-6m` +
                   `?id_station=${STATION_ID}&date=${encodeURIComponent(iso)}&format=json`;

  return new Promise((resolve, reject) => {
    const req = https.get({
      hostname: 'public-api.meteofrance.fr',
      path: queryPath,
      headers: { 'apikey': MF_API_KEY }
    }, res => {
      if (res.statusCode === 429) return reject(new Error('RATE_LIMIT'));
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 100)}`));
        try {
          const data = JSON.parse(body);
          resolve(Array.isArray(data) ? data : (data ? [data] : []));
        } catch (e) {
          reject(new Error(`JSON invalide: ${body.slice(0, 100)}`));
        }
      });
    });
    req.on('error', reject);
  });
}

// ── Agréger une obs MF en format interne ─────────────────────────────────────
function parseObsMF(obs) {
  if (!obs || !obs.validity_time) return null;
  const ff    = parseFloat(obs.ff);     // m/s moy
  const fxi10 = parseFloat(obs.fxi10);  // m/s rafale
  const dd    = parseFloat(obs.dd);     // direction °
  if (isNaN(ff) && isNaN(dd)) return null;

  const date = new Date(obs.validity_time);
  return {
    hour:          toHourKey(date),
    speed_avg:     isNaN(ff)    ? null : Math.round(ff * 3.6 * 10) / 10,
    speed_max_avg: isNaN(ff)    ? null : Math.round(ff * 3.6 * 10) / 10,
    speed_gust:    isNaN(fxi10) ? null : Math.round(fxi10 * 3.6 * 10) / 10,
    heading:       isNaN(dd)    ? null : Math.round(dd),
    n: 1
  };
}

// ── Charger le fichier existant ───────────────────────────────────────────────
function loadExisting() {
  if (fs.existsSync(OUTPUT_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));
    } catch { /* fichier corrompu, on repart de zéro */ }
  }
  return { station_id: STATION_ID, updated: null, hours: [] };
}

// ── Sauvegarder ──────────────────────────────────────────────────────────────
function save(data) {
  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(data, null, 2));
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const now     = new Date();
  const cutoff  = new Date(now.getTime() - HISTORY_DAYS * 24 * 3600 * 1000);

  // Charger l'état existant (reprise)
  const existing = loadExisting();
  const hoursMap = new Map(existing.hours.map(h => [h.hour, h]));

  // Déterminer le point de départ
  let fromDate;
  if (existing.hours.length > 0) {
    const lastHour = existing.hours[existing.hours.length - 1].hour;
    fromDate = new Date(lastHour + ':00Z');
    fromDate = new Date(fromDate.getTime() + STEP_MS);
    console.log(`▶ Reprise depuis ${fromDate.toISOString()} (${existing.hours.length} obs déjà présentes)`);
  } else {
    fromDate = new Date(cutoff);
    // Aligner sur le quart d'heure
    const q = Math.round(fromDate.getUTCMinutes() / 15) * 15;
    fromDate.setUTCMinutes(q, 0, 0);
    console.log(`▶ Fetch complet depuis ${fromDate.toISOString()}`);
  }

  // Estimer le total
  const totalSteps = Math.ceil((now - fromDate) / STEP_MS);
  const estimatedMin = Math.ceil(totalSteps * (WAIT_MS / 1000) / 60);
  console.log(`📊 ~${totalSteps} requêtes à faire (~${estimatedMin} min)`);
  console.log(`💾 Sauvegarde intermédiaire toutes les ${SAVE_EVERY} requêtes\n`);

  let cursor   = new Date(fromDate);
  let count    = 0;
  let added    = 0;
  let errors   = 0;

  while (cursor < now) {
    let obs = null;
    let retries = 0;

    while (retries < 3) {
      try {
        const rows = await fetchOneMF(cursor);
        if (rows.length > 0) obs = parseObsMF(rows[0]);
        break;
      } catch (err) {
        if (err.message === 'RATE_LIMIT') {
          console.warn(`  ⚠ Rate limit, pause 10s...`);
          await sleep(10000);
          retries++;
        } else {
          console.warn(`  ✗ Erreur ${cursor.toISOString()}: ${err.message}`);
          errors++;
          break;
        }
      }
    }

    if (obs && !hoursMap.has(obs.hour)) {
      hoursMap.set(obs.hour, obs);
      added++;
    }

    cursor = new Date(cursor.getTime() + STEP_MS);
    count++;

    // Sauvegarde intermédiaire
    if (count % SAVE_EVERY === 0) {
      const hours = Array.from(hoursMap.values()).sort((a, b) => a.hour < b.hour ? -1 : 1);
      save({ station_id: STATION_ID, updated: new Date().toISOString(), hours });
      const pct = Math.round(count / totalSteps * 100);
      console.log(`  💾 ${count}/${totalSteps} (${pct}%) — ${added} obs ajoutées — ${errors} erreurs`);
    }

    await sleep(WAIT_MS);
  }

  // Sauvegarde finale + élagage 60 jours
  const cutoffKey = `${cutoff.getUTCFullYear()}-${pad(cutoff.getUTCMonth()+1)}-${pad(cutoff.getUTCDate())}T00:00`;
  const hours = Array.from(hoursMap.values())
    .filter(h => h.hour >= cutoffKey)
    .sort((a, b) => a.hour < b.hour ? -1 : 1);

  save({ station_id: STATION_ID, updated: now.toISOString(), hours });

  console.log(`\n✅ Terminé — ${hours.length} obs au total, ${added} nouvelles, ${errors} erreurs`);
  console.log(`📁 Fichier : ${OUTPUT_FILE}`);
  console.log(`\n👉 Pousser sur GitHub :`);
  console.log(`   git add data/${STATION_ID}.json && git commit -m "feat: fetch initial MF" && git push`);
}

main().catch(err => {
  console.error('❌ Erreur fatale:', err);
  process.exit(1);
});
