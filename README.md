# WindStats 🌬️

Dashboard d'analyse des brises et rentrées météo, basé sur les données [Pioupiou/OpenWindMap](https://openwindmap.org).

## Structure

```
windstats/
├── index.html          ← Dashboard (GitHub Pages)
├── config.js           ← Stations & phénomènes (à éditer)
├── app.js              ← Moteur d'analyse & rendu
├── manifest.webmanifest ← Manifeste PWA (appli iPad)
├── sw.js               ← Service worker (hors ligne)
├── icons/              ← Icônes + écrans de lancement (auto-générés)
├── tools/
│   └── make-icons.py   ← Générateur d'icônes (sans dépendance)
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

## Appli iPad 📱

Le dashboard est une **PWA** : il s'installe sur l'écran d'accueil de l'iPad et s'ouvre en plein écran, sans barre Safari.

### Installer

1. Ouvrir l'URL GitHub Pages dans **Safari** (pas Chrome — iPadOS ne permet l'installation que depuis Safari)
2. Bouton **Partager** → **Sur l'écran d'accueil**
3. L'icône WindStats apparaît sur l'écran d'accueil

### Ce que ça apporte

| | |
|---|---|
| **Hors ligne** | Le dernier état connu (stations, épisodes, calendrier) reste consultable sans réseau — utile en montagne. Les mesures live, elles, nécessitent la 4G. |
| **Lancement instantané** | L'app shell est précaché, pas d'écran blanc au démarrage. |
| **Écran de lancement** | Splash screens natifs pour iPad mini / 10.2" / 11" / 12.9", portrait et paysage. |
| **Mise en page tablette** | 2 colonnes pour les phénomènes et les graphiques, calendrier plus large, cibles tactiles ≥ 44 px, gestion Split View / Slide Over et des encoches (safe areas). |
| **Données fraîches** | Rafraîchissement automatique au retour au premier plan après 5 min, et bouton **↻** dans l'en-tête (en mode appli il n'y a plus de barre d'adresse). |

### Stratégies de cache (`sw.js`)

| Ressource | Stratégie |
|---|---|
| `index.html`, `app.js`, `config.js`, icônes | Réseau d'abord, cache en secours |
| `data/*.json` | Réseau d'abord, cache en secours (données les plus fraîches si le réseau répond) |
| Polices Google | Cache d'abord, rafraîchi en arrière-plan |
| `api.pioupiou.fr` (live) | Jamais mis en cache |

> Après modification de `index.html`, `app.js` ou `config.js`, incrémenter `VERSION` dans `sw.js` (`v1` → `v2`) pour forcer la purge des anciens caches chez les utilisateurs déjà installés.

### Régénérer les icônes

Icônes et splash screens sont générés par un script sans aucune dépendance (encodeur PNG maison) :

```bash
python3 tools/make-icons.py
```

Le tracé du logo se règle via `GROUPS` en haut du script.

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
