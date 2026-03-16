// ═══════════════════════════════════════════════════════════════
//  app.js — Moteur d'analyse & rendu
// ═══════════════════════════════════════════════════════════════

// ── Helpers direction ──────────────────────────────────────────

/**
 * Retourne true si `heading` est dans la plage [center ± tolerance]
 * en gérant correctement la bascule 0°/360°
 */
function inDirectionRange(heading, center, tolerance) {
  if (heading == null) return false;
  // Normaliser la différence angulaire dans [-180, 180]
  let diff = ((heading - center) % 360 + 360) % 360;
  if (diff > 180) diff -= 360;
  return Math.abs(diff) <= tolerance;
}

// ── Helpers heure locale ───────────────────────────────────────

/**
 * Parse une clé d'agrégat (format "2026-01-15T14" ou "2026-01-15T14:30") en Date UTC
 */
function parseHourStr(hourStr) {
  // Ajouter ":00Z" si pas de secondes, ":00:00Z" si pas de minutes
  const parts = hourStr.split("T");
  const timeParts = (parts[1] || "").split(":");
  if (timeParts.length === 1) return new Date(hourStr + ":00:00Z"); // ancien format "T14"
  if (timeParts.length === 2) return new Date(hourStr + ":00Z");    // nouveau format "T14:30"
  return new Date(hourStr + "Z");
}

/**
 * Retourne l'heure locale (0–23) d'une string "2026-01-15T14:30" (UTC)
 */
function localHour(hourStr, timezone) {
  const d = parseHourStr(hourStr);
  return parseInt(
    d.toLocaleString("fr-FR", { timeZone: timezone, hour: "numeric", hour12: false })
  );
}

function localDateLabel(hourStr, timezone) {
  const d = parseHourStr(hourStr);
  return d.toLocaleString("fr-FR", {
    timeZone: timezone,
    day: "2-digit", month: "2-digit",
  });
}

function localDayKey(hourStr, timezone) {
  const d = parseHourStr(hourStr);
  return d.toLocaleDateString("fr-FR", {
    timeZone: timezone,
    year: "numeric", month: "2-digit", day: "2-digit",
  }); // "15/01/2026"
}

// ── Détection des épisodes ─────────────────────────────────────

/**
 * Prend le tableau d'heures agrégées + un phénomène de CONFIG
 * Retourne la liste des épisodes détectés
 */
function detectEpisodes(hours, phenomenon, timezone) {
  const { direction, tolerance, speed_avg_min, hours: hourWindow, duration_min, gap_max } = phenomenon;

  // Filtrer les heures qui matchent le phénomène
  const matching = hours.filter(h => {
    const lh = localHour(h.hour, timezone);
    // Contrainte horaire
    if (hourWindow) {
      const [from, to] = hourWindow;
      if (lh < from || lh >= to) return false;
    }
    // Direction
    if (!inDirectionRange(h.heading, direction, tolerance)) return false;
    // Vitesse
    if (h.speed_avg < speed_avg_min) return false;
    return true;
  });

  if (matching.length === 0) return [];

  // Grouper en épisodes contigus — buckets 15 min
  const BUCKET_MIN = 15;
  const episodes = [];
  let current = [matching[0]];

  for (let i = 1; i < matching.length; i++) {
    const prev = parseHourStr(matching[i-1].hour);
    const curr = parseHourStr(matching[i].hour);
    const gapMin = (curr - prev) / 60000;

    if (gapMin <= (gap_max || BUCKET_MIN)) {
      current.push(matching[i]);
    } else {
      episodes.push(current);
      current = [matching[i]];
    }
  }
  episodes.push(current);

  // Calculer les stats de chaque épisode
  return episodes
    .filter(ep => {
      const dMin = ep.length * BUCKET_MIN;
      return dMin >= (duration_min || 0);
    })
    .map(ep => {
      const startH = ep[0].hour;
      const endH   = ep[ep.length - 1].hour;
      const lh     = localHour(startH, timezone);
      const day    = localDayKey(startH, timezone);

      const avgSpeeds  = ep.map(h => h.speed_avg);
      const gustSpeeds = ep.map(h => h.speed_gust);
      const durationH  = Math.round(ep.length * BUCKET_MIN / 60 * 10) / 10;

      return {
        phenomenon:    phenomenon.id,
        day,
        start_hour:    startH,
        end_hour:      endH,
        local_hour_start: lh,
        duration_h:    durationH,
        speed_avg:     avg(avgSpeeds),
        speed_avg_max: Math.max(...avgSpeeds),
        speed_gust_max:Math.max(...gustSpeeds),
        hourly:        ep,
      };
    });
}

