# Architecture — CoupeMAP

## Vue d'ensemble

CoupeMAP est une application web 100% statique (HTML + CSS + JS) qui génère des coupes topographiques (profils altimétriques) à partir d'une ligne tracée sur une carte interactive, puis les exporte en DXF pour utilisation dans des logiciels de CAO/BIM (ArchiCAD, AutoCAD, etc.).

---

## Diagramme de flux utilisateur

```mermaid
flowchart TD
    A["🗺️ Ouvrir CoupeMAP"] --> B{"Étape 1 : Source"}
    B -->|Tracer sur carte| C["Clic A → Clic B sur la carte"]
    B -->|Importer fichier| D["Glisser .geojson / .json"]
    
    C --> E["Ligne affichée + flèches 90°"]
    D --> E
    
    E --> F{"Étape 2 : Profil"}
    F --> G["Appel API IGN GeoPF\n/altimetrie/elevationLine.json"]
    G --> H["Données d'élévation reçues"]
    
    H --> I{"Étape 3 : Résultats"}
    I --> J["Graphique Chart.js\n+ Statistiques (dist, alt, D+/D-)"]
    J --> K["Auto-fetch OSM\n(bâtiments + arbres)"]
    
    K --> L{"Étape 4 : Export"}
    L -->|DXF| M["Génération DXF\n(AC1015 / R2000)\nProfil + Grille + OSM"]
    L -->|CSV| N["Export CSV\n(distance, lat, lon, alt)"]
    
    M --> O["📥 Téléchargement .dxf"]
    N --> P["📥 Téléchargement .csv"]
    
    style A fill:#3498db,color:#fff
    style O fill:#27ae60,color:#fff
    style P fill:#27ae60,color:#fff
```

---

## Diagramme de composants

```mermaid
graph LR
    subgraph Browser["🌐 Navigateur"]
        HTML["index.html<br/>Structure & UI"]
        CSS["style.css<br/>Styles & Layout"]
        JS["app.js<br/>Logique applicative"]
    end
    
    subgraph APIs["☁️ APIs externes"]
        IGN["API GeoPF IGN<br/>Tuiles carte + Altimétrie"]
        OSM["Overpass API<br/>Bâtiments & Arbres"]
        TILES["Fournisseurs de tuiles<br/>OSM / CartoDB / IGN"]
    end
    
    subgraph Libraries["📚 Librairies CDN"]
        LEAFLET["Leaflet 1.9.4<br/>Carte interactive"]
        CHARTJS["Chart.js 4.4.0<br/>Graphique profil"]
    end
    
    HTML --> CSS
    HTML --> JS
    JS --> LEAFLET
    JS --> CHARTJS
    LEAFLET --> TILES
    JS -->|fetch elevation| IGN
    JS -->|fetch buildings/trees| OSM
    JS -->|generate blob| DXF["📐 DXF Generator<br/>(built-in)"]
    JS -->|generate blob| CSVGEN["📊 CSV Generator<br/>(built-in)"]
```

---

## Pipeline de données

```mermaid
sequenceDiagram
    participant U as 👤 Utilisateur
    participant MAP as 🗺️ Carte Leaflet
    participant APP as ⚙️ app.js
    participant IGN as ☁️ API GeoPF
    participant OSM as ☁️ Overpass API
    participant DXF as 📐 DXF Builder

    U->>MAP: Clic point A
    MAP->>APP: coords A enregistrées
    U->>MAP: Clic point B
    MAP->>APP: coords B → finishDrawMode()
    APP->>MAP: Affiche ligne + flèches 90°
    
    U->>APP: "Télécharger profil"
    APP->>IGN: GET elevationLine.json<br/>(lon, lat, sampling, resource)
    IGN-->>APP: [{lon, lat, z}, ...]
    APP->>APP: Calcul distances (haversine)
    APP->>MAP: Mise à jour graphique + stats
    
    APP->>OSM: POST Overpass query<br/>(buildings + trees dans 200m)
    OSM-->>APP: {elements: [...]}
    APP->>APP: Parse bâtiments (intersection profil)<br/>Parse arbres (projection sur profil)
    APP->>MAP: Overlay OSM sur graphique
    
    U->>APP: "Télécharger DXF"
    APP->>DXF: generateDXF(useOSM)
    DXF->>DXF: HEADER → TABLES → BLOCKS → ENTITIES
    DXF->>DXF: Profil + Grille + Bâtiments + Arbres + 3D
    DXF-->>U: 📥 profil_topographique.dxf
```

---

## Structure des couches DXF

```mermaid
graph TD
    subgraph DXF["📐 Fichier DXF exporté"]
        GRID["GRID<br/>Grille horizontale/verticale"]
        AXIS["AXIS<br/>Axes X/Y"]
        TERRAIN["TERRAIN_FILL + TERRAIN_WHITE + TERRAIN_OUTLINE<br/>Corps du terrain (3DFACE + polyline)"]
        PROFILE["PROFILE + PROFILE_BODY<br/>Surface du profil (extrusion 3D)"]
        BLDG["BUILDINGS<br/>Bâtiments OSM (rectangles + 3DFACE)"]
        TREES["TREES<br/>Arbres OSM (silhouette polyline)"]
        TEXT["TEXT<br/>Étiquettes, titre, crédits"]
        POINTS["POINTS<br/>Marqueurs min/max"]
        PLAN3D["PLAN_3D<br/>Polyline 3D géoréférencée"]
    end
    
    style GRID fill:#f0f0f0
    style TERRAIN fill:#ecf0f1
    style BLDG fill:#bdc3c7
    style TREES fill:#a8e6a1
    style PROFILE fill:#d5dbdb
```

---

## Styles de carte disponibles

```mermaid
graph LR
    SELECTOR["🎨 Sélecteur de style"] --> IGN_PLAN["IGN Plan V2"]
    SELECTOR --> IGN_SAT["IGN Satellite"]
    SELECTOR --> OSM_STD["OSM Standard"]
    SELECTOR --> OSM_TOPO["OpenTopoMap"]
    SELECTOR --> CARTO_L["CartoDB Light"]
    SELECTOR --> CARTO_D["CartoDB Dark"]
    
    style IGN_PLAN fill:#3498db,color:#fff
    style IGN_SAT fill:#2ecc71,color:#fff
    style OSM_STD fill:#e67e22,color:#fff
    style OSM_TOPO fill:#1abc9c,color:#fff
    style CARTO_L fill:#ecf0f1,color:#333
    style CARTO_D fill:#2c3e50,color:#fff
```
