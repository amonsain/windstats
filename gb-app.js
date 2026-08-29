// ═══════════════════════════════════════════════════════════════
//  gb-app.js — Carte Gordon Bennett
//  Trace colorée par altitude, en dégradé continu le long du tracé
// ═══════════════════════════════════════════════════════════════

const GB_CONFIG = {
  // Slug de la course chez YB Tracking (live.gordonbennett.aero embarque
  // le viewer YB). Surchargeable par l'URL : gordonbennett.html?race=gb2024
  race: "gb2026",

  // Snapshot committé par fetch-gb.js (chemin relatif = pas de CORS)
  local_data: "data/gb.json",

  // API YB Tracking — tentée seulement si le snapshot est absent.
  // Échoue en général depuis un navigateur (pas d'en-tête CORS) : c'est
  // normal, fetch-gb.js existe pour ça.
  yb_host: "https://cf.yb.tl",

  // Proxy CORS optionnel, ex. "https://corsproxy.io/?" (laisser vide = désactivé)
  cors_proxy: "",

  // Fond de carte sombre, cohérent avec le thème du dashboard
  tiles: {
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    maxZoom: 19,
  },

  // Rampe séquentielle bleue, une seule teinte, luminosité monotone
  // (bas = sombre, haut = clair — sens « ciel » sur fond sombre).
  // Validée : L monotone, ΔL ≥ 0.06, extrémité sombre à 2.23:1 sur le fond.
  ramp: ["#184f95", "#256abf", "#3987e5", "#6da7ec", "#9ec5f4", "#cde2fb"],

  line_width: 3.2,   // épaisseur du tracé (px)
  halo_width: 2.0,   // liseré sombre sous le tracé (px de chaque côté)
};

// ── Couleur : rampe interpolée en OKLab ────────────────────────
// Interpoler en sRGB ferait apparaître des bandes ternes au milieu ;
// OKLab est perceptuellement uniforme, le dégradé reste régulier.

function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function linearToSrgb(c) {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

function hexToOklab(hex) {
  const r = srgbToLinear(parseInt(hex.slice(1, 3), 16) / 255);
  const g = srgbToLinear(parseInt(hex.slice(3, 5), 16) / 255);
  const b = srgbToLinear(parseInt(hex.slice(5, 7), 16) / 255);

  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ];
}

function oklabToHex(L, A, B) {
  const l = Math.pow(L + 0.3963377774 * A + 0.2158037573 * B, 3);
  const m = Math.pow(L - 0.1055613458 * A - 0.0638541728 * B, 3);
  const s = Math.pow(L - 0.0894841775 * A - 1.2914855480 * B, 3);

  const rgb = [
     4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];

  return "#" + rgb.map(v => {
    const n = Math.round(Math.min(1, Math.max(0, linearToSrgb(v))) * 255);
    return n.toString(16).padStart(2, "0");
  }).join("");
}

/**
 * Précalcule la rampe en 256 pas : colorAt(t∈[0,1]) devient un simple index.
 */
function buildRamp(hexStops) {
  const stops = hexStops.map(hexToOklab);
  const N = 256;
  const lut = new Array(N);

  for (let i = 0; i < N; i++) {
    const p = (i / (N - 1)) * (stops.length - 1);
    const k = Math.min(stops.length - 2, Math.floor(p));
    const f = p - k;
    const a = stops[k], b = stops[k + 1];
    lut[i] = oklabToHex(
      a[0] + (b[0] - a[0]) * f,
      a[1] + (b[1] - a[1]) * f,
      a[2] + (b[2] - a[2]) * f,
    );
  }
  return lut;
}

const RAMP_LUT = buildRamp(GB_CONFIG.ramp);

/** Index 0–255 dans la rampe pour une altitude donnée */
function rampIndex(alt, lo, hi) {
  if (alt == null || !isFinite(alt)) return 0;
  const t = hi > lo ? (alt - lo) / (hi - lo) : 0;
  return Math.max(0, Math.min(255, Math.round(t * 255)));
}

function altColor(alt, lo, hi) {
  return RAMP_LUT[rampIndex(alt, lo, hi)];
}

// ── Helpers ────────────────────────────────────────────────────

const R_EARTH = 6371000;

/** Distance orthodromique en mètres */
function haversine(a, b) {
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLon = (b.lon - a.lon) * toRad;
  const la1 = a.lat * toRad, la2 = b.lat * toRad;
  const h = Math.sin(dLat / 2) ** 2 +
            Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Cap en degrés de a vers b */
function bearing(a, b) {
  const toRad = Math.PI / 180;
  const la1 = a.lat * toRad, la2 = b.lat * toRad;
  const dLon = (b.lon - a.lon) * toRad;
  const y = Math.sin(dLon) * Math.cos(la2);
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLon);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

const DIRS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
              "S", "SSO", "SO", "OSO", "O", "ONO", "NO", "NNO"];

function dirLabel(deg) {
  return DIRS[Math.round(deg / 22.5) % 16];
}

/** Échappe une chaîne destinée à de l'innerHTML (noms de trace, slug d'URL…) */
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function fmtAlt(m) {
  return m == null || !isFinite(m) ? "—" : Math.round(m).toLocaleString("fr-FR") + " m";
}

function fmtKm(m) {
  return (m / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 }) + " km";
}

function fmtDur(sec) {
  if (sec == null || !isFinite(sec)) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h + "h" + String(m).padStart(2, "0");
}

function fmtTime(tSec) {
  if (tSec == null || !isFinite(tSec)) return "—";
  const d = new Date(tSec * 1000);
  if (isNaN(d)) return "—";
  return d.toLocaleString("fr-FR", {
    timeZone: "UTC", day: "2-digit", month: "2-digit",
    hour: "2-digit", minute: "2-digit",
  }) + " UTC";
}