function avg(arr) {
  return arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length * 10) / 10 : 0;
}

// ── Stats globales sur les épisodes ───────────────────────────

function computeStats(episodes) {
  if (!episodes.length) return null;

  const starts    = episodes.map(e => e.local_hour_start);
  const durations = episodes.map(e => e.duration_h);
  const avgSp     = episodes.map(e => e.speed_avg);
  const gustSp    = episodes.map(e => e.speed_gust_max);

  return {
    count:           episodes.length,
    start_hour_avg:  avg(starts),
    start_hour_min:  Math.min(...starts),
    start_hour_max:  Math.max(...starts),
    start_hour_dist: distribution(starts, 0, 24),   // histogramme par heure
    duration_avg_h:  avg(durations),
    duration_max_h:  Math.max(...durations),
    speed_avg:       avg(avgSp),
    speed_gust_max:  Math.max(...gustSp),
    speed_avg_max:   Math.max(...avgSp),
  };
}

function distribution(values, min, max) {
  const bins = Array(max - min).fill(0);
  for (const v of values) {
    const i = Math.min(Math.floor(v) - min, bins.length - 1);
    if (i >= 0) bins[i]++;
  }
  return bins;
}

// ── Calendrier des jours ───────────────────────────────────────

/**
 * Construit un objet { "15/01/2026": { brise: ep[], rentree_sud: ep[] }, ... }
 */
function buildCalendar(allEpisodesByPhenomenon) {
  const cal = {};
  for (const [phenId, episodes] of Object.entries(allEpisodesByPhenomenon)) {
    for (const ep of episodes) {
      if (!cal[ep.day]) cal[ep.day] = {};
      if (!cal[ep.day][phenId]) cal[ep.day][phenId] = [];
      cal[ep.day][phenId].push(ep);
    }
  }
  return cal;
}

// ── Chargement des données ─────────────────────────────────────

async function loadStationData(stationId) {
  const url = `./data/${stationId}.json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Données introuvables pour station ${stationId}`);
  return res.json();
}

async function fetchLivePP(stationId) {
  try {
    const res = await fetch(`https://api.pioupiou.fr/v1/live/${stationId}`);
    if (!res.ok) return null;
    const d = await res.json();
    const m = d?.data?.measurements;
    if (!m) return null;
    return {
      time:      d.data.location?.date || m.date,
      speed_avg:  m.wind_speed_avg  != null ? Math.round(m.wind_speed_avg  * 3.6 * 10) / 10 : null,
      speed_gust: m.wind_speed_max  != null ? Math.round(m.wind_speed_max  * 3.6 * 10) / 10 : null,
      heading:    m.wind_heading    != null ? Math.round(m.wind_heading) : null,
      source: "live",
    };
  } catch(e) { return null; }
}

function renderLiveMeasure(live, station) {
  if (!live) return "";
  const age = Math.round((new Date() - new Date(live.time)) / 60000);
  const ageStr = age < 2 ? "à l'instant" : `il y a ${age} min`;
  const liveBtn = station?.live_url
    ? `<a class="lm-live" href="${station.live_url}" target="_blank" onclick="event.stopPropagation()">⚡ live</a>`
    : "";
  return `<div class="last-measure live-fresh">
    <span class="lm-badge">LIVE</span>
    <span class="lm-speed">${live.speed_avg} km/h</span>
    <span class="lm-gust" style="color:#ff6b6b">↑${live.speed_gust} km/h</span>
    <span class="lm-dir">${live.heading}°</span>
    <span class="lm-age">${ageStr}</span>
    ${liveBtn}
  </div>`;
}

// ── Point d'entrée principal ───────────────────────────────────

