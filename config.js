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
          direction: 0,           // Nord
          tolerance: 15,          // ± 15° → accepte 345°–015°

          // Seuils vitesse (km/h)
          speed_avg_min: 10,

          // Durée minimale pour valider un épisode (minutes)
          duration_min: 15,

          // Durée max d'un "trou" autorisé dans un épisode (minutes)
          gap_max: 20,
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
          gap_max: 20,
        },
      ],
    },

    // ── Exemple future station ──────────────────────────────────
    // {
    //   id: 123,
    //   name: "Autre spot",
    //   phenomena: [ ... ]
    // },
  ],
};