// ═══════════════════════════════════════════════════════════════
//  Lecture des traces
//  Formats : gb.json (interne), GeoJSON, GPX, IGC, KML
// ═══════════════════════════════════════════════════════════════

/** Nettoie et complète une liste de points bruts */
function finalizeTrack(id, name, pts, extra = {}) {
  const points = pts.filter(p => isFinite(p.lat) && isFinite(p.lon) &&
                                 Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180);

  if (points.length < 2) return null;

  // Trier chronologiquement — mais seulement si TOUS les points sont datés :
  // un comparateur qui renvoie NaN mélangerait l'ordre du fichier.
  if (points.every(p => isFinite(p.t))) points.sort((a, b) => a.t - b.t);

  // Altitudes manquantes : interpolation linéaire entre voisins connus
  const known = points.map((p, i) => (isFinite(p.alt) ? i : -1)).filter(i => i >= 0);
  if (known.length === 0) {
    points.forEach(p => { p.alt = 0; });
  } else {
    for (let i = 0; i < points.length; i++) {
      if (isFinite(points[i].alt)) continue;
      const prev = known.filter(k => k < i).pop();
      const next = known.find(k => k > i);
      if (prev == null && next != null)      points[i].alt = points[next].alt;
      else if (next == null && prev != null) points[i].alt = points[prev].alt;
      else if (prev != null && next != null) {
        const f = (i - prev) / (next - prev);
        points[i].alt = points[prev].alt + (points[next].alt - points[prev].alt) * f;
      }
    }
  }

  // Cumuls
  let dist = 0, altMin = Infinity, altMax = -Infinity;
  points[0].d = 0;
  for (let i = 0; i < points.length; i++) {
    if (i > 0) {
      dist += haversine(points[i - 1], points[i]);
      points[i].d = dist;
    }
    if (points[i].alt < altMin) altMin = points[i].alt;
    if (points[i].alt > altMax) altMax = points[i].alt;
  }

  const t0 = points[0].t, t1 = points[points.length - 1].t;
  const hasTime = isFinite(t0) && isFinite(t1) && t1 > t0;

  return {
    id, name,
    subtitle: extra.subtitle || "",
    points,
    visible: true,
    stats: {
      n: points.length,
      dist,
      altMin, altMax,
      t0: hasTime ? t0 : null,
      t1: hasTime ? t1 : null,
      duration: hasTime ? t1 - t0 : null,
      // Distance à vol d'oiseau départ → dernier point (le score Gordon Bennett)
      direct: haversine(points[0], points[points.length - 1]),
    },
  };
}

// ── Format interne (data/gb.json) ──────────────────────────────

function parseInternal(obj) {
  if (!obj || !Array.isArray(obj.tracks)) return null;
  const tracks = [];

  obj.tracks.forEach((t, i) => {
    const pts = (t.points || []).map(p => Array.isArray(p)
      ? { lat: +p[0], lon: +p[1], alt: +p[2], t: +p[3] }
      : { lat: +p.lat, lon: +p.lon, alt: +p.alt, t: +p.t });
    const tr = finalizeTrack(t.id || "t" + i, t.name || t.id || "Trace " + (i + 1), pts,
                             { subtitle: t.pilots || t.country || "" });
    if (tr) tracks.push(tr);
  });

  return tracks.length ? { name: obj.name || "", updated: obj.updated || null, tracks } : null;
}

// ── GeoJSON ────────────────────────────────────────────────────

function parseGeoJSON(obj, fallbackName) {
  const feats = obj.type === "FeatureCollection" ? obj.features
              : obj.type === "Feature"           ? [obj]
              : [{ type: "Feature", geometry: obj, properties: {} }];
  const tracks = [];

  feats.forEach((f, i) => {
    if (!f || !f.geometry) return;
    const props = f.properties || {};
    const lines = f.geometry.type === "LineString"      ? [f.geometry.coordinates]
                : f.geometry.type === "MultiLineString" ? f.geometry.coordinates
                : [];
    // coordTimes : convention Google/Strava pour horodater une LineString
    const times = props.coordTimes || props.coordinateProperties?.times || null;

    lines.forEach((coords, j) => {
      const pts = coords.map((c, k) => {
        const raw = Array.isArray(times) ? (Array.isArray(times[j]) ? times[j][k] : times[k]) : null;
        return { lon: +c[0], lat: +c[1], alt: +c[2], t: raw ? Date.parse(raw) / 1000 : NaN };
      });
      const name = props.name || props.title || fallbackName || "Trace";
      const tr = finalizeTrack(`geo-${i}-${j}`, lines.length > 1 ? `${name} #${j + 1}` : name, pts);
      if (tr) tracks.push(tr);
    });
  });

  return tracks.length ? { name: fallbackName || "", updated: null, tracks } : null;
}

// ── GPX ────────────────────────────────────────────────────────

function parseGPX(text, fallbackName) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror")) return null;

  const tracks = [];
  const segs = [];

  doc.querySelectorAll("trk").forEach(trk => {
    const name = trk.querySelector("name")?.textContent?.trim();
    trk.querySelectorAll("trkseg").forEach(seg => segs.push({ name, nodes: seg.querySelectorAll("trkpt") }));
  });
  // Routes, et traces sans <trkseg>
  doc.querySelectorAll("rte").forEach(rte => {
    segs.push({ name: rte.querySelector("name")?.textContent?.trim(), nodes: rte.querySelectorAll("rtept") });
  });
  if (segs.length === 0) {
    const all = doc.querySelectorAll("trkpt");
    if (all.length) segs.push({ name: null, nodes: all });
  }

  segs.forEach((seg, i) => {
    const pts = Array.from(seg.nodes).map(n => {
      const timeTxt = n.querySelector("time")?.textContent;
      return {
        lat: parseFloat(n.getAttribute("lat")),
        lon: parseFloat(n.getAttribute("lon")),
        alt: parseFloat(n.querySelector("ele")?.textContent ?? "NaN"),
        t: timeTxt ? Date.parse(timeTxt) / 1000 : NaN,
      };
    });
    const base = seg.name || fallbackName || "Trace GPX";
    const tr = finalizeTrack("gpx-" + i, segs.length > 1 ? `${base} #${i + 1}` : base, pts);
    if (tr) tracks.push(tr);
  });

  return tracks.length ? { name: fallbackName || "", updated: null, tracks } : null;
}