async function init() {
  const app = document.getElementById("app");

  for (const station of CONFIG.stations) {
    renderStationShell(app, station);

    try {
      const data = await loadStationData(station.id);

      const episodesByPhenomenon = {};
      const statsByPhenomenon    = {};

      for (const ph of station.phenomena) {
        const eps = detectEpisodes(data.hours, ph, CONFIG.timezone);
        episodesByPhenomenon[ph.id] = eps;
        statsByPhenomenon[ph.id]    = computeStats(eps);
      }

      const calendar = buildCalendar(episodesByPhenomenon);

      renderStation(station, data, episodesByPhenomenon, statsByPhenomenon, calendar);

      // Fetch temps réel PP (non bloquant)
      if (!station.source) {
        fetchLivePP(station.id).then(live => {
          if (!live) return;
          const liveEl = document.getElementById(`live-${station.id}`);
          if (liveEl) liveEl.innerHTML = renderLiveMeasure(live, station);
        });
      }

    } catch(err) {
      document.getElementById(`error-${station.id}`).textContent =
        `Impossible de charger les données : ${err.message}`;
    }
  }
}

// ── Rendu HTML ─────────────────────────────────────────────────

function renderStationShell(container, station) {
  const el = document.createElement("section");
  el.className = "station";
  el.id = `station-${station.id}`;
  el.innerHTML = `
    <div class="station-header" onclick="toggleStation('${station.id}')">
      <div class="station-header-top">
        <span class="station-name">${station.name}</span>
        <span class="station-id">PP${station.id}</span>
        <span class="station-chevron" id="chevron-${station.id}">▸</span>
      </div>
      <div class="station-header-row">
        <div class="station-header-left">
          <div id="live-${station.id}" class="station-live">Chargement…</div>
          <div id="ph-summary-${station.id}" class="ph-summary"></div>
        </div>
        <div id="spark-${station.id}" class="station-spark"></div>
      </div>
      <div id="episode-${station.id}" class="station-episode"></div>
    </div>
    <p class="error-msg" id="error-${station.id}"></p>
    <div class="station-body collapsed" id="body-${station.id}">
      <div class="loading">Chargement…</div>
    </div>
  `;
  container.appendChild(el);
}

function toggleStation(id) {
  const body = document.getElementById(`body-${id}`);
  const chevron = document.getElementById(`chevron-${id}`);
  const collapsed = body.classList.toggle("collapsed");
  chevron.textContent = collapsed ? "▸" : "▾";
}

// ── Sparkline 24h ──────────────────────────────────────────────

function phenColorForHour(h, station) {
  // Retourne la couleur du phénomène actif pour ce bucket, null sinon
  for (const ph of station.phenomena) {
    const { direction, tolerance, speed_avg_min, hours: hw, gap_max } = ph;
    if (h.heading == null || h.speed_avg == null) continue;
    if (!inDirectionRange(h.heading, direction, tolerance)) continue;
    if (h.speed_avg < speed_avg_min) continue;
    if (hw) {
      const lh = localHour(h.hour, CONFIG.timezone);
      const [from, to] = hw;
      if (lh < from || lh >= to) continue;
    }
    return ph.color;
  }
  return null;
}

