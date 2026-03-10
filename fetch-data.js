#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
//  fetch-data.js — GitHub Action : récupère les données Pioupiou
//  et MF, met à jour data/{stationId}.json
// ═══════════════════════════════════════════════════════════════

const fs    = require("fs");
const path  = require("path");
const https = require("https");
const http  = require("http");

const DATA_DIR   = path.join(__dirname, "data");
const MF_API_KEY = process.env.MF_API_KEY;
const STEP_MS    = 15 * 60 * 1000;
const MF_WAIT_MS = 620;

// ── Helpers ────────────────────────────────────────────────────

const pad = n => String(n).padStart(2, "0");

function isoDate(d) {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function toHourKey(date) {
  const q = Math.floor(date.getUTCMinutes() / 15) * 15;
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth()+1)}-${pad(date.getUTCDate())}` +
         `T${pad(date.getUTCHours())}:${pad(q)}`;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function httpGetJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === "https:" ? https : http;
    mod.get({ hostname: u.hostname, path: u.pathname + u.search, headers }, res => {
      let body = "";
      res.on("data", c => body += c);
      res.on("end", () => {
        if (res.statusCode === 429) return reject(new Error("RATE_LIMIT"));
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0,100)}`));
        try { resolve(JSON.parse(body)); }
        catch(e) { reject(new Error(`JSON invalide: ${body.slice(0,100)}`)); }
      });
    }).on("error", reject);
  });
}

// ── Pioupiou ───────────────────────────────────────────────────

async function fetchAllPP(stationId, fromDate, toDate) {
  const CHUNK_MS = 30 * 24 * 3600 * 1000;
  let rows = [];
  let cursor = new Date(fromDate);
  while (cursor < toDate) {
    const end = new Date(Math.min(cursor.getTime() + CHUNK_MS, toDate.getTime()));
    const url = `http://api.pioupiou.fr/v1/archive/${stationId}?start=${isoDate(cursor)}&stop=${isoDate(end)}&format=json`;
    console.log(`  GET PP ${url}`);
    const json = await httpGetJson(url);
    rows = rows.concat(json.data || []);
    cursor = end;
    await sleep(500);
  }
  return rows;
}

function aggregatePP(rows) {
  const buckets = {};
  for (const r of rows) {
    const key = toHourKey(new Date(r[0]));
    if (!buckets[key]) buckets[key] = { sum_avg: 0, max_avg: 0, max_gust: 0, headings: [], count: 0 };
    const b = buckets[key];
    b.sum_avg += r[4];
    b.max_avg  = Math.max(b.max_avg, r[4]);
    b.max_gust = Math.max(b.max_gust, r[5]);
    if (r[6] != null) b.headings.push(r[6]);
    b.count++;
  }
  return bucketsToHours(buckets);
}

// ── Météo-France ───────────────────────────────────────────────
// 1 requête par quart d'heure, clé = date du curseur

async function fetchAllMF(stationId, fromDate, toDate) {
  let cursor = new Date(fromDate);
  const q = Math.round(cursor.getUTCMinutes() / 15) * 15;
  cursor.setUTCMinutes(q, 0, 0);

  const results = [];
  let count = 0;

  while (cursor < toDate) {
    let retries = 0;
    while (retries < 3) {
      try {
        const iso = isoDate(cursor);
        const url = `https://public-api.meteofrance.fr/public/DPObs/v1/station/infrahoraire-6m` +
                    `?id_station=${stationId}&date=${encodeURIComponent(iso)}&format=json`;
        const data = await httpGetJson(url, { apikey: MF_API_KEY });
        const rows = Array.isArray(data) ? data : (data ? [data] : []);
        if (rows.length > 0) {
          const obs   = rows[0];
          const ff    = parseFloat(obs.ff);
          const fxi10 = parseFloat(obs.fxi10);
          const dd    = parseFloat(obs.dd);
          if (!isNaN(ff) || !isNaN(dd)) {
            results.push({
              hour:          toHourKey(cursor),
              speed_avg:     isNaN(ff)    ? null : Math.round(ff * 3.6 * 10) / 10,
              speed_max_avg: isNaN(ff)    ? null : Math.round(ff * 3.6 * 10) / 10,
              speed_gust:    isNaN(fxi10) ? null : Math.round(fxi10 * 3.6 * 10) / 10,
              heading:       isNaN(dd)    ? null : Math.round(dd),
              n: 1,
            });
          }
        }
        break;
      } catch(err) {
        if (err.message === "RATE_LIMIT") {
          console.warn("  ⚠ Rate limit MF, pause 10s...");
          await sleep(10000);
          retries++;
        } else {
          console.warn(`  ✗ MF ${cursor.toISOString()}: ${err.message}`);
          break;
        }
      }
    }

    cursor = new Date(cursor.getTime() + STEP_MS);
    count++;
    if (count % 50 === 0) console.log(`  → ${count} req MF, ${results.length} obs`);
    await sleep(MF_WAIT_MS);
  }

  return results;
}