// ── IGC ────────────────────────────────────────────────────────

function parseIGC(text, fallbackName) {
  let dayMs = null, pilot = "", glider = "";
  const pts = [];
  let prevSec = -1, rollover = 0;

  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("HFDTE")) {
      const m = line.match(/(\d{2})(\d{2})(\d{2})/);
      if (m) {
        const yy = +m[3];
        dayMs = Date.UTC(yy + (yy < 80 ? 2000 : 1900), +m[2] - 1, +m[1]);
      }
      continue;
    }
    if (line.startsWith("HFPLT")) { pilot  = line.split(":").pop().trim(); continue; }
    if (line.startsWith("HFGTY")) { glider = line.split(":").pop().trim(); continue; }
    if (line[0] !== "B" || line.length < 35) continue;

    const sec = +line.slice(1, 3) * 3600 + +line.slice(3, 5) * 60 + +line.slice(5, 7);
    if (!isFinite(sec)) continue;
    if (prevSec >= 0 && sec < prevSec - 3600) rollover += 86400; // passage de minuit
    prevSec = sec;

    const lat = +line.slice(7, 9)   + +line.slice(9, 14)  / 60000;
    const lon = +line.slice(15, 18) + +line.slice(18, 23) / 60000;
    const baro = +line.slice(25, 30);
    const gnss = +line.slice(30, 35);

    pts.push({
      lat: line[14] === "S" ? -lat : lat,
      lon: line[23] === "W" ? -lon : lon,
      // L'altitude GNSS est la référence ; le baro sert de secours (0 = non calibré)
      alt: isFinite(gnss) && gnss !== 0 ? gnss : baro,
      t: (dayMs != null ? dayMs / 1000 : 0) + sec + rollover,
    });
  }

  // Le pilote nomme mieux la trace que le nom de fichier
  const name = pilot || fallbackName || "Trace IGC";
  const tr = finalizeTrack("igc-0", name, pts,
                           { subtitle: [glider, pilot ? fallbackName : null].filter(Boolean).join(" · ") });
  return tr ? { name, updated: null, tracks: [tr] } : null;
}

// ── KML (LineString et gx:Track) ───────────────────────────────

function parseKML(text, fallbackName) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror")) return null;

  const tracks = [];

  Array.from(doc.getElementsByTagName("Placemark")).forEach((pm, i) => {
    const name = pm.getElementsByTagName("name")[0]?.textContent?.trim()
              || fallbackName || "Trace KML";
    let pts = [];

    // gx:Track — <when> + <gx:coord>lon lat alt</gx:coord>
    const whens  = Array.from(pm.getElementsByTagName("when"));
    const coords = Array.from(pm.getElementsByTagName("gx:coord"))
      .concat(Array.from(pm.getElementsByTagName("coord")));

    if (coords.length) {
      pts = coords.map((c, k) => {
        const [lon, lat, alt] = c.textContent.trim().split(/\s+/).map(Number);
        const w = whens[k]?.textContent;
        return { lat, lon, alt, t: w ? Date.parse(w) / 1000 : NaN };
      });
    } else {
      const cs = pm.getElementsByTagName("coordinates")[0];
      if (!cs) return;
      pts = cs.textContent.trim().split(/\s+/).map(tuple => {
        const [lon, lat, alt] = tuple.split(",").map(Number);
        return { lat, lon, alt, t: NaN };
      });
    }

    const tr = finalizeTrack("kml-" + i, name, pts);
    if (tr) tracks.push(tr);
  });

  return tracks.length ? { name: fallbackName || "", updated: null, tracks } : null;
}

// ── Extraction tolérante d'un JSON inconnu (réponses YB) ───────
// Le format exact des endpoints YB n'est pas documenté publiquement :
// plutôt que de coder en dur une structure, on parcourt l'objet et on
// reconnaît tout tableau de points portant lat/lon.

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
  if (v == null) return NaN;
  if (typeof v === "number") return v > 1e11 ? v / 1000 : v; // ms ou s
  const p = Date.parse(v);
  return isNaN(p) ? NaN : p / 1000;
}

function looksLikePoint(o) {
  return o && typeof o === "object" &&
         isFinite(+pick(o, KEYS.lat)) && isFinite(+pick(o, KEYS.lon));
}

function toPoint(o) {
  return {
    lat: +pick(o, KEYS.lat),
    lon: +pick(o, KEYS.lon),
    alt: +pick(o, KEYS.alt),
    t: toEpochSec(pick(o, KEYS.t)),
  };
}

/**
 * Cherche récursivement les séries de points dans un JSON quelconque.
 * Retourne [{ name, points }] — un groupe par tableau trouvé.
 */
