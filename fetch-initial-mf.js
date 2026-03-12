#!/usr/bin/env node
/**
 * fetch-initial-mf.js — Fetch initial 60 jours via DPClim horaire
 * Usage : MF_CLIM_API_KEY=ta_clé node fetch-initial-mf.js
 * Max ~31 jours par commande → tranches de 30 jours
 */

const fs    = require("fs");
const path  = require("path");
const https = require("https");

const STATION_ID      = "31042012";
const HISTORY_DAYS    = 60;
const OUTPUT_FILE     = path.join(__dirname, "data", `${STATION_ID}.json`);
const MF_CLIM_API_KEY = process.env.MF_CLIM_API_KEY;
const MF_HOST         = "public-api.meteofrance.fr";
const STEP_MS         = 15 * 60 * 1000;
const CHUNK_DAYS      = 30;

if (!MF_CLIM_API_KEY) { console.error("❌ MF_CLIM_API_KEY manquant"); process.exit(1); }

const pad = n => String(n).padStart(2, "0");

function toHourKey(date) {
  const q = Math.floor(date.getUTCMinutes() / 15) * 15;
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth()+1)}-${pad(date.getUTCDate())}` +
         `T${pad(date.getUTCHours())}:${pad(q)}`;
}

function alignTo6min(d) {
  const m = Math.floor(d.getUTCMinutes() / 6) * 6;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), m, 0));
}

function isoDate6m(d) {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}` +
         `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:00Z`;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function httpGet(p) {
  return new Promise((resolve, reject) => {
    https.get({ hostname: MF_HOST, path: p, headers: { apikey: MF_CLIM_API_KEY } }, res => {
      let body = "";
      res.on("data", c => body += c);
      res.on("end", () => resolve({ status: res.statusCode, body }));
    }).on("error", reject);
  });
}

function parseMFDate6m(str) {
  const s = str.trim();
  return new Date(Date.UTC(
    parseInt(s.slice(0,4)), parseInt(s.slice(4,6))-1,
    parseInt(s.slice(6,8)), parseInt(s.slice(8,10)),
    parseInt(s.slice(10,12) || "0"), 0
  ));
}

function circularMean(angles) {
  if (!angles.length) return null;
  const rad = angles.map(a => a * Math.PI / 180);
  const sin = rad.reduce((s, r) => s + Math.sin(r), 0) / rad.length;
  const cos = rad.reduce((s, r) => s + Math.cos(r), 0) / rad.length;
  return ((Math.atan2(sin, cos) * 180 / Math.PI) + 360) % 360;
}

function parseCSV(csv) {
  const lines = csv.trim().split("\n");
  if (lines.length < 2) return [];
  const headers = lines[0].split(";");
  const idx = name => headers.indexOf(name);

  const iDate = idx("DATE");
  const iFF   = idx("FF");
  const iFXI  = idx("FXI");
  const iDD   = idx("DD");
  const iT    = idx("T");

  if (iDate === -1) { console.warn("  ⚠ Colonne DATE introuvable"); return []; }

  const buckets = {};
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(";");
    if (!cols[iDate]?.trim()) continue;

    const date = parseMFDate6m(cols[iDate]);
    const key  = toHourKey(date);

    if (!buckets[key]) buckets[key] = { sum_ff: 0, max_ff: 0, max_fxi: 0, dds: [], temps: [], count: 0 };
    const b = buckets[key];

    const ff  = parseFloat((cols[iFF]  || "").replace(",", "."));
    const fxi = parseFloat((cols[iFXI] || "").replace(",", "."));
    const dd  = parseFloat((cols[iDD]  || "").replace(",", "."));
    const t   = parseFloat((cols[iT]   || "").replace(",", "."));

    if (!isNaN(ff))  { b.sum_ff += ff; b.max_ff = Math.max(b.max_ff, ff); }
    if (!isNaN(fxi)) { b.max_fxi = Math.max(b.max_fxi, fxi); }
    if (!isNaN(dd))  { b.dds.push(dd); }
    if (!isNaN(t))   { b.temps.push(t); }
    b.count++;
  }

  return Object.entries(buckets)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([hour, b]) => ({
      hour,
      speed_avg:     b.count ? Math.round(b.sum_ff / b.count * 3.6 * 10) / 10 : null,
      speed_max_avg: Math.round(b.max_ff  * 3.6 * 10) / 10,
      speed_gust:    Math.round(b.max_fxi * 3.6 * 10) / 10,
      heading:       b.dds.length   ? Math.round(circularMean(b.dds)) : null,
      temp:          b.temps.length ? Math.round(b.temps.reduce((a,v)=>a+v,0)/b.temps.length*10)/10 : null,
      n: b.count,
    }));
}

async function commandeEtRecup(fromDate, toDate) {
  console.log(`  ${isoDate6m(fromDate)} → ${isoDate6m(toDate)}`);
  const cmdPath = `/public/DPClim/v1/commande-station/horaire` +
    `?id-station=${STATION_ID}` +
    `&date-deb-periode=${encodeURIComponent(isoDate6m(fromDate))}` +
    `&date-fin-periode=${encodeURIComponent(isoDate6m(toDate))}`;

  const cmd = await httpGet(cmdPath);
  if (cmd.status !== 202) throw new Error(`Commande refusée (${cmd.status}): ${cmd.body}`);

  const idCmde = JSON.parse(cmd.body)?.elaboreProduitAvecDemandeResponse?.return;
  console.log(`  id-cmde: ${idCmde}`);

  const filePath = `/public/DPClim/v1/commande/fichier?id-cmde=${idCmde}`;
  for (let i = 0; i < 60; i++) {
    await sleep(5000);
    const r = await httpGet(filePath);
    process.stdout.write(`  Poll ${i+1}: ${r.status}\r`);
    if (r.status === 201) {
      console.log(`\n  ✅ Fichier prêt (${Math.round(r.body.length/1024)} Ko)`);
      return r.body;
    }
    if (r.status !== 204) throw new Error(`Erreur fichier (${r.status}): ${r.body.slice(0,200)}`);
  }
  throw new Error("Timeout");
}

async function main() {
  const now      = new Date();
  const fromDate = alignTo6min(new Date(now.getTime() - HISTORY_DAYS * 24 * 3600 * 1000));
  const toDate   = alignTo6min(now);

  console.log(`▶ Fetch initial DPClim horaire — Station ${STATION_ID}`);

  const CHUNK_MS = CHUNK_DAYS * 24 * 3600 * 1000;
  let allHours = [];
  let cursor = new Date(fromDate);
  let chunk = 1;

  while (cursor < toDate) {
    const end = new Date(Math.min(cursor.getTime() + CHUNK_MS, toDate.getTime()));
    console.log(`\n📦 Tranche ${chunk++}:`);
    const csv   = await commandeEtRecup(cursor, end);
    const hours = parseCSV(csv);
    console.log(`  → ${hours.length} quarts d'heure`);
    allHours = allHours.concat(hours);
    cursor = end;
  }

  // Dédupliquer et trier
  const map = {};
  for (const h of allHours) map[h.hour] = h;
  const sorted = Object.values(map).sort((a, b) => a.hour.localeCompare(b.hour));

  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify({
    station_id: STATION_ID,
    updated: now.toISOString(),
    hours: sorted,
  }, null, 2));

  console.log(`\n✅ ${sorted.length} quarts d'heure sauvegardés → ${OUTPUT_FILE}`);
  console.log(`\n👉 git add data/${STATION_ID}.json && git commit -m "feat: fetch initial MF 60j" && git push`);
}

main().catch(err => { console.error("❌", err.message); process.exit(1); });
