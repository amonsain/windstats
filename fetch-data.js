#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
//  fetch-data.js — GitHub Action : récupère les données Pioupiou
//  et met à jour data/{stationId}.json
//
//  Logique :
//    - Si le fichier n'existe pas → fetch les 60 derniers jours
//    - Sinon → fetch uniquement depuis la dernière mesure connue
//    - Max 31 jours par requête API (limite Pioupiou)
// ═══════════════════════════════════════════════════════════════

import fs   from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR  = path.join(__dirname, "data");
const API_BASE  = "http://api.pioupiou.fr/v1/archive";
const HISTORY_DAYS = 60;

// ── Helpers ────────────────────────────────────────────────────

function isoDate(d) {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

async function fetchChunk(stationId, start, stop) {
  const url = `${API_BASE}/${stationId}?start=${isoDate(start)}&stop=${isoDate(stop)}&format=json`;
  console.log(`  GET ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API error ${res.status} for station ${stationId}`);
  const json = await res.json();
  return json.data || [];
}

async function fetchAll(stationId, fromDate, toDate) {
  // L'API est limitée à 31 jours par requête → on découpe
  const CHUNK_MS = 30 * 24 * 3600 * 1000;
  let rows = [];
  let cursor = new Date(fromDate);

  while (cursor < toDate) {
    const chunkEnd = new Date(Math.min(cursor.getTime() + CHUNK_MS, toDate.getTime()));
    const chunk = await fetchChunk(stationId, cursor, chunkEnd);
    rows = rows.concat(chunk);
    cursor = chunkEnd;
    // Petit délai pour ne pas marteler l'API
    await new Promise(r => setTimeout(r, 500));
  }
  return rows;
}

// ── Agrégation par quart d'heure ──────────────────────────────
// Pour chaque heure calendaire on calcule :
//   speed_avg_mean, speed_avg_max (= rafale moy max), speed_max (= rafale abs max)
//   heading_mean, count

function aggregateHourly(rows) {
  // rows : [time, lat, lon, speed_min, speed_avg, speed_max, heading, pressure]
  // Agrégation par quart d'heure (granularité 15 min)
  const buckets = {};

  for (const r of rows) {
    const t = new Date(r[0]);
    // Quart d'heure UTC : arrondi vers le bas à 0, 15, 30 ou 45
    const q = Math.floor(t.getUTCMinutes() / 15) * 15;
    const pad = n => String(n).padStart(2, "0");
    const key = `${t.getUTCFullYear()}-${pad(t.getUTCMonth()+1)}-${pad(t.getUTCDate())}T${pad(t.getUTCHours())}:${pad(q)}`;
    // ex: "2026-01-15T14:30"

    if (!buckets[key]) buckets[key] = { sum_avg: 0, max_avg: 0, max_gust: 0, headings: [], count: 0 };
    const b = buckets[key];
    b.sum_avg  += r[4];
    b.max_avg   = Math.max(b.max_avg,  r[4]);
    b.max_gust  = Math.max(b.max_gust, r[5]);
    if (r[6] != null) b.headings.push(r[6]);
    b.count++;
  }

  // Convertir en tableau trié
  return Object.entries(buckets)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([hour, b]) => ({
      hour,                                                // "2026-01-15T14:30"
      speed_avg:     Math.round(b.sum_avg / b.count * 10) / 10,
      speed_max_avg: Math.round(b.max_avg * 10) / 10,
      speed_gust:    Math.round(b.max_gust * 10) / 10,
      heading:       b.headings.length
                       ? Math.round(circularMean(b.headings))
                       : null,
      n: b.count,
    }));
}

// Moyenne circulaire pour les directions
function circularMean(angles) {
  const rad = angles.map(a => a * Math.PI / 180);
  const sinMean = rad.reduce((s, r) => s + Math.sin(r), 0) / rad.length;
  const cosMean = rad.reduce((s, r) => s + Math.cos(r), 0) / rad.length;
  let deg = Math.atan2(sinMean, cosMean) * 180 / Math.PI;
  return (deg + 360) % 360;
}

// ── Main ───────────────────────────────────────────────────────

// Lire CONFIG inline (le fichier config.js utilise const CONFIG = {...})
const configRaw = fs.readFileSync(path.join(__dirname, "config.js"), "utf8");
// Évaluation sécurisée : on extrait juste l'objet JSON-like
// On remplace "const CONFIG = " et le ";" final pour avoir du JSON valide
const configStr = configRaw
  .replace(/\/\/.*$/gm, "")          // strip comments
  .replace(/const CONFIG\s*=\s*/, "")
  .replace(/;?\s*$/, "");
const CONFIG = Function(`"use strict"; return (${configStr})`)();

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

const now = new Date();

for (const station of CONFIG.stations) {
  const filePath = path.join(DATA_DIR, `${station.id}.json`);
  let existing = { station_id: station.id, updated: null, hours: [] };

  if (fs.existsSync(filePath)) {
    try {
      existing = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch(e) {
      console.warn(`  ⚠ Impossible de lire ${filePath}, on repart de zéro`);
    }
  }

  // Déterminer la date de début du fetch
  let fromDate;
  if (existing.hours && existing.hours.length > 0) {
    // On repart de la dernière heure connue
    const lastHour = existing.hours[existing.hours.length - 1].hour;
    fromDate = new Date(lastHour + ":00Z");
    fromDate.setMinutes(fromDate.getMinutes() + 15); // +15min pour ne pas re-fetcher le dernier quart
    console.log(`Station ${station.id}: mise à jour depuis ${fromDate.toISOString()}`);
  } else {
    fromDate = new Date(now.getTime() - CONFIG.history_days * 24 * 3600 * 1000);
    console.log(`Station ${station.id}: fetch complet depuis ${fromDate.toISOString()}`);
  }

  if (fromDate >= now) {
    console.log(`  → Déjà à jour, rien à fetcher.`);
    continue;
  }

  try {
    const rawRows = await fetchAll(station.id, fromDate, now);
    console.log(`  → ${rawRows.length} mesures brutes récupérées`);

    const newHours = aggregateHourly(rawRows);
    console.log(`  → ${newHours.length} heures agrégées`);

    // Fusionner avec l'existant (les nouvelles heures remplacent / complètent)
    const hourMap = {};
    for (const h of existing.hours) hourMap[h.hour] = h;
    for (const h of newHours)       hourMap[h.hour] = h; // écrase si même heure

    // Garder seulement les 60 derniers jours
    const cutoffDate = new Date(now.getTime() - CONFIG.history_days * 24 * 3600 * 1000);
    const pad = n => String(n).padStart(2, "0");
    const cutoff = `${cutoffDate.getUTCFullYear()}-${pad(cutoffDate.getUTCMonth()+1)}-${pad(cutoffDate.getUTCDate())}T00:00`;
    const merged = Object.values(hourMap)
      .filter(h => h.hour >= cutoff)
      .sort((a, b) => a.hour.localeCompare(b.hour));

    const output = {
      station_id: station.id,
      updated: now.toISOString(),
      hours: merged,
    };

    fs.writeFileSync(filePath, JSON.stringify(output));
    console.log(`  ✓ Écrit ${filePath} (${merged.length} heures)`);

  } catch (err) {
    console.error(`  ✗ Erreur station ${station.id}:`, err.message);
    process.exit(1);
  }
}

console.log("\n✅ Terminé.");