function renderSparkline(stationId, station, hours24) {
  const W = 400, H = 72, PAD_L = 2, PAD_R = 2, PAD_V = 4;
  const n = hours24.length;
  if (n < 2) return "";

  const speeds = hours24.map(h => h.speed_avg || 0);
  const gusts  = hours24.map(h => h.speed_gust || 0);
  const maxV   = Math.max(...gusts, 20);

  const x = i => PAD_L + (i / (n - 1)) * (W - PAD_L - PAD_R);
  const y = v => H - PAD_V - (v / maxV) * (H - PAD_V * 2);

  // Traits verticaux toutes les 6h
  const nowTime  = parseHourStr(hours24[n - 1].hour).getTime();
  const startTime = parseHourStr(hours24[0].hour).getTime();
  const totalMs  = nowTime - startTime;
  const gridLines = [];
  for (let h = 6; h < 24; h += 6) {
    const t = nowTime - h * 3600 * 1000;
    if (t <= startTime) continue;
    const ratio = (t - startTime) / totalMs;
    const gx = (PAD_L + ratio * (W - PAD_L - PAD_R)).toFixed(1);
    const label = `-${h}h`;
    gridLines.push(`<line x1="${gx}" y1="0" x2="${gx}" y2="${H}" stroke="#ffffff" stroke-width="0.5" opacity="0.12"/>`);
    gridLines.push(`<text x="${gx}" y="${H - 2}" text-anchor="middle" font-size="8" fill="#ffffff" opacity="0.6" font-family="monospace">${label}</text>`);
  }

  const gustPath = gusts.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const areaPath = speeds.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ")
    + ` L${x(n-1).toFixed(1)},${H} L${x(0).toFixed(1)},${H} Z`;
  const linePath = speeds.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");

  const dots = hours24.map((h, i) => {
    const col = phenColorForHour(h, station);
    if (!col) return "";
    return `<circle cx="${x(i).toFixed(1)}" cy="${y(speeds[i]).toFixed(1)}" r="2.5" fill="${col}" opacity="0.95"/>`;
  }).join("");

  // "maintenant" à droite avec label
  const nowX = x(n - 1).toFixed(1);

  return `<svg class="sparkline" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%;display:block">
    <defs>
      <linearGradient id="sg-${stationId}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.3"/>
        <stop offset="100%" stop-color="#38bdf8" stop-opacity="0.02"/>
      </linearGradient>
    </defs>
    ${gridLines.join("")}
    <path d="${areaPath}" fill="url(#sg-${stationId})"/>
    <path d="${gustPath}" fill="none" stroke="#ff6b6b" stroke-width="1.5" opacity="0.5"/>
    <path d="${linePath}" fill="none" stroke="#38bdf8" stroke-width="2"/>
    ${dots}
    <line x1="${nowX}" y1="0" x2="${nowX}" y2="${H - 10}" stroke="#ffffff" stroke-width="1" opacity="0.6"/>
    <text x="${Number(nowX) - 3}" y="${H - 2}" text-anchor="end" font-size="8" fill="#ffffff" opacity="0.7" font-family="monospace">now</text>
  </svg>`;
}


// ── Encart "épisode en cours" ──────────────────────────────

function renderLiveBanner(station, data) {
  const now = new Date();
  // Prendre la dernière mesure du JSON
  if (!data.hours || data.hours.length === 0) return "";

  const last = data.hours[data.hours.length - 1];
  const lastTime = parseHourStr(last.hour);
  // Si la dernière mesure a plus de 2h, données trop vieilles
  const ageH = (now - lastTime) / 3600000;
  if (ageH > 2) return "";

  let activeEp = null;
  let activePh = null;
  let activeStart = null;

  for (const ph of station.phenomena) {
    const { direction, tolerance, speed_avg_min, hours: hourWindow, gap_max } = ph;
    const lh = localHour(last.hour, CONFIG.timezone);
    if (hourWindow) {
      const [from, to] = hourWindow;
      if (lh < from || lh >= to) continue;
    }
    if (!inDirectionRange(last.heading, direction, tolerance)) continue;
    if (last.speed_avg < speed_avg_min) continue;

    // Remonter pour trouver le vrai début de l'épisode
    // On tolère gap_max comme dans la détection : un bucket raté ne coupe pas si l'écart <= gap_max
    const maxGap = gap_max || 15;
    let startIdx = data.hours.length - 1;
    let missedStreak = 0; // buckets consécutifs ne satisfaisant pas les conditions
    for (let i = data.hours.length - 2; i >= 0; i--) {
      const h = data.hours[i];
      const next = data.hours[i + 1];
      const gapMin = (parseHourStr(next.hour) - parseHourStr(h.hour)) / 60000;
      if (gapMin > maxGap) break; // vrai trou de données
      const hlh = localHour(h.hour, CONFIG.timezone);
      const inWindow = !hourWindow || (hlh >= hourWindow[0] && hlh < hourWindow[1]);
      const matches = inWindow &&
                      inDirectionRange(h.heading, direction, tolerance) &&
                      h.speed_avg >= speed_avg_min;
      if (matches) {
        startIdx = i;
        missedStreak = 0;
      } else {
        missedStreak++;
        // Tolérer jusqu'à gap_max/15 buckets consécutifs manqués
        if (missedStreak * 15 > maxGap) break;
      }
    }

    activePh = ph;
    activeEp = last;
    activeStart = data.hours[startIdx];
    break;
  }

  if (activePh && activeEp) {
    const start = fmtStart(activeStart.hour, CONFIG.timezone);
    // Stats sur tout l'épisode depuis startIdx
    const epHours = data.hours.slice(data.hours.indexOf(activeStart));
    const avgSpeeds  = epHours.map(h => h.speed_avg).filter(v => v > 0);
    const gustSpeeds = epHours.map(h => h.speed_gust).filter(v => v > 0);
    const epAvg      = avgSpeeds.length ? Math.round(avgSpeeds.reduce((a,b)=>a+b,0)/avgSpeeds.length*10)/10 : 0;
    const epVmax     = avgSpeeds.length ? Math.max(...avgSpeeds) : 0;
    const epGust     = gustSpeeds.length ? Math.max(...gustSpeeds) : 0;
    return `<div class="live-banner active">
      <span class="live-dot"></span>
      <span class="live-text">
        <strong>${activePh.icon} ${activePh.name} en cours</strong>
        · depuis ${start}
        · moy ${epAvg} km/h · max ${epVmax} km/h
        · <span style="color:#ff6b6b">rafale ${epGust} km/h</span>
      </span>
    </div>`;
  } else {
    return `<div class="live-banner">
      <span class="live-dot"></span>
      <span class="live-text">Pas d'épisode en cours</span>
    </div>`;
  }
}

