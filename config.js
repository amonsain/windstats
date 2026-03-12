// ═══════════════════════════════════════════════════════════════
//  CONFIG — Stations & Phénomènes
//  Pour ajouter une station : dupliquer un bloc dans STATIONS[]
//  Pour ajouter un phénomène : dupliquer un bloc dans phenomena[]
// ═══════════════════════════════════════════════════════════════

const CONFIG = {

  // Nombre de jours d'historique à afficher
  history_days: 60,

  // Fuseau horaire local pour l'affichage
  timezone: "Europe/Paris",

  stations: [
    {
      id: 74,
      name: "Luchon",
      description: "Station PP74",

      phenomena: [
        {
          id: "brise",
          name: "Brise",
          color: "#38bdf8",       // bleu ciel
          icon: "↑",

          // Fenêtre horaire locale (null = pas de contrainte)
          hours: [11, 18],

          // Direction centrale en degrés + tolérance ±
          direction: 25,          // NNE (brise réelle Luchon)
          tolerance: 20,          // ± 20° → accepte 5°–45°

          // Seuils vitesse (km/h)
          speed_avg_min: 10,

          // Durée minimale pour valider un épisode (minutes)
          duration_min: 15,

          // Durée max d'un "trou" autorisé dans un épisode (minutes)
          gap_max: 60,
        },

        {
          id: "rentree_sud",
          name: "Rentrée Sud",
          color: "#fb923c",       // orange
          icon: "↓",

          // Pas de contrainte horaire
          hours: null,

          // Sud ± 45°  → accepte 135°–225°
          direction: 180,
          tolerance: 45,

          speed_avg_min: 20,

          duration_min: 0,        // pas de durée mini : on note dès que ça pointe
          gap_max: 60,
        },
      ],
    },

    {
      id: 313,
      name: "Cornudère",
      description: "Station PP313",

      phenomena: [
        {
          id: "brise",
          name: "Brise",
          color: "#38bdf8",
          icon: "↑",
          hours: [11, 18],
          direction: 0,
          tolerance: 20,
          speed_avg_min: 17,
          duration_min: 15,
          gap_max: 60,
        },
        {
          id: "rentree_sud",
          name: "Rentrée Sud",
          color: "#fb923c",
          icon: "↓",
          hours: null,
          direction: 180,
          tolerance: 45,
          speed_avg_min: 17,
          duration_min: 0,
          gap_max: 60,
        },
        {
          id: "rentree_ouest",
          name: "Rentrée Ouest",
          color: "#a78bfa",
          icon: "←",
          hours: null,
          direction: 270,
          tolerance: 45,
          speed_avg_min: 17,
          duration_min: 0,
          gap_max: 60,
        },
      ],
    },
    {
      id: "31042012",
      name: "Luchon MF",
      description: "Station Météo-France 31042012",
      source: "meteofrance",

      phenomena: [
        {
          id: "brise",
          name: "Brise",
          color: "#38bdf8",
          icon: "↑",
          hours: [11, 18],
          direction: 0,
          tolerance: 20,
          speed_avg_min: 17,
          duration_min: 15,
          gap_max: 60,
        },
        {
          id: "rentree_sud",
          name: "Rentrée Sud",
          color: "#fb923c",
          icon: "↓",
          hours: null,
          direction: 180,
          tolerance: 45,
          speed_avg_min: 17,
          duration_min: 0,
          gap_max: 60,
        },
      ],
    },
    {
      id: "65059001",
      name: "Pic du Midi",
      description: "Station Météo-France 65059001 — 2877m",
      source: "meteofrance",

      phenomena: [
        {
          id: "flux_nord",
          name: "N",
          color: "#38bdf8",
          icon: "↓",
          hours: null,
          direction: 0,
          tolerance: 45,
          speed_avg_min: 35,
          duration_min: 30,
          gap_max: 60,
        },
        {
          id: "flux_sud",
          name: "S",
          color: "#fb923c",
          icon: "↑",
          hours: null,
          direction: 180,
          tolerance: 45,
          speed_avg_min: 35,
          duration_min: 30,
          gap_max: 60,
        },
        {
          id: "flux_est",
          name: "E",
          color: "#4ade80",
          icon: "←",
          hours: null,
          direction: 90,
          tolerance: 45,
          speed_avg_min: 35,
          duration_min: 30,
          gap_max: 60,
        },
        {
          id: "flux_ouest",
          name: "O",
          color: "#a78bfa",
          icon: "→",
          hours: null,
          direction: 270,
          tolerance: 45,
          speed_avg_min: 35,
          duration_min: 30,
          gap_max: 60,
        },
      ],
    },
  ],
};