function harvestSeries(node, label, out = [], depth = 0) {
  if (depth > 6 || node == null || typeof node !== "object") return out;

  if (Array.isArray(node)) {
    const pts = node.filter(looksLikePoint);
    if (pts.length >= 2 && pts.length / node.length > 0.5) {
      out.push({ name: label, points: pts.map(toPoint) });
      return out;
    }
    node.forEach((child, i) => {
      const childLabel = (child && typeof child === "object" &&
        (child.name || child.teamName || child.title || child.id)) || `${label} ${i + 1}`;
      harvestSeries(child, String(childLabel), out, depth + 1);
    });
    return out;
  }

  const own = node.name || node.teamName || node.title || label;
  for (const [k, v] of Object.entries(node)) {
    if (v && typeof v === "object") harvestSeries(v, String(own), out, depth + 1);
  }
  return out;
}

function parseUnknownJSON(obj, fallbackName) {
  const internal = parseInternal(obj);
  if (internal) return internal;
  if (obj && (obj.type === "FeatureCollection" || obj.type === "Feature" ||
              obj.type === "LineString" || obj.type === "MultiLineString")) {
    return parseGeoJSON(obj, fallbackName);
  }

  const series = harvestSeries(obj, fallbackName || "Trace");
  const tracks = [];
  series.forEach((s, i) => {
    const tr = finalizeTrack("json-" + i, s.name || "Trace " + (i + 1), s.points);
    if (tr) tracks.push(tr);
  });
  return tracks.length ? { name: fallbackName || "", updated: null, tracks } : null;
}

