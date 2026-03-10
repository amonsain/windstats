# WindStats 🌬️

Dashboard d'analyse des brises et rentrées météo, basé sur les données [Pioupiou/OpenWindMap](https://openwindmap.org).

## Structure

```
windstats/
├── index.html          ← Dashboard (GitHub Pages)
├── config.js           ← Stations & phénomènes (à éditer)
├── app.js              ← Moteur d'analyse & rendu
├── fetch-data.js       ← Script Node.js (GitHub Action)
├── data/
│   └── 74.json         ← Données agrégées PP74 (auto-généré)
└── .github/
    └── workflows/
        └── fetch.yml   ← Cron nuit + déclenchement manuel
```

## Déploiement

### 1. Créer le repo GitHub

```bash
git init
git add .
git commit -m "init windstats"
gh repo create windstats --public --push
```

### 2. Activer GitHub Pages

Dans Settings → Pages → Source : **Deploy from branch** → `main` → `/` (root)

### 3. Premier fetch (manuel)

Dans l'onglet **Actions** du repo → `Fetch Pioupiou Data` → **Run workflow**

Le script fetche les 60 derniers jours et crée `data/74.json`.

### 4. Ensuite automatique

Chaque nuit à 3h UTC, le GitHub Action fetche uniquement le delta depuis la dernière mise à jour.

---

## Ajouter une station

Éditer **`config.js`** :

```js
stations: [
  { id: 74, name: "Luchon", phenomena: [...] },
  {
    id: 123,
    name: "Nouveau spot",
    phenomena: [
      {
        id: "brise",
        name: "Brise",
        color: "#34d399",
        icon: "↑",
        hours: [11, 18],
        direction: 45,    // NE
        tolerance: 15,
        speed_avg_min: 10,
        duration_min: 15,
        gap_max: 20,
      }
    ]
  }
]
```

Re-lancer le workflow manuellement → `data/123.json` sera créé automatiquement.

---

## Logique de détection d'un épisode

Une heure est comptée dans un épisode si :
1. **Direction** : heading dans `[direction ± tolerance]` (gestion bascule 0°/360° incluse)
2. **Vitesse** : `speed_avg ≥ speed_avg_min`
3. **Fenêtre horaire** : heure locale dans `[hours[0], hours[1][` (ignoré si `null`)

Les heures consécutives matchantes forment un épisode.  
Un "trou" ≤ `gap_max` minutes entre deux heures matchantes ne coupe pas l'épisode.  
Un épisode doit durer ≥ `duration_min` minutes pour être retenu.

---

## Données stockées (data/{id}.json)

```json
{
  "station_id": 74,
  "updated": "2026-03-10T03:05:00.000Z",
  "hours": [
    {
      "hour": "2026-01-15T13",
      "speed_avg": 18.5,
      "speed_max_avg": 22.0,
      "speed_gust": 31.5,
      "heading": 5,
      "n": 12
    }
  ]
}
```

`speed_avg` = moyenne des vitesses moyennes sur l'heure  
`speed_max_avg` = max des vitesses moyennes sur l'heure  
`speed_gust` = rafale absolue max sur l'heure  
`heading` = direction moyenne circulaire  
`n` = nombre de mesures brutes dans l'heure  

Taille estimée : ~80 KB / mois / station.