// ── Helpers agrégation ─────────────────────────────────────────

function circularMean(angles) {
  const rad = angles.map(a => a * Math.PI / 180);
  const sin = rad.reduce((s, r) => s + Math.sin(r), 0) / rad.length;
  const cos = rad.reduce((s, r) => s + Math.cos(r), 0) / rad.length;
  return ((Math.atan2(sin, cos) * 180 / Math.PI) + 360) % 360;
}

function bucketsToHours(buckets) {
  return Object.entries(buckets)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([hour, b]) => ({
      hour,
      speed_avg:     Math.round(b.sum_avg / b.count * 10) / 10,
      speed_max_avg: Math.round(b.max_avg * 10) / 10,
      speed_gust:    Math.round(b.max_gust * 10) / 10,
      heading:       b.headings.length ? Math.round(circularMean(b.headings)) : null,
      n: b.count,
    }));
}

// ── Lecture config ─────────────────────────────────────────────

const configRaw = fs.readFileSync(path.join(__dirname, "config.js"), "utf8");
const configStr = configRaw
  .replace(/\/\/.*$/gm, "")
  .replace(/const CONFIG\s*=\s*/, "")
  .replace(/;?\s*$/, "");
const CONFIG = Function(`"use strict"; return (${configStr})`)();

// ── Main ───────────────────────────────────────────────────────

async function main() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
  const now = new Date();

  for (const station of CONFIG.stations) {
    console.log(`\n▶ Station ${station.id} (${station.name})`);
    const filePath = path.join(DATA_DIR, `${station.id}.json`);
    let existing = { station_id: station.id, updated: null, hours: [] };

    if (fs.existsSync(filePath)) {
      try { existing = JSON.parse(fs.readFileSync(filePath, "utf8")); }
      catch(e) { console.warn("  ⚠ Fichier corrompu, repart de zéro"); }
    }

    let fromDate;
    if (existing.hours && existing.hours.length > 0) {
      const lastHour = existing.hours[existing.hours.length - 1].hour;
      fromDate = new Date(lastHour + ":00Z");
      fromDate = new Date(fromDate.getTime() + STEP_MS);
      console.log(`  Reprise depuis ${fromDate.toISOString()}`);
    } else {
      fromDate = new Date(now.getTime() - CONFIG.history_days * 24 * 3600 * 1000);
      console.log(`  Fetch complet depuis ${fromDate.toISOString()}`);
    }

    if (fromDate >= now) {
      console.log("  → Déjà à jour.");
      continue;
    }

    try {
      let newHours;

      if (station.source === "meteofrance") {
        newHours = await fetchAllMF(station.id, fromDate, now);
        console.log(`  → ${newHours.length} quarts d'heure MF`);
      } else {
        const rawRows = await fetchAllPP(station.id, fromDate, now);
        console.log(`  → ${rawRows.length} mesures brutes PP`);
        newHours = aggregatePP(rawRows);
        console.log(`  → ${newHours.length} quarts d'heure agrégés`);
      }

      const hourMap = {};
      for (const h of existing.hours) hourMap[h.hour] = h;
      for (const h of newHours)       hourMap[h.hour] = h;

      const cutoffDate = new Date(now.getTime() - CONFIG.history_days * 24 * 3600 * 1000);
      const cutoff = `${cutoffDate.getUTCFullYear()}-${pad(cutoffDate.getUTCMonth()+1)}-${pad(cutoffDate.getUTCDate())}T00:00`;
      const merged = Object.values(hourMap)
        .filter(h => h.hour >= cutoff)
        .sort((a, b) => a.hour.localeCompare(b.hour));

      fs.writeFileSync(filePath, JSON.stringify({
        station_id: station.id,
        updated: now.toISOString(),
        hours: merged,
      }));
      console.log(`  ✓ ${filePath} (${merged.length} heures)`);

    } catch(err) {
      console.error(`  ✗ Erreur: ${err.message}`);
      process.exit(1);
    }
  }

  console.log("\n✅ Terminé.");
}

main();
