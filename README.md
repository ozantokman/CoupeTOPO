# 🗺️ CoupeMAP — Coupe Topographique Interactive

**Générez des coupes topographiques (profils altimétriques) directement depuis votre navigateur, et exportez-les en DXF pour ArchiCAD, AutoCAD et autres logiciels de CAO/BIM.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Static Site](https://img.shields.io/badge/Deploy-Static-blue.svg)](#déploiement)

🌐 **Demo live :** [coupemap.dev.ozantokman.com](https://coupemap.dev.ozantokman.com)

---

## ✨ Fonctionnalités

- 📍 **Tracé de coupe en 2 clics** — Cliquez point A puis point B sur la carte
- 🏔️ **Profil altimétrique** — Données IGN (RGE ALTI) via l'API GeoPF
- 🏢 **Bâtiments & arbres** — Enrichissement automatique via OpenStreetMap (Overpass API)
- 📐 **Export DXF** — Compatible ArchiCAD (AC1015/R2000) avec échelle verticale configurable
- 📊 **Export CSV** — Données brutes (distance, coordonnées, altitude)
- 🗺️ **6 styles de carte** — IGN Plan, IGN Satellite, OSM, OpenTopoMap, CartoDB Light/Dark
- 🔄 **Import GeoJSON** — Glissez un fichier `.geojson` pour charger une ligne existante
- ➡️ **Flèches d'orientation** — Indicateurs perpendiculaires 90° sur la ligne de coupe
- 📈 **Graphique interactif** — Profil d'élévation avec overlay bâtiments/arbres (Chart.js)
- 🌳 **Silhouettes d'arbres** — Représentation réaliste dans le profil et le DXF

---

## 📸 Capture d'écran

<!-- TODO: ajouter screenshot de l'application -->

---

## 🚀 Démarrage rapide

### Utilisation en ligne

Rendez-vous sur [coupemap.dev.ozantokman.com](https://coupemap.dev.ozantokman.com)

### Installation locale

```bash
git clone https://github.com/ozantokman/coupemap.git
cd coupemap
```

Ouvrez `index.html` dans votre navigateur — c'est tout ! Aucun build, aucun serveur, aucune dépendance à installer.

Ou avec un serveur local (recommandé pour éviter les restrictions CORS de certains navigateurs) :

```bash
# Python
python -m http.server 8000

# Node.js
npx serve .

# VS Code
# Utilisez l'extension "Live Server"
```

---

## 🏗️ Architecture

```
coupemap/
├── index.html          # Structure HTML
├── style.css           # Styles CSS
├── app.js              # Logique applicative
├── assets/             # Logos (SVG, PNG)
├── data/               # GeoJSON France, données arbres
├── docs/               # ARCHITECTURE, CONTRIBUTING, TODO…
├── LICENSE             # Licence MIT
└── README.md           # Ce fichier
```

L'application est **100% statique** — pas de backend, pas de base de données, pas de build.

Toutes les API utilisées sont publiques et gratuites :
- **[API GeoPF (IGN)](https://geoservices.ign.fr/)** — Tuiles cartographiques et données altimétriques
- **[Overpass API (OSM)](https://overpass-api.de/)** — Bâtiments et arbres OpenStreetMap
- **[Leaflet](https://leafletjs.com/)** — Carte interactive
- **[Chart.js](https://www.chartjs.org/)** — Graphique du profil

➡️ Voir [ARCHITECTURE.md](ARCHITECTURE.md) pour les diagrammes détaillés.

---

## 🎯 Comment utiliser

| Étape | Action |
|-------|--------|
| **1** | 📍 Cliquez **point A** puis **point B** sur la carte pour tracer la ligne de coupe |
| **2** | ⬇️ Cliquez **"Télécharger le profil"** pour récupérer les données d'altitude |
| **3** | 📊 Consultez le **graphique** et les **statistiques** (distance, altitude, D+/D-) |
| **4** | 📐 Cliquez **"Télécharger DXF"** pour exporter le profil vers votre logiciel CAO |

Options supplémentaires :
- 🌳 **Rechercher bâtiments & arbres** pour enrichir le profil avec les données OSM
- 📁 **Importer un GeoJSON** au lieu de tracer manuellement
- 🎨 **Changer le style de carte** (IGN, OSM, CartoDB...)

---

## 🤝 Contribuer

Les contributions sont les bienvenues ! Voir [CONTRIBUTING.md](CONTRIBUTING.md) pour les détails.

**Règles importantes :**
1. Ce dépôt (`ozantokman/coupemap`) est le dépôt principal (upstream)
2. Forkez, créez une branche, et soumettez une Pull Request
3. Les crédits de l'auteur original doivent rester dans le code et l'interface

---

## 📄 Licence

[MIT License](LICENSE) — Libre d'utilisation, modification et distribution.

**Condition :** les crédits de l'auteur original doivent être conservés dans toute copie ou dérivé substantiel.

---

## 👤 Auteur

**Ozan Tokman**

- 🌐 [ozantokman.com](https://ozantokman.com)
- 🏗️ [brouskdesign.fr](https://brouskdesign.fr)
- 💻 [github.com/ozantokman](https://github.com/ozantokman)

---

## 🙏 Remerciements

- [IGN / Géoplateforme](https://geoservices.ign.fr/) — Données altimétriques et cartographiques françaises
- [OpenStreetMap](https://www.openstreetmap.org/) — Données bâtiments et arbres
- [Leaflet](https://leafletjs.com/) — Librairie cartographique
- [Chart.js](https://www.chartjs.org/) — Librairie graphique
