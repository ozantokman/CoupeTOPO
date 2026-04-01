# CoupeMAP — Copilot Instructions

## Project
CoupeMAP (coupemap.dev.ozantokman.com) — Interactive topographic profile generator.
Static site: index.html + app.js + style.css. No build system, no frameworks.

## Stack
- **Map**: Leaflet 1.9.4 (CDN) — IGN GeoPF WMTS tiles
- **Chart**: Chart.js 4.4 (CDN) — Elevation profile visualization
- **DXF**: Custom generator — AC1015/R2000 format (ArchiCAD-compatible)
- **APIs**: IGN GeoPF (elevation), Overpass (OSM buildings/trees)

## Conventions
- Language: French UI strings, English code/comments
- Encoding: UTF-8 (no BOM) — critical, was previously broken
- Style: Vanilla JS (ES6+), no class-based architecture
- CSS: Single file, no preprocessor
- No npm, no node_modules, no build step

## Key Architecture
- State: global variables (drawnLine, drawnCoords, elevationData, osmBuildings, osmTrees)
- Draw mode: 2-click only (Point A → Point B → auto-finish)
- Sidebar: Step-based workflow (Étape 1–4) with lock/unlock via `updateStepStates()`
- DXF: Full AC1015 with HEADER, TABLES, BLOCKS, ENTITIES, OBJECTS sections
- Tree silhouettes: Normalized polyline data from tree.dxf in TREE_DATA constant

## Files
- `index.html` — Semantic HTML5, sidebar with `<details>` collapsible steps
- `app.js` — All application logic (~1300 lines)
- `style.css` — All styling (~150 lines)
- `assets/` — Logo files (SVG, PNG variants)
- `data/fr.geojson` — France boundary outline (loaded on map at startup)
- `data/tree_compact.json` / `data/tree_data.json` — Tree silhouette reference data
- `docs/` — Documentation (ARCHITECTURE, CONTRIBUTING, TODO, LINKEDIN-POST)

## Author
Ozan Tokman — ozantokman.com · brouskdesign.fr