/** Aiguillage sur l'extension / le contenu */
function parseAny(text, filename = "") {
  const ext = filename.toLowerCase().split(".").pop();
  const base = filename.replace(/\.[^.]+$/, "") || null;
  const head = text.slice(0, 400).trim();

  if (ext === "igc" || /^A[A-Z]{3}/.test(head) || /^HFDTE/m.test(head)) return parseIGC(text, base);
  if (ext === "gpx" || head.includes("<gpx")) return parseGPX(text, base);
  if (ext === "kml" || head.includes("<kml")) return parseKML(text, base);

  try {
    return parseUnknownJSON(JSON.parse(text), base);
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
//  Couche Leaflet : trace en dégradé d'altitude
//  Un canvas unique, un dégradé linéaire par segment → la couleur
//  varie en continu LE LONG du tracé, pas une couleur par trace.
// ═══════════════════════════════════════════════════════════════

const AltitudeTrackLayer = L.Layer.extend({

  initialize(options) {
    L.setOptions(this, options);
    this._tracks = [];
    this._range = [0, 1];
    this._hits = [];        // index plat des points dessinés, pour le survol
    this._focus = null;     // id de la trace mise en avant
    this._marker = null;    // point surligné (survol du profil)
  },

  onAdd(map) {
    this._map = map;

    const canvas = this._canvas = L.DomUtil.create("canvas", "gb-canvas");
    canvas.style.position = "absolute";
    canvas.style.pointerEvents = "none";
    map.getPanes().overlayPane.appendChild(canvas);
    this._ctx = canvas.getContext("2d");

    map.on("moveend zoomend resize", this._reset, this);
    if (map.options.zoomAnimation && L.Browser.any3d) map.on("zoomanim", this._animateZoom, this);

    this._reset();
  },

  onRemove(map) {
    map.off("moveend zoomend resize", this._reset, this);
    map.off("zoomanim", this._animateZoom, this);
    L.DomUtil.remove(this._canvas);
  },

  // _reset() redimensionne le canvas : réservé aux changements de vue.
  // Un changement de données ne demande qu'un redessin.
  _redraw() { if (this._map) this._draw(); },

  setTracks(tracks) { this._tracks = tracks; this._redraw(); },
  setRange(lo, hi)  { this._range = [lo, hi]; this._redraw(); },
  setFocus(id)      { this._focus = id; this._redraw(); },
  setMarker(pt)     { this._marker = pt; this._redraw(); },

  _animateZoom(e) {
    const scale  = this._map.getZoomScale(e.zoom, this._map.getZoom());
    const offset = this._map._latLngToNewLayerPoint(
      this._map.containerPointToLatLng([0, 0]), e.zoom, e.center);
    L.DomUtil.setTransform(this._canvas, offset, scale);
  },

  _reset() {
    if (!this._map) return;

    const size = this._map.getSize();
    const dpr  = window.devicePixelRatio || 1;
    const c    = this._canvas;

    L.DomUtil.setTransform(c, this._map.containerPointToLayerPoint([0, 0]), 1);
    c.style.width  = size.x + "px";
    c.style.height = size.y + "px";
    c.width  = Math.round(size.x * dpr);
    c.height = Math.round(size.y * dpr);
    this._ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    this._draw();
  },

  _draw() {
    const map = this._map, ctx = this._ctx;
    const size = map.getSize();
    const [lo, hi] = this._range;

    ctx.clearRect(0, 0, size.x, size.y);
    ctx.lineCap  = "round";
    ctx.lineJoin = "round";

    this._hits = [];

    // Marge : garder les segments qui entrent/sortent du cadre
    const pad = 60;
    const inView = (p) => p.x > -pad && p.x < size.x + pad && p.y > -pad && p.y < size.y + pad;

    const visible = this._tracks.filter(t => t.visible);
    // La trace focalisée passe au-dessus des autres
    const order = visible.slice().sort((a, b) =>
      (a.id === this._focus ? 1 : 0) - (b.id === this._focus ? 1 : 0));

    // 1re passe : les tracés. Les étiquettes viennent après, sinon la
    // trace suivante repasse par-dessus le nom de la précédente.
    const drawn = [];

    for (const tr of order) {
      const dimmed = this._focus && tr.id !== this._focus;
      const width  = GB_CONFIG.line_width * (tr.id === this._focus ? 1.6 : 1);

      // Projection + décimation sous-pixel (on garde le dernier point
      // pour ne pas perdre les portions lentes)
      const proj = [];
      let last = null;
      for (let i = 0; i < tr.points.length; i++) {
        const p  = tr.points[i];
        const pt = map.latLngToContainerPoint([p.lat, p.lon]);
        if (last && i < tr.points.length - 1) {
          const dx = pt.x - last.x, dy = pt.y - last.y;
          if (dx * dx + dy * dy < 4) continue;   // < 2 px : inutile
        }
        const entry = { x: pt.x, y: pt.y, p, i };
        proj.push(entry);
        last = entry;
      }
      if (proj.length < 2) continue;

      ctx.globalAlpha = dimmed ? 0.35 : 1;

      // 1er passage : liseré sombre, pour que la trace tienne sur
      // n'importe quelle tuile (ville claire, neige, mer…)
      ctx.strokeStyle = "rgba(6,9,15,0.75)";
      ctx.lineWidth   = width + GB_CONFIG.halo_width * 2;
      ctx.beginPath();
      let drawing = false;
      for (const e of proj) {
        if (!inView(e)) { drawing = false; continue; }
        if (!drawing) { ctx.moveTo(e.x, e.y); drawing = true; }
        else ctx.lineTo(e.x, e.y);
      }
      ctx.stroke();

      // 2e passage : un dégradé par segment → couleur continue le long du tracé
      ctx.lineWidth = width;
      for (let i = 1; i < proj.length; i++) {
        const a = proj[i - 1], b = proj[i];
        if (!inView(a) && !inView(b)) continue;
        if (a.x === b.x && a.y === b.y) continue;

        const ca = altColor(a.p.alt, lo, hi);
        const cb = altColor(b.p.alt, lo, hi);

        if (ca === cb) {
          ctx.strokeStyle = ca;
        } else {
          const g = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
          g.addColorStop(0, ca);
          g.addColorStop(1, cb);
          ctx.strokeStyle = g;
        }
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }

      // Index de survol
      if (!dimmed) for (const e of proj) if (inView(e)) this._hits.push({ x: e.x, y: e.y, tr, i: e.i });

      drawn.push({ tr, proj, dimmed });
    }

    // 2e passe : départ (anneau creux) et dernière position (disque + nom)
    for (const { tr, proj, dimmed } of drawn) {
      ctx.globalAlpha = dimmed ? 0.4 : 1;
      const first = proj[0], lastPt = proj[proj.length - 1];

      if (inView(first)) {
        ctx.beginPath();
        ctx.arc(first.x, first.y, 4, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(255,255,255,0.75)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      if (inView(lastPt)) {
        ctx.beginPath();
        ctx.arc(lastPt.x, lastPt.y, tr.id === this._focus ? 6 : 4.5, 0, Math.PI * 2);
        ctx.fillStyle = altColor(lastPt.p.alt, lo, hi);
        ctx.fill();
        ctx.strokeStyle = "rgba(6,9,15,0.9)";
        ctx.lineWidth = 2;
        ctx.stroke();

        // L'identité de la trace passe par l'étiquette : la couleur, elle,
        // est déjà prise par l'altitude.
        ctx.font = "500 11px 'DM Mono', monospace";
        const label = tr.name;
        const w = ctx.measureText(label).width;
        ctx.fillStyle = "rgba(6,9,15,0.8)";
        ctx.fillRect(lastPt.x + 9, lastPt.y - 8, w + 8, 16);
        ctx.fillStyle = "#e8eefc";
        ctx.fillText(label, lastPt.x + 13, lastPt.y + 3.5);
      }
    }

    ctx.globalAlpha = 1;

    // Curseur partagé avec le profil altimétrique
    if (this._marker) {
      const pt = map.latLngToContainerPoint([this._marker.lat, this._marker.lon]);
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 7, 0, Math.PI * 2);
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  },

  /** Point dessiné le plus proche de (x, y) en pixels conteneur */
  nearest(x, y, maxPx = 16) {
    let best = null, bestD = maxPx * maxPx;
    for (const h of this._hits) {
      const dx = h.x - x, dy = h.y - y;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = h; }
    }
    return best;
  },
});

// ═══════════════════════════════════════════════════════════════
//  Profil altimétrique — même rampe que la carte
//  Une seule trace à la fois : le titre la nomme, donc pas de légende
//  de série (la couleur, ici, ne dit que l'altitude).
// ═══════════════════════════════════════════════════════════════

const Profile = {
  canvas: null, ctx: null, track: null, range: [0, 1], cursor: null,
  box: null,        // géométrie du tracé, pour le survol
  onHover: null,

  init(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");

    canvas.addEventListener("mousemove", e => {
      const r = canvas.getBoundingClientRect();
      this.hover(e.clientX - r.left);
    });
    canvas.addEventListener("mouseleave", () => this.hover(null));
    canvas.addEventListener("touchmove", e => {
      const r = canvas.getBoundingClientRect();
      this.hover(e.touches[0].clientX - r.left);
    }, { passive: true });
  },

  set(track, range) {
    this.track = track;
    this.range = range;
    this.cursor = null;
    this.draw();
  },

  hover(x) {
    if (!this.track || !this.box) return;
    if (x == null) { this.cursor = null; this.draw(); this.onHover?.(null); return; }

    const { left, w } = this.box;
    const f = Math.max(0, Math.min(1, (x - left) / w));
    const pts = this.track.points;
    const target = this.box.min + f * (this.box.max - this.box.min);

    // Recherche dichotomique sur l'axe X (temps ou distance)
    let lo = 0, hi = pts.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.box.axis(pts[mid]) < target) lo = mid; else hi = mid;
    }
    const i = Math.abs(this.box.axis(pts[lo]) - target) < Math.abs(this.box.axis(pts[hi]) - target) ? lo : hi;

    this.cursor = i;
    this.draw();
    this.onHover?.(pts[i]);
  },

  draw() {
    const cv = this.canvas, ctx = this.ctx;
    if (!cv) return;

    const dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth || 600;
    const H = cv.clientHeight || 150;
    cv.width  = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const tr = this.track;
    if (!tr || tr.points.length < 2) { this.box = null; return; }

    const PAD = { top: 12, right: 12, bottom: 22, left: 48 };
    const w = W - PAD.left - PAD.right;
    const h = H - PAD.top - PAD.bottom;
    if (w <= 0 || h <= 0) { this.box = null; return; }

    const pts = tr.points;
    // Axe X : le temps si la trace est datée, sinon la distance parcourue
    const timed = tr.stats.t0 != null;
    const axis  = timed ? (p => p.t) : (p => p.d);
    const min = axis(pts[0]);
    const max = axis(pts[pts.length - 1]);
    const span = max - min || 1;

    // Axe Y : l'échelle de couleur, pour que profil et carte se lisent ensemble
    const [lo, hi] = this.range;
    const yMin = Math.min(lo, tr.stats.altMin);
    const yMax = Math.max(hi, tr.stats.altMax);
    const ySpan = yMax - yMin || 1;

    const X = v => PAD.left + ((v - min) / span) * w;
    const Y = a => PAD.top + h - ((a - yMin) / ySpan) * h;

    // Grille discrète
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.fillStyle   = "rgba(200,208,224,0.45)";
    ctx.font = "9px 'DM Mono', monospace";
    ctx.lineWidth = 1;
    for (let k = 0; k <= 4; k++) {
      const a = yMin + (k / 4) * ySpan;
      const y = Math.round(Y(a)) + 0.5;
      ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + w, y); ctx.stroke();
      ctx.fillText(Math.round(a).toLocaleString("fr-FR"), 4, y + 3);
    }

    // Aire sous la courbe, très discrète
    ctx.beginPath();
    ctx.moveTo(X(axis(pts[0])), PAD.top + h);
    for (const p of pts) ctx.lineTo(X(axis(p)), Y(p.alt));
    ctx.lineTo(X(axis(pts[pts.length - 1])), PAD.top + h);
    ctx.closePath();
    ctx.fillStyle = "rgba(57,135,229,0.10)";
    ctx.fill();

    // Courbe, colorée par altitude segment par segment
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    for (let i = 1; i < pts.length; i++) {
      const x0 = X(axis(pts[i - 1])), y0 = Y(pts[i - 1].alt);
      const x1 = X(axis(pts[i])),     y1 = Y(pts[i].alt);
      if (Math.abs(x1 - x0) < 0.4 && Math.abs(y1 - y0) < 0.4) continue;

      const ca = altColor(pts[i - 1].alt, lo, hi);
      const cb = altColor(pts[i].alt, lo, hi);
      if (ca === cb) {
        ctx.strokeStyle = ca;
      } else {
        const g = ctx.createLinearGradient(x0, y0, x1, y1);
        g.addColorStop(0, ca); g.addColorStop(1, cb);
        ctx.strokeStyle = g;
      }
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    }

    // Axe X : 3 repères
    ctx.fillStyle = "rgba(200,208,224,0.45)";
    ctx.textAlign = "center";
    for (let k = 0; k <= 2; k++) {
      const v = min + (k / 2) * span;
      const label = timed
        ? new Date(v * 1000).toLocaleTimeString("fr-FR", { timeZone: "UTC", hour: "2-digit", minute: "2-digit" })
        : (v / 1000).toFixed(0) + " km";
      ctx.fillText(label, X(v), H - 6);
    }
    ctx.textAlign = "left";

    this.box = { left: PAD.left, w, min, max, axis };

    // Curseur
    if (this.cursor != null && pts[this.cursor]) {
      const p = pts[this.cursor];
      const x = X(axis(p)), y = Y(p.alt);

      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, PAD.top); ctx.lineTo(x, PAD.top + h); ctx.stroke();

      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fillStyle = altColor(p.alt, lo, hi);
      ctx.fill();
      ctx.strokeStyle = "#090c12";
      ctx.lineWidth = 2;
      ctx.stroke();

      const label = fmtAlt(p.alt);
      ctx.font = "500 11px 'DM Mono', monospace";
      const tw = ctx.measureText(label).width;
      const bx = Math.min(PAD.left + w - tw - 8, Math.max(PAD.left, x - tw / 2 - 4));
      ctx.fillStyle = "rgba(9,12,18,0.9)";
      ctx.fillRect(bx, PAD.top + 2, tw + 8, 16);
      ctx.fillStyle = "#fff";
      ctx.fillText(label, bx + 4, PAD.top + 14);
    }
  },
};