function renderStation(station, data, episodesByPhenomenon, statsByPhenomenon, calendar) {
  const body = document.getElementById(`body-${station.id}`);
  const liveEl = document.getElementById(`live-${station.id}`);

  // Dernier relevé + encart live (toujours visibles)
  const lastMeasure = data.hours.length > 0 ? data.hours[data.hours.length - 1] : null;
  liveEl.innerHTML = renderLastMeasure(lastMeasure, station);
  const episodeEl = document.getElementById(`episode-${station.id}`);
  if (episodeEl) episodeEl.innerHTML = renderLiveBanner(station, data);

  // Sparkline 24h (toujours visible)
  const now24 = new Date();
  const cutoff24 = new Date(now24.getTime() - 24 * 3600 * 1000);
  const hours24 = data.hours.filter(h => parseHourStr(h.hour) >= cutoff24);
  const sparkEl = document.getElementById(`spark-${station.id}`);
  if (sparkEl) sparkEl.innerHTML = renderSparkline(station.id, station, hours24);

  // Résumé phénomènes (condensé, toujours visible)
  const phSummary = document.getElementById(`ph-summary-${station.id}`);
  phSummary.innerHTML = station.phenomena.map(ph => {
    const stats = statsByPhenomenon[ph.id];
    const count = stats ? stats.count : 0;
    return `<span class="ph-chip" style="--ph-color:${ph.color}">${ph.icon} ${ph.name} <strong>${count}</strong></span>`;
  }).join("");

  const updatedStr = data.updated
    ? new Date(data.updated).toLocaleString("fr-FR", { timeZone: CONFIG.timezone,
        day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
    : "—";

  let html = `<p class="updated">Données au ${updatedStr} · ${data.hours.length} mesures</p>`;

  // ── Stats cards par phénomène
  html += `<div class="phenomena-grid">`;
  for (const ph of station.phenomena) {
    const stats = statsByPhenomenon[ph.id];
    html += renderPhenomenonCard(ph, stats);
  }
  html += `</div>`;

  // ── Graphiques
  html += `<div class="charts-row">`;
  for (const ph of station.phenomena) {
    html += `<div class="chart-block">
      <h3 style="color:${ph.color}">${ph.name} — Heure de début</h3>
      <canvas id="chart-start-${station.id}-${ph.id}" width="340" height="160"></canvas>
    </div>`;
  }
  html += `</div>`;

  // ── Calendrier
  html += renderCalendar(station, calendar);

  // ── Tableau des épisodes récents
  for (const ph of station.phenomena) {
    html += renderEpisodeTable(ph, episodesByPhenomenon[ph.id]);
  }

  body.innerHTML = html;

  // Dessiner les graphiques après injection HTML
  for (const ph of station.phenomena) {
    const stats = statsByPhenomenon[ph.id];
    if (stats) drawStartHourChart(
      `chart-start-${station.id}-${ph.id}`,
      stats.start_hour_dist,
      ph.color,
      stats.start_hour_avg
    );
  }
}

function renderLastMeasure(last, station) {
  if (!last) return "";
  const age = Math.round((new Date() - new Date(last.hour + ":00Z")) / 60000);
  const ageStr = age < 60 ? `il y a ${age} min` : `il y a ${Math.round(age/60)}h`;
  const liveBtn = station?.live_url
    ? `<a class="lm-live" href="${station.live_url}" target="_blank" onclick="event.stopPropagation()">⚡ live</a>`
    : "";
  return `<div class="last-measure">
    <span class="lm-time">${fmtStart(last.hour, CONFIG.timezone)}</span>
    <span class="lm-sep">·</span>
    <span class="lm-speed">${last.speed_avg} km/h</span>
    <span class="lm-gust" style="color:#ff6b6b">${last.speed_gust} km/h</span>
    <span class="lm-dir">${last.heading}°</span>
    <span class="lm-age">${ageStr}</span>
    ${liveBtn}
  </div>`;
}

function renderPhenomenonCard(ph, stats) {
  const header = `
    <div class="ph-header" onclick="this.closest('.ph-card').classList.toggle('open')">
      <span class="ph-icon">${ph.icon}</span>
      <span class="ph-name">${ph.name}</span>
      <span class="ph-chevron">▸</span>
    </div>`;

  if (!stats) return `
    <div class="ph-card" style="--ph-color:${ph.color}">
      ${header}
      <div class="ph-body">
        <div class="ph-nodata">Aucun épisode détecté</div>
      </div>
    </div>`;

  return `
    <div class="ph-card" style="--ph-color:${ph.color}">
      ${header}
      <div class="ph-body">
      <div class="ph-stats">
        <div class="stat-row">
          <span class="stat-label">Épisodes</span>
          <span class="stat-val">${stats.count}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Début moyen</span>
          <span class="stat-val">${stats.start_hour_avg.toFixed(1).replace(".", "h")}${Math.round((stats.start_hour_avg % 1) * 60).toString().padStart(2,"0")}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Début min/max</span>
          <span class="stat-val">${stats.start_hour_min}h – ${stats.start_hour_max}h</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Durée moy</span>
          <span class="stat-val">${stats.duration_avg_h.toFixed(1)} h</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Durée max</span>
          <span class="stat-val">${stats.duration_max_h} h</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Vitesse moy</span>
          <span class="stat-val">${stats.speed_avg} km/h</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Rafale max</span>
          <span class="stat-val">${stats.speed_gust_max} km/h</span>
        </div>
      </div>
      </div>
    </div>`;
}

function renderCalendar(station, calendar) {
  // Générer les 60 derniers jours
  const days = [];
  const now = new Date();
  for (let i = 59; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    days.push(d.toLocaleDateString("fr-FR", {
      timeZone: CONFIG.timezone,
      year: "numeric", month: "2-digit", day: "2-digit",
    }));
  }

  let html = `<div class="calendar-section">
    <h3 class="section-title">Calendrier des 60 derniers jours</h3>
    <div class="cal-legend">`;

  for (const ph of station.phenomena) {
    html += `<span class="cal-dot" style="background:${ph.color}"></span>${ph.name}&nbsp;&nbsp;`;
  }
  html += `</div><div class="calendar-grid">`;

  for (const day of days) {
    const events = calendar[day] || {};
    const pills = station.phenomena
      .filter(ph => events[ph.id]?.length > 0)
      .map(ph => {
        const eps = events[ph.id];
        const ep  = eps.reduce((a, b) => a.start_hour < b.start_hour ? a : b);
        const start   = fmtStart(ep.start_hour, CONFIG.timezone);
        const vmax    = ep.speed_avg_max;
        const tooltip = ph.name + " · début " + start + " · max " + vmax + " km/h";
        const gust = ep.speed_gust_max;
        return `<span class="pill" style="--pill-color:${ph.color}" title="${tooltip}">` +
               `<span class="pill-time">${start}</span>` +
               `<span class="pill-row2"><span class="pill-vmax">${vmax}</span><span class="pill-gust">${gust}</span></span>` +
               `</span>`;
      })
      .join("");

    const hasEvent = Object.keys(events).length > 0;
    html += `<div class="cal-day ${hasEvent ? "has-event" : ""}">` +
            `<span class="cal-date">${day.slice(0, 5)}</span>` +
            `<div class="cal-pills">${pills}</div>` +
            `</div>`;
  }

  html += `</div></div>`;
  return html;
}

function fmtStart(hourStr, timezone) {
  // Affiche "14h30" depuis "2026-01-15T14:30"
  const d = parseHourStr(hourStr);
  const hh = d.toLocaleString("fr-FR", { timeZone: timezone, hour: "2-digit", hour12: false });
  const mm = d.toLocaleString("fr-FR", { timeZone: timezone, minute: "2-digit" });
  return `${hh}h${mm.padStart(2,"0")}`;
}

function renderEpisodeTable(ph, episodes) {
  if (!episodes || episodes.length === 0) return "";

  // Épisodes groupés, les plus récents en premier
  const recent = [...episodes].reverse().slice(0, 30);

  let html = `<div class="episode-section">
    <h3 class="section-title" style="color:${ph.color}">${ph.name} — épisodes récents</h3>
    <table class="ep-table">
      <thead>
        <tr>
          <th>Jour</th>
          <th>Début</th>
          <th>Durée</th>
          <th>Moy</th>
          <th>Max 15min</th>
          <th>Rafale</th>
        </tr>
      </thead>
      <tbody>`;

  for (const ep of recent) {
    const durStr = ep.duration_h < 1
      ? `${Math.round(ep.duration_h * 60)}min`
      : `${ep.duration_h}h`;
    html += `<tr>
      <td>${ep.day}</td>
      <td>${fmtStart(ep.start_hour, CONFIG.timezone)}</td>
      <td>${durStr}</td>
      <td>${ep.speed_avg}</td>
      <td>${ep.speed_avg_max}</td>
      <td class="gust">${ep.speed_gust_max}</td>
    </tr>`;
  }

  html += `</tbody></table></div>`;
  return html;
}

// ── Canvas chart : distribution heures de début ────────────────

function drawStartHourChart(canvasId, dist, color, avgHour) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  const PAD = { top: 10, right: 10, bottom: 24, left: 28 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top  - PAD.bottom;

  ctx.clearRect(0, 0, W, H);

  const maxVal = Math.max(...dist, 1);
  const barW   = chartW / dist.length;

  // Grille
  ctx.strokeStyle = "rgba(255,255,255,0.07)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = PAD.top + chartH - (i / 4) * chartH;
    ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + chartW, y); ctx.stroke();
  }

  // Barres
  dist.forEach((v, i) => {
    const bh = (v / maxVal) * chartH;
    const x  = PAD.left + i * barW;
    const y  = PAD.top + chartH - bh;
    const alpha = 0.3 + (v / maxVal) * 0.7;
    ctx.fillStyle = color + Math.round(alpha * 255).toString(16).padStart(2, "0");
    ctx.fillRect(x + 1, y, barW - 2, bh);
  });

  // Ligne moyenne
  if (avgHour != null) {
    const avgX = PAD.left + (avgHour / 24) * chartW;
    ctx.strokeStyle = "#ffffff99";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(avgX, PAD.top); ctx.lineTo(avgX, PAD.top + chartH); ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = "#ffffffcc";
    ctx.font = "10px monospace";
    ctx.fillText(`${avgHour.toFixed(1)}h`, avgX + 3, PAD.top + 12);
  }

  // Axe X heures
  ctx.fillStyle = "rgba(255,255,255,0.4)";
  ctx.font = "9px monospace";
  [0, 6, 12, 18, 23].forEach(h => {
    const x = PAD.left + (h / 24) * chartW;
    ctx.fillText(`${h}h`, x - 6, H - 6);
  });

  // Axe Y
  ctx.fillStyle = "rgba(255,255,255,0.4)";
  ctx.font = "9px monospace";
  ctx.fillText(maxVal, PAD.left - 22, PAD.top + 10);
  ctx.fillText("0", PAD.left - 10, PAD.top + chartH + 1);
}

// ── Lancement ──────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", init);
