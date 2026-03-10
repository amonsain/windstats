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
    <h2 class="station-title">
      <span class="station-name">${station.name}</span>
      <span class="station-id">PP${station.id}</span>
    </h2>
    <p class="error-msg" id="error-${station.id}"></p>
    <div class="station-body" id="body-${station.id}">
      <div class="loading">Chargement…</div>
    </div>
  `;
  container.appendChild(el);
}

function renderStation(station, data, episodesByPhenomenon, statsByPhenomenon, calendar) {
  const body = document.getElementById(`body-${station.id}`);

  const updatedStr = data.updated
    ? new Date(data.updated).toLocaleString("fr-FR", { timeZone: CONFIG.timezone,
        day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
    : "—";

  let html = `<p class="updated">Données au ${updatedStr} · ${data.hours.length} heures</p>`;

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

function renderPhenomenonCard(ph, stats) {
  if (!stats) return `
    <div class="ph-card" style="--ph-color:${ph.color}">
      <div class="ph-icon">${ph.icon}</div>
      <div class="ph-name">${ph.name}</div>
      <div class="ph-nodata">Aucun épisode détecté</div>
    </div>`;

  return `
    <div class="ph-card" style="--ph-color:${ph.color}">
      <div class="ph-icon">${ph.icon}</div>
      <div class="ph-name">${ph.name}</div>
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
    const dots = station.phenomena
      .filter(ph => events[ph.id]?.length > 0)
      .map(ph => `<span class="dot" style="background:${ph.color}" title="${ph.name}"></span>`)
      .join("");

    const hasEvent = Object.keys(events).length > 0;
    html += `<div class="cal-day ${hasEvent ? "has-event" : ""}">
      <span class="cal-date">${day.slice(0, 5)}</span>
      <div class="cal-dots">${dots}</div>
    </div>`;
  }

  html += `</div></div>`;
  return html;
}

function renderEpisodeTable(ph, episodes) {
  if (!episodes || episodes.length === 0) return "";

  const recent = [...episodes].reverse().slice(0, 20);

  let html = `<div class="episode-section">
    <h3 class="section-title" style="color:${ph.color}">${ph.name} — 20 derniers épisodes</h3>
    <table class="ep-table">
      <thead>
        <tr>
          <th>Jour</th>
          <th>Début</th>
          <th>Durée</th>
          <th>Moy km/h</th>
          <th>Max moy</th>
          <th>Rafale max</th>
        </tr>
      </thead>
      <tbody>`;

  for (const ep of recent) {
    html += `<tr>
      <td>${ep.day}</td>
      <td>${ep.local_hour_start}h00</td>
      <td>${ep.duration_h}h</td>
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
