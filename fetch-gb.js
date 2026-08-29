#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
//  fetch-gb.js — Traces Gordon Bennett → data/gb.json
//
//  live.gordonbennett.aero embarque le viewer YB Tracking. Ce viewer
//  sert ses données depuis sa propre origine : un navigateur ne peut pas
//  les lire directement (pas d'en-tête CORS). D'où ce script, côté
//  serveur, qui écrit un instantané que la page lit en local.
//
//  Usage :  node fetch-gb.js [slug]        (défaut : gb2026)
//  Slugs observés : gb2024, gb2017fr, aibf2021, ambc2024…
// ═══════════════════════════════════════════════════════════════

const fs    = require("fs");
const path  = require("path");
const https = require("https");

const RACE     = process.argv[2] || process.env.GB_RACE || "gb2026";
const HOST     = process.env.GB_HOST || "https://cf.yb.tl";
const DATA_DIR = path.join(__dirname, "data");
const OUT      = path.join(DATA_DIR, "gb.json");

// Endpoints connus du viewer YB. Le premier qui rend des points gagne.
const ENDPOINTS = [
  `${HOST}/JSON/${RACE}/AllPositions3`,
  `${HOST}/JSON/${RACE}/LatestPositions3`,
  `${HOST}/JSON/${RACE}/AllPositions`,
  `${HOST}/JSON/${RACE}/RaceSetup`,
];

// ── HTTP ───────────────────────────────────────────────────────

function get(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "windstats/1.0" } }, res => {
      const { statusCode, headers } = res;

      if ([301, 302, 303, 307, 308].includes(statusCode) && headers.location && redirects < 4) {
        res.resume();
        return resolve(get(new URL(headers.location, url).href, redirects + 1));
      }

      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => resolve({
        status: statusCode,
        type: headers["content-type"] || "",
        body: Buffer.concat(chunks),
      }));
    }).on("error", reject);
  });
}

// ── Reconnaissance des points dans un JSON de forme inconnue ───

const KEYS = {
  lat: ["lat", "latitude", "y"],
  lon: ["lon", "lng", "long", "longitude", "x"],
  alt: ["alt", "altitude", "elevation", "ele", "z", "height"],
  t:   ["at", "t", "time", "ts", "timestamp", "utc", "dtf", "date"],
};

function pick(obj, names) {
  for (const k of names) {
    if (obj[k] != null) return obj[k];
    const hit = Object.keys(obj).find(o => o.toLowerCase() === k);
    if (hit && obj[hit] != null) return obj[hit];
  }
  return undefined;
}

function toEpochSec(v) {
  if (v == null) return null;
  if (typeof v === "number") return Math.round(v > 1e11 ? v / 1000 : v);
  const p = Date.parse(v);
  return isNaN(p) ? null : Math.round(p / 1000);
}

const isPoint = o => o && typeof o === "object" &&
  isFinite(+pick(o, KEYS.lat)) && isFinite(+pick(o, KEYS.lon));

function toPoint(o) {
  const alt = +pick(o, KEYS.alt);
  return [
    +(+pick(o, KEYS.lat)).toFixed(5),
    +(+pick(o, KEYS.lon)).toFixed(5),
    isFinite(alt) ? Math.round(alt) : null,
    toEpochSec(pick(o, KEYS.t)),
  ];
}

/** Parcourt le JSON et remonte chaque série de points trouvée */
function harvest(node, label, out = [], depth = 0) {
  if (depth > 6 || node == null || typeof node !== "object") return out;

  if (Array.isArray(node)) {
    const pts = node.filter(isPoint);
    if (pts.length >= 2 && pts.length / node.length > 0.5) {
      out.push({ name: label, points: pts.map(toPoint) });
      return out;
    }
    node.forEach((child, i) => {
      const l = (child && typeof child === "object" &&
                 (child.name || child.teamName || child.title || child.id)) || `${label} ${i + 1}`;
      harvest(child, String(l), out, depth + 1);
    });
    return out;
  }

  const own = node.name || node.teamName || node.title || label;
  for (const v of Object.values(node)) {
    if (v && typeof v === "object") harvest(v, String(own), out, depth + 1);
  }
  return out;
}

// ── Fusion avec l'instantané précédent ─────────────────────────
// L'API peut ne renvoyer qu'une fenêtre glissante : on cumule pour
// garder la trace complète depuis le décollage.

function merge(previous, fresh) {
  const byId = new Map();

  for (const t of (previous?.tracks || [])) byId.set(t.id, { ...t, points: t.points.slice() });

  for (const t of fresh.tracks) {
    const old = byId.get(t.id);
    if (!old) { byId.set(t.id, t); continue; }

    const seen = new Set(old.points.map(p => p[3]));
    const added = t.points.filter(p => p[3] == null || !seen.has(p[3]));
    old.points = old.points.concat(added);
    // Ne trier que si tout est daté, sinon on casserait l'ordre du fichier
    if (old.points.every(p => typeof p[3] === "number")) old.points.sort((a, b) => a[3] - b[3]);
    old.name   = t.name   || old.name;
    old.pilots = t.pilots || old.pilots;
  }

  return [...byId.values()];
}

// ── Main ───────────────────────────────────────────────────────

(async () => {
  console.log(`Course : ${RACE}\n`);

  let series = null, source = null;

  for (const url of ENDPOINTS) {
    process.stdout.write(`→ ${url}\n  `);
    let res;
    try {
      res = await get(url);
    } catch (e) {
      console.log(`échec réseau : ${e.message}`);
      continue;
    }

    if (res.status !== 200) { console.log(`HTTP ${res.status}`); continue; }

    let obj;
    try {
      obj = JSON.parse(res.body.toString("utf8"));
    } catch {
      console.log(`HTTP 200 mais réponse non-JSON (${res.type}, ${res.body.length} o)` +
                  ` — probablement le format binaire YB, non décodé ici`);
      continue;
    }

    const found = harvest(obj, RACE).filter(s => s.points.length >= 2);
    if (!found.length) { console.log("JSON reçu, aucune série de points reconnue"); continue; }

    console.log(`OK — ${found.length} série(s), ${found.reduce((n, s) => n + s.points.length, 0)} points`);
    series = found;
    source = url;
    break;
  }

  if (!series) {
    console.error(
      "\nAucune donnée exploitable.\n" +
      "  • vérifier le slug de la course (ex. `node fetch-gb.js gb2024`)\n" +
      "  • si l'endpoint ne répond qu'en binaire, exporter les traces depuis le\n" +
      "    viewer YB (GPX/KML) et les déposer directement sur gordonbennett.html");
    process.exit(1);
  }

  const fresh = {
    race: RACE,
    name: `Coupe Aéronautique Gordon Bennett — ${RACE}`,
    source,
    updated: new Date().toISOString(),
    tracks: series.map((s, i) => ({
      id: s.name || `t${i}`,
      name: s.name || `Ballon ${i + 1}`,
      points: s.points,
    })),
  };

  let previous = null;
  if (fs.existsSync(OUT)) {
    try { previous = JSON.parse(fs.readFileSync(OUT, "utf8")); } catch { /* instantané illisible */ }
    if (previous && previous.race !== RACE) previous = null;   // autre course : on repart de zéro
  }

  fresh.tracks = merge(previous, fresh);

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(fresh));

  const total = fresh.tracks.reduce((n, t) => n + t.points.length, 0);
  console.log(`\n${OUT}\n  ${fresh.tracks.length} ballon(s), ${total} points, ` +
              `${(fs.statSync(OUT).size / 1024).toFixed(0)} Ko`);
})();
