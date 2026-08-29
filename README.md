# WindStats 🌬️

Dashboard d'analyse des brises et rentrées météo, basé sur les données [Pioupiou/OpenWindMap](https://openwindmap.org).

## Structure

```
windstats/
├── index.html            ← Dashboard (GitHub Pages)
├── config.js             ← Stations & phénomènes (à éditer)
├── app.js                ← Moteur d'analyse & rendu
├── fetch-data.js         ← Script Node.js (GitHub Action)
├── gordonbennett.html    ← Carte Gordon Bennett (trace par altitude)
├── gb-app.js             ← Rendu carte + profil altimétrique
├── fetch-gb.js           ← Récupération des traces YB Tracking
├── data/
│   ├── 74.json           ← Données agrégées PP74 (auto-généré)
│   └── gb.json           ← Traces Gordon Bennett (auto-généré)
└── .github/
    └── workflows/
        ├── fetch.yml     ← Cron nuit + déclenchement manuel
        └── fetch-gb.yml  ← Traces Gordon Bennett (manuel)
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


---

## Carte Gordon Bennett — trace colorée par altitude

`gordonbennett.html` affiche les traces de la [Coupe Aéronautique Gordon
Bennett](https://live.gordonbennett.aero/) sur une carte sombre, **la couleur du
tracé suivant l'altitude tout au long de la trace** : chaque segment est peint
en dégradé entre l'altitude de son point de départ et celle de son point
d'arrivée. Le plafond de nuit et le plongeon du petit matin se lisent
directement sur la carte, sans passer par le profil.

L'échelle est une rampe séquentielle d'une seule teinte à luminosité croissante
(sombre = bas, clair = haut), interpolée en OKLab pour rester régulière à
l'œil — pas d'arc-en-ciel, qui inventerait des frontières là où l'altitude
varie continûment. Comme la couleur est prise par l'altitude, l'identité des
ballons passe par l'étiquette posée sur la dernière position et par la liste
de droite.

Au menu : survol de la carte (altitude, heure, vitesse sol, vario, distance
parcourue), profil altimétrique de la trace sélectionnée synchronisé avec la
carte, échelle d'altitude auto ou fixée à la main, et isolement d'un ballon au
clic.

### Sources de données

**1. Instantané committé (recommandé)**

Le viewer YB Tracking sert ses données depuis sa propre origine, sans en-tête
CORS : une page GitHub Pages ne peut pas les lire directement. Le script Node
contourne le problème côté serveur.

```bash
node fetch-gb.js gb2026      # → data/gb.json
```

Il essaie les endpoints JSON connus de YB, reconnaît les séries de points quelle
que soit la forme exacte de la réponse, et **cumule** avec l'instantané
précédent — si l'API ne renvoie qu'une fenêtre glissante, la trace complète se
reconstitue au fil des appels. Une fois qu'un run manuel passe, décommenter le
cron dans `.github/workflows/fetch-gb.yml`.

Le slug de la course change à chaque édition (`gb2024`, `gb2017fr`…). Côté page,
il se surcharge sans toucher au code :

```
gordonbennett.html?race=gb2024
```

**2. Import de fichiers**

Déposer un ou plusieurs fichiers sur la carte (ou bouton *Importer*) :
**GPX**, **IGC**, **KML** (`LineString` et `gx:Track`), **GeoJSON**. Pratique
pour rejouer une trace après le vol, ou pour comparer sa propre trace à celle
d'un concurrent. C'est aussi le plan de secours si l'endpoint YB de l'édition
en cours ne répond qu'en binaire.