// ═══════════════════════════════════════════════════════════════
//  Chargement des données
// ═══════════════════════════════════════════════════════════════

function raceSlug() {
  return new URLSearchParams(location.search).get("race") || GB_CONFIG.race;
}

function proxied(url) {
  return GB_CONFIG.cors_proxy ? GB_CONFIG.cors_proxy + encodeURIComponent(url) : url;
}

async function fetchJSON(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
}

/**
 * 1. data/gb.json (produit par fetch-gb.js — même origine, jamais de CORS)
 * 2. API YB en direct, au cas où
 * Retourne { data, source } ou lève.
 */
async function loadRace() {
  const race = raceSlug();

  try {
    const obj = await fetchJSON(GB_CONFIG.local_data);
    const data = parseInternal(obj) || parseUnknownJSON(obj, race);
    if (data) return { data, source: GB_CONFIG.local_data };
  } catch { /* pas de snapshot : on tente le direct */ }

  const candidates = [
    `${GB_CONFIG.yb_host}/JSON/${race}/AllPositions3`,
    `${GB_CONFIG.yb_host}/JSON/${race}/LatestPositions3`,
    `${GB_CONFIG.yb_host}/JSON/${race}/RaceSetup`,
  ];

  for (const url of candidates) {
    try {
      const obj = await fetchJSON(proxied(url));
      const data = parseUnknownJSON(obj, race);
      if (data) return { data, source: url };
    } catch { /* endpoint suivant */ }
  }

  throw new Error("no-source");
}

// ═══════════════════════════════════════════════════════════════
//  Application
// ═══════════════════════════════════════════════════════════════

const State = {
  tracks: [],
  meta: { name: "", updated: null, source: "" },
  auto: true,
  lo: 0,
  hi: 1000,
  focus: null,
};

let map, layer, tooltipEl;

const $ = sel => document.querySelector(sel);

/** Bornes d'altitude sur les traces visibles */
function autoRange() {
  const vis = State.tracks.filter(t => t.visible);
  if (!vis.length) return [0, 1000];
  const lo = Math.min(...vis.map(t => t.stats.altMin));
  const hi = Math.max(...vis.map(t => t.stats.altMax));
  if (hi - lo < 50) return [Math.floor(lo) - 25, Math.floor(lo) + 25];
  // Arrondi aux 100 m pour des repères de légende lisibles
  return [Math.floor(lo / 100) * 100, Math.ceil(hi / 100) * 100];
}

function currentRange() {
  return State.auto ? autoRange() : [State.lo, State.hi];
}

function setStatus(html, kind = "info") {
  const el = $("#gb-status");
  el.className = "gb-status " + kind;
  el.innerHTML = html;
  el.style.display = html ? "block" : "none";
}

// ── Légende ────────────────────────────────────────────────────

function renderLegend() {
  const [lo, hi] = currentRange();

  // 12 arrêts suffisent : la LUT est déjà interpolée en OKLab
  const stops = [];
  for (let i = 0; i <= 11; i++) {
    stops.push(`${RAMP_LUT[Math.round((i / 11) * 255)]} ${(i / 11 * 100).toFixed(0)}%`);
  }
  $("#gb-legend-bar").style.background = `linear-gradient(to right, ${stops.join(", ")})`;

  $("#gb-legend-ticks").innerHTML = [0, 0.25, 0.5, 0.75, 1]
    .map(f => `<span>${Math.round(lo + f * (hi - lo)).toLocaleString("fr-FR")}</span>`)
    .join("");

  $("#gb-alt-lo").value = Math.round(lo);
  $("#gb-alt-hi").value = Math.round(hi);
}

// ── Liste des traces ───────────────────────────────────────────

function renderList() {
  const list  = $("#gb-list");
  const empty = $("#gb-empty");

  if (!State.tracks.length) {
    list.innerHTML = "";
    empty.hidden = false;
    empty.innerHTML = "Aucune trace chargée.<br>Dépose un fichier GPX, IGC, KML ou GeoJSON " +
                      "sur la carte, ou lance <code>node fetch-gb.js</code>.";
    return;
  }
  empty.hidden = true;

  list.innerHTML = State.tracks.map(t => `
    <div class="gb-row${t.id === State.focus ? " focus" : ""}" data-id="${t.id}">
      <input type="checkbox" class="gb-check" data-id="${t.id}" ${t.visible ? "checked" : ""}>
      <div class="gb-row-main">
        <div class="gb-row-name">${esc(t.name)}</div>
        ${t.subtitle ? `<div class="gb-row-sub">${esc(t.subtitle)}</div>` : ""}
      </div>
      <div class="gb-row-stats">
        <span title="Altitude max">↑ ${fmtAlt(t.stats.altMax)}</span>
        <span title="Distance à vol d'oiseau">→ ${fmtKm(t.stats.direct)}</span>
        <span title="Durée">⏱ ${fmtDur(t.stats.duration)}</span>
      </div>
    </div>`).join("");

  list.querySelectorAll(".gb-check").forEach(cb => {
    // Le clic doit être stoppé ici : sinon il remonte à la ligne, qui
    // re-render la liste et détruit la case avant l'événement `change`.
    cb.addEventListener("click", e => {
      e.stopPropagation();
      const tr = State.tracks.find(t => t.id === cb.dataset.id);
      tr.visible = cb.checked;
      if (!tr.visible && State.focus === tr.id) State.focus = null;
      refresh();
    });
  });

  list.querySelectorAll(".gb-row").forEach(row => {
    row.addEventListener("click", () => {
      State.focus = State.focus === row.dataset.id ? null : row.dataset.id;
      refresh();
    });
  });
}

// ── Rendu global ───────────────────────────────────────────────

function refresh() {
  const [lo, hi] = currentRange();

  layer.setRange(lo, hi);
  layer.setTracks(State.tracks);
  layer.setFocus(State.focus);

  renderLegend();
  renderList();

  const focused = State.tracks.find(t => t.id === State.focus)
               || State.tracks.find(t => t.visible);

  $("#gb-profile-title").textContent = focused
    ? `Profil altimétrique — ${focused.name}`
    : "Profil altimétrique";
  $("#gb-profile-hint").textContent = State.tracks.length > 1 && !State.focus
    ? "clique une trace dans la liste pour la détailler"
    : "";

  Profile.set(focused || null, [lo, hi]);
}

// ── Survol de la carte ─────────────────────────────────────────

function showTooltip(hit, x, y) {
  if (!hit) { tooltipEl.style.display = "none"; layer.setMarker(null); return; }

  const { tr, i } = hit;
  const p = tr.points[i];
  const prev = tr.points[i - 1] || p;
  const next = tr.points[i + 1] || p;

  let speed = null, vario = null, dir = null;
  const dt = (next.t - prev.t);
  if (isFinite(dt) && dt > 0) {
    speed = haversine(prev, next) / dt * 3.6;          // km/h
    vario = (next.alt - prev.alt) / dt;                // m/s
  }
  if (prev !== next) dir = bearing(prev, next);

  const varioTxt = vario == null ? "" : (Math.abs(vario) < 0.05 ? "0.0" :
                   (vario > 0 ? "+" : "") + vario.toFixed(1));

  tooltipEl.innerHTML = `
    <div class="gb-tip-name">${esc(tr.name)}</div>
    <div class="gb-tip-alt" style="color:${altColor(p.alt, ...currentRange())}">${fmtAlt(p.alt)}</div>
    <div class="gb-tip-line">${fmtTime(p.t)}</div>
    ${speed != null ? `<div class="gb-tip-line">${speed.toFixed(0)} km/h${dir != null ? " · " + dirLabel(dir) : ""} · ${varioTxt} m/s</div>` : ""}
    <div class="gb-tip-line">${fmtKm(p.d)} parcourus</div>`;

  tooltipEl.style.display = "block";
  const box = map.getContainer().getBoundingClientRect();
  const flipX = x + 190 > box.width;
  tooltipEl.style.left = (flipX ? x - 182 : x + 14) + "px";
  tooltipEl.style.top  = Math.min(box.height - 100, y + 12) + "px";
}

// ── Import de fichiers ─────────────────────────────────────────

async function importFiles(files) {
  const added = [];
  const failed = [];

  for (const file of files) {
    const text = await file.text();
    const parsed = parseAny(text, file.name);
    if (parsed) parsed.tracks.forEach((t, k) => {
      t.id = `${file.name}-${k}`;
      added.push(t);
    });
    else failed.push(file.name);
  }

  if (added.length) {
    State.tracks = State.tracks.concat(added);
    State.meta.source = "fichiers importés";
    fitAll();
    refresh();
  }

  setStatus(
    added.length
      ? `${added.length} trace(s) importée(s).` +
        (failed.length ? ` Non reconnu : ${esc(failed.join(", "))}` : "")
      : `Aucune trace lisible dans : ${esc(failed.join(", "))}`,
    added.length ? "ok" : "err");
}

function fitAll() {
  const pts = State.tracks.filter(t => t.visible).flatMap(t => t.points.map(p => [p.lat, p.lon]));
  if (pts.length) map.fitBounds(L.latLngBounds(pts), { padding: [40, 40] });
}

// ── Démarrage ──────────────────────────────────────────────────

async function initGB() {
  map = L.map("gb-map", { preferCanvas: true, worldCopyJump: true })
        .setView([47, 8], 5);
  L.tileLayer(GB_CONFIG.tiles.url, {
    attribution: GB_CONFIG.tiles.attribution,
    maxZoom: GB_CONFIG.tiles.maxZoom,
  }).addTo(map);

  layer = new AltitudeTrackLayer();
  layer.addTo(map);

  tooltipEl = $("#gb-tooltip");
  Profile.init($("#gb-profile"));
  Profile.onHover = p => layer.setMarker(p);

  // Survol de la carte, limité à une recherche par frame
  let pending = null;
  map.getContainer().addEventListener("mousemove", e => {
    const box = map.getContainer().getBoundingClientRect();
    const x = e.clientX - box.left, y = e.clientY - box.top;
    if (pending) return;
    pending = requestAnimationFrame(() => {
      pending = null;
      showTooltip(layer.nearest(x, y), x, y);
    });
  });
  map.getContainer().addEventListener("mouseleave", () => showTooltip(null));

  // Échelle d'altitude
  $("#gb-alt-auto").addEventListener("change", e => {
    State.auto = e.target.checked;
    $("#gb-alt-lo").disabled = State.auto;
    $("#gb-alt-hi").disabled = State.auto;
    refresh();
  });
  ["#gb-alt-lo", "#gb-alt-hi"].forEach(sel => {
    $(sel).addEventListener("change", () => {
      const lo = parseFloat($("#gb-alt-lo").value);
      const hi = parseFloat($("#gb-alt-hi").value);
      if (isFinite(lo) && isFinite(hi) && hi > lo) { State.lo = lo; State.hi = hi; refresh(); }
    });
  });

  $("#gb-fit").addEventListener("click", fitAll);
  $("#gb-file").addEventListener("change", e => importFiles(Array.from(e.target.files)));

  const drop = $("#gb-wrap");
  ["dragenter", "dragover"].forEach(ev => drop.addEventListener(ev, e => {
    e.preventDefault(); drop.classList.add("dragging");
  }));
  ["dragleave", "drop"].forEach(ev => drop.addEventListener(ev, e => {
    e.preventDefault(); drop.classList.remove("dragging");
  }));
  drop.addEventListener("drop", e => {
    if (e.dataTransfer?.files?.length) importFiles(Array.from(e.dataTransfer.files));
  });

  window.addEventListener("resize", () => Profile.draw());

  // Données
  setStatus("Chargement des traces…");
  try {
    const { data, source } = await loadRace();
    State.tracks = data.tracks;
    State.meta = { name: data.name, updated: data.updated, source };
    fitAll();
    refresh();
    setStatus(
      `${data.tracks.length} trace(s) — source : <code>${esc(source)}</code>` +
      (data.updated ? ` · maj ${fmtTime(Date.parse(data.updated) / 1000)}` : ""), "ok");
  } catch {
    refresh();
    setStatus(
      `Pas de données en ligne pour <code>${esc(raceSlug())}</code>. ` +
      `Le viewer YB Tracking n'expose pas d'en-tête CORS : lance ` +
      `<code>node fetch-gb.js ${esc(raceSlug())}</code> pour écrire <code>data/gb.json</code>, ` +
      `ou dépose ici un fichier GPX / IGC / KML / GeoJSON.`, "warn");
  }
}

document.addEventListener("DOMContentLoaded", initGB);
