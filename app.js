// ============================================================
// CoupeMAP — Coupe Topographique Interactive
// Author: Ozan Tokman — ozantokman.com · brouskdesign.fr
// License: MIT — github.com/ozantokman/coupemap
// ============================================================

// ============================================================
// MOBILE NOTICE
// ============================================================
document.getElementById('btnDismissMobile')?.addEventListener('click', function() {
    document.getElementById('mobileNotice').classList.add('dismissed');
});

// ============================================================
// STATE
// ============================================================
let drawnLine = null;       // Leaflet polyline layer
let drawnCoords = [];       // [[lat, lng], ...]
let cachedLocationName = null;
let elevationData = null;   // Array of {lon, lat, z, dist}
let profileChart = null;
let osmBuildings = [];      // [{poly:[[lat,lon],...], height, name, startDist, endDist}]
let osmTrees = [];          // [{lat, lon, height, dist, elev}]
let osmDataLoaded = false;

// ============================================================
// MAP SETUP
// ============================================================
const map = L.map('map').setView([46.5, 2.5], 6);

// Tile layers
const tileLayers = {
    'IGN Plan': L.tileLayer('https://data.geopf.fr/wmts?' +
        'SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0' +
        '&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2' +
        '&STYLE=normal&FORMAT=image/png&TILEMATRIXSET=PM' +
        '&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}', {
        maxZoom: 19, attribution: '© IGN'
    }),
    'IGN Satellite': L.tileLayer('https://data.geopf.fr/wmts?' +
        'SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0' +
        '&LAYER=ORTHOIMAGERY.ORTHOPHOTOS' +
        '&STYLE=normal&FORMAT=image/jpeg&TILEMATRIXSET=PM' +
        '&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}', {
        maxZoom: 19, attribution: '© IGN'
    }),
    'OSM Standard': L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19, attribution: '© OpenStreetMap contributors'
    }),
    'OpenTopoMap': L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
        maxZoom: 17, attribution: '© OpenTopoMap, OpenStreetMap contributors'
    }),
    'CartoDB Light': L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 20, attribution: '© OpenStreetMap contributors, © CARTO'
    }),
    'CartoDB Dark': L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 20, attribution: '© OpenStreetMap contributors, © CARTO'
    })
};

// Restore saved preference or default to CartoDB Light
const savedTile = localStorage.getItem('coupemap_tile') || 'CartoDB Light';
let activeLayerName = savedTile;
let userPickedLayer = false;   // true once user manually switches
const autoSwitchZoom = 13;     // zoom threshold: CartoDB Light ↔ IGN Plan

(tileLayers[savedTile] || tileLayers['CartoDB Light']).addTo(map);

// Layer control
L.control.layers(tileLayers, null, { position: 'topright', collapsed: true }).addTo(map);

// Save tile preference on change
map.on('baselayerchange', function(e) {
    localStorage.setItem('coupemap_tile', e.name);
    activeLayerName = e.name;
    userPickedLayer = true;   // user made an explicit choice — stop auto-switching
});

// Auto-switch: CartoDB Light (overview) ↔ IGN Plan (detail) on zoom
map.on('zoomend', function() {
    if (userPickedLayer) return;
    const z = map.getZoom();
    const want = z >= autoSwitchZoom ? 'IGN Plan' : 'CartoDB Light';
    if (want !== activeLayerName) {
        map.removeLayer(tileLayers[activeLayerName]);
        tileLayers[want].addTo(map);
        activeLayerName = want;
    }
});

// France outline from GeoJSON
fetch('data/fr.geojson')
    .then(r => r.json())
    .then(geojson => {
        L.geoJSON(geojson, {
            style: { color: '#2563eb', weight: 1.5, opacity: 0.45, fillColor: '#2563eb', fillOpacity: 0.03 },
            interactive: false
        }).addTo(map);
    })
    .catch(e => console.warn('Could not load France outline:', e));

// Custom bottom-left attribution
L.Control.BrouskCredit = L.Control.extend({
    onAdd: function() {
        const div = L.DomUtil.create('div', 'brousk-credit');
        div.innerHTML = '<a href="https://brouskdesign.fr" target="_blank" rel="noopener">brouskdesign.fr</a>';
        div.style.cssText = 'font-size:11px;opacity:0.55;background:rgba(255,255,255,0.7);padding:2px 6px;border-radius:3px;pointer-events:auto;';
        div.querySelector('a').style.cssText = 'color:#333;text-decoration:none;';
        return div;
    }
});
new L.Control.BrouskCredit({ position: 'bottomleft' }).addTo(map);

// Draw layer
const drawnItems = new L.FeatureGroup();
map.addLayer(drawnItems);

// Arrow/tick layer for section orientation
const arrowItems = new L.FeatureGroup();
map.addLayer(arrowItems);

// ============================================================
// CUSTOM DRAW MODE — 2-click: Point A → Point B → auto-finish
// ============================================================
let drawingMode = false;
let tempCoords = [];      // [[lat,lng], ...] while drawing
let tempPolyline = null;  // live preview polyline
let tempMarkers = [];     // vertex dots

const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
const tapOrClick = isTouchDevice ? 'Appuyez' : 'Cliquez';

const DRAW_STYLE = { color: '#2c3e50', weight: 3 };
const PREVIEW_STYLE = { color: '#2c3e50', weight: 2, dashArray: '6 4', opacity: 0.7 };

document.getElementById('btnDraw').addEventListener('click', () => {
    if (drawingMode) { finishDrawMode(); return; }
    startDrawMode();
});

function showDrawBanner(text) {
    const banner = document.getElementById('drawBanner');
    if (!banner) return;
    if (text) { banner.textContent = text; banner.classList.add('active'); }
    else { banner.classList.remove('active'); }
}

function startDrawMode() {
    drawingMode = true;
    tempCoords = [];
    clearDrawing();
    map.getContainer().style.cursor = 'crosshair';
    document.getElementById('btnDraw').textContent = 'Annuler le tracé';
    document.getElementById('btnDraw').classList.add('btn-primary');
    document.getElementById('btnDraw').classList.remove('btn-secondary');
    const msg = `${tapOrClick} le point A sur la carte`;
    showToast(msg, 'success');
    showDrawBanner(`☛ ${tapOrClick} le point A`);
}

function finishDrawMode() {
    drawingMode = false;
    map.getContainer().style.cursor = '';
    showDrawBanner(null);
    document.getElementById('btnDraw').textContent = 'Tracer la ligne de coupe';
    document.getElementById('btnDraw').classList.remove('btn-primary');
    document.getElementById('btnDraw').classList.add('btn-secondary');
    if (tempPolyline) { drawnItems.removeLayer(tempPolyline); tempPolyline = null; }
    tempMarkers.forEach(m => drawnItems.removeLayer(m));
    tempMarkers = [];
    if (tempCoords.length >= 2) {
        // Remove consecutive duplicates produced by double-click firing two click events
        drawnCoords = tempCoords.filter((c, i) =>
            i === 0 || Math.abs(c[0] - tempCoords[i-1][0]) > 1e-9 || Math.abs(c[1] - tempCoords[i-1][1]) > 1e-9
        );
        drawnLine = L.polyline(drawnCoords, DRAW_STYLE).addTo(drawnItems);
        // Vertex dots
        drawnCoords.forEach(c => {
            const m = L.circleMarker(c, { radius: 4, color: '#2c3e50', fillColor: '#fff', fillOpacity: 1, weight: 2 }).addTo(drawnItems);
            tempMarkers.push(m);
        });
        drawOrientationArrows();
        updateCoordDisplay();
        document.getElementById('btnFetch').disabled = false;
        document.getElementById('btnClearLine').classList.remove('is-hidden');
        updateStepStates();
    } else {
        showToast('Au moins 2 points requis', 'error');
    }
    tempCoords = [];
}

function clearDrawing() {
    drawnItems.clearLayers();
    arrowItems.clearLayers();
    if (tempPolyline) { tempPolyline = null; }
    tempMarkers = [];
    drawnLine = null;
    drawnCoords = [];
    cachedLocationName = null;
    elevationData = null;
    osmBuildings = []; osmTrees = []; osmDataLoaded = false;
    document.getElementById('btnFetch').disabled = true;
    document.getElementById('btnClearLine').classList.add('is-hidden');
    updateCoordDisplay();
    updateStepStates();
}

document.getElementById('btnClearLine').addEventListener('click', () => {
    if (drawingMode) finishDrawMode();
    clearDrawing();
});

map.on('click', function(e) {
    if (!drawingMode) return;
    tempCoords.push([e.latlng.lat, e.latlng.lng]);
    // Vertex dot
    const m = L.circleMarker(e.latlng, { radius: 4, color: '#3498db', fillColor: '#3498db', fillOpacity: 1, weight: 1 }).addTo(drawnItems);
    tempMarkers.push(m);
    // Live preview
    if (tempPolyline) drawnItems.removeLayer(tempPolyline);
    if (tempCoords.length === 1) {
        const msg = `${tapOrClick} le 2ème point pour terminer la ligne`;
        showToast(msg, 'success');
        showDrawBanner(`☛ ${tapOrClick} le point B`);
    }
    if (tempCoords.length >= 2) {
        tempPolyline = L.polyline(tempCoords, PREVIEW_STYLE).addTo(drawnItems);
        finishDrawMode();
    }
});

// ============================================================
// KEYBOARD SHORTCUTS
// ============================================================
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && drawingMode) {
        tempCoords = [];
        finishDrawMode();
        showToast('Tracé annulé', 'error');
    }
});

// ============================================================
// ORIENTATION ARROWS — perpendicular ticks evenly spaced along the line
// ============================================================
function drawOrientationArrows() {
    arrowItems.clearLayers();
    if (drawnCoords.length < 2) return;
    const R = 6371000; // earth radius metres

    const destPoint = (latR, lonR, brng, d) => {
        const dr = d / R;
        const dlat = Math.asin(Math.sin(latR) * Math.cos(dr) + Math.cos(latR) * Math.sin(dr) * Math.cos(brng));
        const dlon = lonR + Math.atan2(Math.sin(brng) * Math.sin(dr) * Math.cos(latR), Math.cos(dr) - Math.sin(latR) * Math.sin(dlat));
        return [dlat * 180 / Math.PI, dlon * 180 / Math.PI];
    };

    // Compute total line length and cumulative distances
    const cumDist = [0];
    for (let i = 1; i < drawnCoords.length; i++) {
        cumDist.push(cumDist[i - 1] + haversine(drawnCoords[i - 1][0], drawnCoords[i - 1][1], drawnCoords[i][0], drawnCoords[i][1]));
    }
    const totalLen = cumDist[cumDist.length - 1];

    // Place at most 5 arrows, evenly spaced along the line (skip endpoints)
    const maxArrows = Math.min(5, Math.max(1, Math.floor(totalLen / 200)));
    const spacing = totalLen / (maxArrows + 1);

    for (let a = 1; a <= maxArrows; a++) {
        const targetDist = a * spacing;

        // Find the segment containing this distance
        let segIdx = 0;
        for (let i = 1; i < cumDist.length; i++) {
            if (cumDist[i] >= targetDist) { segIdx = i - 1; break; }
        }

        // Interpolate position along that segment
        const segLen = cumDist[segIdx + 1] - cumDist[segIdx];
        const t = segLen > 0 ? (targetDist - cumDist[segIdx]) / segLen : 0;
        const lat = drawnCoords[segIdx][0] + t * (drawnCoords[segIdx + 1][0] - drawnCoords[segIdx][0]);
        const lon = drawnCoords[segIdx][1] + t * (drawnCoords[segIdx + 1][1] - drawnCoords[segIdx][1]);

        // Bearing of segment A→B (radians, clockwise from N)
        const lat1 = drawnCoords[segIdx][0] * Math.PI / 180;
        const lon1 = drawnCoords[segIdx][1] * Math.PI / 180;
        const lat2 = drawnCoords[segIdx + 1][0] * Math.PI / 180;
        const lon2 = drawnCoords[segIdx + 1][1] * Math.PI / 180;
        const dLon = lon2 - lon1;
        const y = Math.sin(dLon) * Math.cos(lat2);
        const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
        const bearing = Math.atan2(y, x);

        // Perpendicular: -90° = left side (conventional section viewing direction)
        const perpBearing = bearing - Math.PI / 2;

        const arrowLen = Math.min(80, totalLen * 0.04);
        const latR = lat * Math.PI / 180;
        const lonR = lon * Math.PI / 180;

        const tip = destPoint(latR, lonR, perpBearing, arrowLen);
        const base = destPoint(latR, lonR, perpBearing + Math.PI, arrowLen * 0.3);

        // Arrow shaft
        L.polyline([base, tip], { color: '#e74c3c', weight: 2, opacity: 0.7 }).addTo(arrowItems);

        // Arrowhead
        const headLen = arrowLen * 0.3;
        const leftHead  = destPoint(tip[0] * Math.PI / 180, tip[1] * Math.PI / 180, perpBearing + Math.PI - 0.5, headLen);
        const rightHead = destPoint(tip[0] * Math.PI / 180, tip[1] * Math.PI / 180, perpBearing + Math.PI + 0.5, headLen);
        L.polyline([tip, leftHead],  { color: '#e74c3c', weight: 2, opacity: 0.7 }).addTo(arrowItems);
        L.polyline([tip, rightHead], { color: '#e74c3c', weight: 2, opacity: 0.7 }).addTo(arrowItems);
    }
}

function updateCoordDisplay() {
    const el = document.getElementById('coordDisplay');
    if (drawnCoords.length === 0) {
        el.textContent = 'Aucune ligne dessinée';
    } else {
        el.textContent = drawnCoords.map((c, i) =>
            `P${i+1}: ${c[0].toFixed(6)}, ${c[1].toFixed(6)}`
        ).join(' → ');
    }
}

// ============================================================
// FILE IMPORT
// ============================================================
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');

dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener('change', e => {
    if (e.target.files.length) handleFile(e.target.files[0]);
});

function handleFile(file) {
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = JSON.parse(e.target.result);
            if (data.elevations) {
                // elevationLine.json format
                processElevationJson(data);
            } else if (data["geoportail:compute"]) {
                // profil altimetrique.geojson format
                processGeojson(data);
            } else if (data.type === 'FeatureCollection' || data.type === 'Feature') {
                // Regular geojson with line
                processLineGeojson(data);
            } else {
                showToast('Format de fichier non reconnu', 'error');
            }
        } catch (err) {
            showToast('Erreur de lecture: ' + err.message, 'error');
        }
    };
    reader.readAsText(file);
}

function processElevationJson(data) {
    const pts = data.elevations;
    // Compute distances
    let totalDist = 0;
    elevationData = pts.map((p, i) => {
        if (i > 0) {
            totalDist += haversine(pts[i-1].lat, pts[i-1].lon, p.lat, p.lon);
        }
        return { lon: p.lon, lat: p.lat, z: p.z, dist: totalDist };
    });

    // Reset OSM data when profile changes
    osmBuildings = []; osmTrees = []; osmDataLoaded = false;

    // Draw on map
    const latlngs = pts.map(p => [p.lat, p.lon]);
    drawnItems.clearLayers();
    arrowItems.clearLayers();
    drawnLine = L.polyline(latlngs, { color: '#2c3e50', weight: 3 }).addTo(drawnItems);
    drawnCoords = latlngs;
    map.fitBounds(drawnLine.getBounds(), { padding: [50, 50] });
    drawOrientationArrows();
    document.getElementById('btnClearLine').classList.remove('is-hidden');
    document.getElementById('btnFetchOSM').disabled = false;

    updateUI();
    showToast('ElevationLine.json importé avec succès', 'success');
    autoLoadOSM();
}

function processGeojson(data) {
    const compute = data["geoportail:compute"];
    const pts = compute.points;

    elevationData = pts.map(p => ({
        lon: p.lon, lat: p.lat, z: p.z, dist: p.dist
    }));

    // Reset OSM data when profile changes
    osmBuildings = []; osmTrees = []; osmDataLoaded = false;

    // Draw line on map
    const latlngs = pts.map(p => [p.lat, p.lon]);
    drawnItems.clearLayers();
    arrowItems.clearLayers();
    drawnLine = L.polyline(latlngs, { color: '#2c3e50', weight: 3 }).addTo(drawnItems);
    drawnCoords = latlngs;
    map.fitBounds(drawnLine.getBounds(), { padding: [50, 50] });
    drawOrientationArrows();
    document.getElementById('btnClearLine').classList.remove('is-hidden');
    document.getElementById('btnFetchOSM').disabled = false;

    updateUI();
    showToast('Profil altimétrique importé avec succès', 'success');
    autoLoadOSM();
}

function processLineGeojson(data) {
    let coords;
    if (data.type === 'FeatureCollection' && data.features.length > 0) {
        coords = data.features[0].geometry.coordinates;
    } else if (data.type === 'Feature') {
        coords = data.geometry.coordinates;
    }
    if (!coords) { showToast('Pas de ligne trouvée dans le GeoJSON', 'error'); return; }

    // Set drawn coords and trigger fetch
    drawnCoords = coords.map(c => [c[1], c[0]]);
    drawnItems.clearLayers();
    arrowItems.clearLayers();
    drawnLine = L.polyline(drawnCoords, { color: '#2c3e50', weight: 3 }).addTo(drawnItems);
    map.fitBounds(drawnLine.getBounds(), { padding: [50, 50] });
    drawOrientationArrows();
    document.getElementById('btnClearLine').classList.remove('is-hidden');
    updateCoordDisplay();
    document.getElementById('btnFetch').disabled = false;
    showToast('Ligne importée — cliquez "Télécharger le profil"', 'success');
    updateStepStates();
}

// ============================================================
// FIND BUILDINGS & TREES BUTTON
// ============================================================
document.getElementById('btnFetchOSM').addEventListener('click', async function() {
    if (!elevationData || elevationData.length === 0) return;
    this.disabled = true;
    showLoading(true);
    document.querySelector('#loading div:last-child').textContent = 'Recherche bâtiments & arbres (OSM)...';
    try {
        await fetchOSMData();
        if (profileChart) profileChart.update();
    } catch(e) {
        showToast('Erreur OSM: ' + e.message, 'error');
    }
    showLoading(false);
    this.disabled = false;
    updateStepStates();
});

// ============================================================
// AUTO-LOAD OSM after profile is ready (background, silent)
// ============================================================
async function autoLoadOSM() {
    if (!document.getElementById('osmToggle').checked) return;
    try {
        await fetchOSMData();
        if (profileChart) profileChart.update();
        updateStepStates();
    } catch (e) {
        // silent fail — user can still manually trigger via dedicated button
    }
}

// ============================================================
// API FETCH
// ============================================================
document.getElementById('btnFetch').addEventListener('click', fetchElevation);

async function fetchElevation() {
    if (drawnCoords.length < 2) {
        showToast('Dessinez au moins 2 points sur la carte', 'error');
        return;
    }

    const sampling = parseInt(document.getElementById('sampling').value) || 200;
    const resource = document.getElementById('resource').value;
    const lons = drawnCoords.map(c => c[1]).join('|');
    const lats = drawnCoords.map(c => c[0]).join('|');

    const url = `https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevationLine.json?lon=${lons}&lat=${lats}&indent=false&crs='CRS:84'&resource=${resource}&measures=false&sampling=${sampling}`;

    showLoading(true);
    document.getElementById('btnFetch').disabled = true;
    try {
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();

        if (data.error) throw new Error(data.error);
        processElevationJson(data);
    } catch (err) {
        showToast('Erreur API: ' + err.message, 'error');
    } finally {
        showLoading(false);
        document.getElementById('btnFetch').disabled = (drawnCoords.length < 2);
    }
}

// ============================================================
// UPDATE UI (chart + stats)
// ============================================================
function updateUI() {
    if (!elevationData || elevationData.length === 0) return;

    const dists = elevationData.map(p => p.dist);
    const elevs = elevationData.map(p => p.z);
    const maxDist = Math.max(...dists);
    const minElev = Math.min(...elevs);
    const maxElev = Math.max(...elevs);

    // Compute D+ / D-
    let dPlus = 0, dMinus = 0;
    for (let i = 1; i < elevs.length; i++) {
        const diff = elevs[i] - elevs[i-1];
        if (diff > 0) dPlus += diff; else dMinus += Math.abs(diff);
    }

    // Stats
    document.getElementById('statDist').textContent = maxDist.toFixed(0);
    document.getElementById('statMin').textContent = minElev.toFixed(1);
    document.getElementById('statMax').textContent = maxElev.toFixed(1);
    document.getElementById('statPts').textContent = elevationData.length;
    document.getElementById('statUp').textContent = '+' + dPlus.toFixed(1);
    document.getElementById('statDown').textContent = '-' + dMinus.toFixed(1);
    updateStepStates();

    // Chart
    const chartContainer = document.getElementById('chartContainer');
    if (chartContainer) chartContainer.classList.remove('is-hidden');
    const chartPlaceholder = document.getElementById('chartPlaceholder');
    if (chartPlaceholder) chartPlaceholder.classList.add('is-hidden');
    const ctx = document.getElementById('profileChart').getContext('2d');

    if (profileChart) profileChart.destroy();

    const gradient = ctx.createLinearGradient(0, 0, 0, 220);
    gradient.addColorStop(0, 'rgba(52,152,219,0.35)');
    gradient.addColorStop(1, 'rgba(52,152,219,0.02)');

    profileChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: dists.map(d => d.toFixed(0)),
            datasets: [{
                label: 'Altitude (m)',
                data: elevs,
                borderColor: '#2c3e50',
                backgroundColor: gradient,
                borderWidth: 2,
                fill: true,
                pointRadius: 0,
                pointHitRadius: 8,
                tension: 0.2
            }]
        },
        plugins: [{
            id: 'osmOverlay',
            afterDraw(chart) {
                if (osmBuildings.length === 0 && osmTrees.length === 0) return;
                const { ctx: c, scales: { x: xS, y: yS } } = chart;
                const maxD = Math.max(...dists);

                // Draw buildings as semi-transparent rectangles
                c.save();
                for (const b of osmBuildings) {
                    const xRatio1 = b.startDist / maxD;
                    const xRatio2 = b.endDist / maxD;
                    const idx1 = Math.round(xRatio1 * (dists.length - 1));
                    const idx2 = Math.round(xRatio2 * (dists.length - 1));
                    const bElev1 = elevationAtDist(b.startDist);
                    const bElev2 = elevationAtDist(b.endDist);
                    const baseElev = Math.min(bElev1, bElev2);

                    const px1 = xS.getPixelForValue(idx1);
                    const px2 = xS.getPixelForValue(idx2);
                    const pyBase = yS.getPixelForValue(baseElev);
                    const pyTop = yS.getPixelForValue(baseElev + b.height);

                    c.fillStyle = 'rgba(149,165,166,0.35)';
                    c.strokeStyle = 'rgba(52,73,94,0.6)';
                    c.lineWidth = 1;
                    c.fillRect(px1, pyTop, px2 - px1, pyBase - pyTop);
                    c.strokeRect(px1, pyTop, px2 - px1, pyBase - pyTop);
                }

                // Draw trees using tree.dxf silhouette
                const treeH_chart = 6; // fixed 6m
                for (const t of osmTrees) {
                    const xRatio = t.dist / maxD;
                    const idx = Math.round(xRatio * (dists.length - 1));
                    const tElev = elevationAtDist(t.dist);

                    const px = xS.getPixelForValue(idx);
                    const pyBase = yS.getPixelForValue(tElev);
                    const pyTop = yS.getPixelForValue(tElev + treeH_chart);
                    const totalH = pyBase - pyTop; // pixels
                    const totalW = totalH * TREE_ASPECT;

                    c.fillStyle = 'rgba(39,174,96,0.35)';
                    c.strokeStyle = 'rgba(34,120,60,0.5)';
                    c.lineWidth = 0.6;

                    for (const poly of TREE_DATA) {
                        const closed = poly[0] === 1;
                        c.beginPath();
                        for (let k = 1; k < poly.length; k += 2) {
                            const x = px + poly[k] * totalW;
                            const y = pyBase - poly[k + 1] * totalH;
                            if (k === 1) c.moveTo(x, y); else c.lineTo(x, y);
                        }
                        if (closed) c.closePath();
                        c.fill();
                        c.stroke();
                    }
                }
                c.restore();
            }
        }],
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        title: items => `Distance: ${items[0].label} m`,
                        label: item => `Altitude: ${item.raw.toFixed(1)} m`
                    }
                }
            },
            scales: {
                x: {
                    title: { display: true, text: 'Distance (m)', color: '#666' },
                    ticks: { color: '#666', maxTicksLimit: 15 },
                    grid: { color: 'rgba(0,0,0,0.06)' }
                },
                y: {
                    title: { display: true, text: 'Altitude (m)', color: '#666' },
                    ticks: { color: '#666' },
                    grid: { color: 'rgba(0,0,0,0.08)' }
                }
            }
        }
    });

    // Highlight marker on chart hover
    profileChart.options.plugins.tooltip.external = function(context) {
        // Could add map marker follow here
    };
}

// ============================================================
// CHART TOGGLE
// ============================================================
document.getElementById('chartToggle').addEventListener('click', () => {
    const c = document.getElementById('chartContainer');
    c.classList.toggle('collapsed');
    document.getElementById('chartToggle').textContent = c.classList.contains('collapsed') ? '▲' : '▼';
});

// ============================================================
// DXF GENERATION — ArchiCAD-compatible (AC1015 / R2000)
// ============================================================
document.getElementById('btnDxf').addEventListener('click', async function() {
    if (!elevationData || elevationData.length === 0) {
        showToast('Pas de données de profil', 'error');
        return;
    }
    this.disabled = true;
    let useOSM = document.getElementById('osmToggle').checked;
    if (useOSM && !osmDataLoaded) {
        showLoading(true);
        document.querySelector('#loading div:last-child').textContent = 'Chargement des données OSM...';
        try {
            await fetchOSMData();
        } catch (e) {
            console.warn('OSM fetch failed:', e);
            showToast('Erreur OSM: ' + e.message + ' — export sans bâtiments/arbres', 'error');
            useOSM = false;
        }
        showLoading(false);
    }
    // Resolve location name once (cached)
    if (!cachedLocationName && drawnCoords.length >= 2) {
        const mid = Math.floor(drawnCoords.length / 2);
        cachedLocationName = await reverseGeocode(drawnCoords[mid][0], drawnCoords[mid][1]);
    }
    generateDXF(useOSM);
    this.disabled = false;
});

// Global handle counter for DXF entities
let _h = 0;
function H() { return (_h++).toString(16).toUpperCase(); }

// ============================================================
// OSM Data Fetching (Overpass API)
// ============================================================
async function fetchOSMData() {
    if (!elevationData || elevationData.length < 2) return;

    // Try with 15 sample points first, fallback to 8 on timeout
    const attempts = [15, 8];
    let data = null;

    for (const maxPts of attempts) {
        const step = Math.max(1, Math.floor(elevationData.length / maxPts));
        const sampledPts = elevationData.filter((_, i) => i % step === 0 || i === elevationData.length - 1);
        const coordStr = sampledPts.map(p => `${p.lat},${p.lon}`).join(',');

        const query = `[out:json][timeout:90];(
  way["building"](around:200,${coordStr});
  node["natural"="tree"](around:200,${coordStr});
);out body;>;out skel qt;`;

        console.log(`Overpass query: ${sampledPts.length} points, attempt maxPts=${maxPts}`);

        try {
            const resp = await fetch('https://overpass-api.de/api/interpreter', {
                method: 'POST',
                body: 'data=' + encodeURIComponent(query),
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            });
            if (!resp.ok) {
                console.warn(`Overpass HTTP ${resp.status} with ${sampledPts.length} pts`);
                continue; // retry with fewer points
            }
            data = await resp.json();
            break; // success
        } catch (e) {
            console.warn(`Overpass fetch error with ${sampledPts.length} pts:`, e);
            continue;
        }
    }

    if (!data) throw new Error('Overpass timeout (essayé 2 fois)');

    // Parse nodes into a lookup
    const nodeLookup = {};
    const treeNodes = [];
    for (const el of data.elements) {
        if (el.type === 'node') {
            nodeLookup[el.id] = { lat: el.lat, lon: el.lon };
            if (el.tags && el.tags['natural'] === 'tree') {
                treeNodes.push(el);
            }
        }
    }

    // Parse buildings (ways)
    osmBuildings = [];
    for (const el of data.elements) {
        if (el.type === 'way' && el.tags && el.tags['building']) {
            const poly = [];
            let valid = true;
            for (const nid of el.nodes) {
                if (!nodeLookup[nid]) { valid = false; break; }
                poly.push([nodeLookup[nid].lat, nodeLookup[nid].lon]);
            }
            if (!valid || poly.length < 3) continue;

            let height = 9; // default 3 stories
            if (el.tags['height']) {
                height = parseFloat(el.tags['height']) || 9;
            } else if (el.tags['building:levels']) {
                height = (parseInt(el.tags['building:levels']) || 3) * 3;
            }

            // Find intersections with profile line
            const intersections = findBuildingLineIntersections(poly);
            if (intersections.length > 0) {
                for (const inter of intersections) {
                    osmBuildings.push({
                        name: el.tags['name'] || '',
                        height: height,
                        startDist: inter.startDist,
                        endDist: inter.endDist,
                        startElev: inter.startElev,
                        endElev: inter.endElev
                    });
                }
            }
        }
    }

    // Parse trees
    osmTrees = [];
    for (const tn of treeNodes) {
        const proj = projectPointOnProfile(tn.lat, tn.lon);
        if (proj && proj.perpDist < 200) {
            let height = 8;
            if (tn.tags && tn.tags['height']) {
                height = parseFloat(tn.tags['height']) || 8;
            }
            osmTrees.push({
                lat: tn.lat,
                lon: tn.lon,
                height: height,
                dist: proj.dist,
                elev: proj.elev,
                species: (tn.tags && tn.tags['species']) || ''
            });
        }
    }

    osmDataLoaded = true;
    console.log('fetchOSMData done — buildings:', osmBuildings.length, 'trees:', osmTrees.length);
    showToast(`OSM: ${osmBuildings.length} bâtiments, ${osmTrees.length} arbres`, 'success');
}

// ============================================================
// GEOMETRY HELPERS
// ============================================================
function segIntersect2D(ax, ay, bx, by, cx, cy, dx, dy) {
    // Returns {t, u} if segments (a→b) and (c→d) intersect, else null
    const denom = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
    if (Math.abs(denom) < 1e-12) return null;
    const t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / denom;
    const u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / denom;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
        return { t, u, x: ax + t * (bx - ax), y: ay + t * (by - ay) };
    }
    return null;
}

function findBuildingLineIntersections(buildingPoly) {
    // Find where the profile line intersects the building polygon
    // Returns array of {startDist, endDist, startElev, endElev}
    if (!elevationData || elevationData.length < 2) return [];

    const hits = []; // distances along profile where it crosses building edges

    for (let i = 0; i < elevationData.length - 1; i++) {
        const p1 = elevationData[i], p2 = elevationData[i + 1];
        for (let j = 0; j < buildingPoly.length - 1; j++) {
            const c = buildingPoly[j], d = buildingPoly[j + 1];
            const inter = segIntersect2D(
                p1.lon, p1.lat, p2.lon, p2.lat,
                c[1], c[0], d[1], d[0]
            );
            if (inter) {
                const dist = p1.dist + inter.t * (p2.dist - p1.dist);
                const elev = p1.z + inter.t * (p2.z - p1.z);
                hits.push({ dist, elev });
            }
        }
    }

    if (hits.length < 2) return [];
    hits.sort((a, b) => a.dist - b.dist);

    // Pair consecutive hits as entry/exit
    const result = [];
    for (let i = 0; i < hits.length - 1; i += 2) {
        result.push({
            startDist: hits[i].dist,
            endDist: hits[i + 1].dist,
            startElev: hits[i].elev,
            endElev: hits[i + 1].elev
        });
    }
    return result;
}

function projectPointOnProfile(lat, lon) {
    // Project a point onto the profile line, return {dist, elev, perpDist}
    if (!elevationData || elevationData.length < 2) return null;

    let bestDist = Infinity, bestProjDist = 0, bestElev = 0;
    const mPerDegLat = 111320;
    const mPerDegLon = 111320 * Math.cos(lat * Math.PI / 180);

    for (let i = 0; i < elevationData.length - 1; i++) {
        const p1 = elevationData[i], p2 = elevationData[i + 1];
        // Convert to local meters for distance calc
        const ax = p1.lon * mPerDegLon, ay = p1.lat * mPerDegLat;
        const bx = p2.lon * mPerDegLon, by = p2.lat * mPerDegLat;
        const px = lon * mPerDegLon, py = lat * mPerDegLat;

        const dx = bx - ax, dy = by - ay;
        const len2 = dx * dx + dy * dy;
        if (len2 < 1e-10) continue;
        let t = ((px - ax) * dx + (py - ay) * dy) / len2;
        t = Math.max(0, Math.min(1, t));

        const cx = ax + t * dx, cy = ay + t * dy;
        const perpDist = Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
        if (perpDist < bestDist) {
            bestDist = perpDist;
            bestProjDist = p1.dist + t * (p2.dist - p1.dist);
            bestElev = p1.z + t * (p2.z - p1.z);
        }
    }

    return { dist: bestProjDist, elev: bestElev, perpDist: bestDist };
}

// ============================================================
// TREE SILHOUETTE DATA (extracted from tree.dxf, normalized)
// x: centered around 0, y: 0=bottom 1=top, aspect ~0.685
// Format: [closedFlag, x0, y0, x1, y1, ...]
// ============================================================
const TREE_DATA = [[1,-0.027,0.999,-0.059,0.983,-0.073,0.973,-0.053,0.983,-0.022,0.97,-0.004,0.981,0.013,0.993,0.022,0.979,0.041,0.965,0.041,0.948,0.054,0.955,0.053,0.962,0.075,0.978,0.075,0.983,0.054,0.964,0.04,0.961,0.029,0.978,0.009,0.989,-0.016,0.98,-0.012,0.984,-0.023,1.0,-0.025,1.0],[1,0.091,0.976,0.091,0.944,0.103,0.942,0.101,0.925,0.113,0.922,0.158,0.931,0.165,0.899,0.202,0.914,0.185,0.9,0.192,0.892,0.2,0.877,0.231,0.871,0.215,0.848,0.191,0.831,0.202,0.822,0.204,0.8,0.192,0.788,0.196,0.799,0.177,0.805,0.184,0.788,0.214,0.798,0.213,0.824,0.22,0.838,0.254,0.85,0.284,0.869,0.297,0.884,0.305,0.867,0.31,0.873,0.308,0.892,0.281,0.874,0.258,0.866,0.212,0.835,0.196,0.834,0.214,0.852,0.217,0.876,0.211,0.893,0.19,0.906,0.213,0.899,0.21,0.912,0.169,0.906,0.16,0.923,0.146,0.938,0.128,0.935,0.114,0.93,0.099,0.947,0.089,0.973,0.094,0.978],[1,-0.062,0.975,-0.093,0.947,-0.089,0.925,-0.096,0.916,-0.113,0.893,-0.12,0.901,-0.159,0.925,-0.18,0.898,-0.195,0.864,-0.213,0.855,-0.216,0.852,-0.193,0.859,-0.195,0.879,-0.179,0.895,-0.16,0.911,-0.134,0.917,-0.123,0.9,-0.073,0.869,-0.081,0.899,-0.094,0.912,-0.097,0.918,-0.082,0.926,-0.092,0.948,-0.062,0.972,-0.044,0.97,-0.052,0.975,-0.06,0.975],[1,-0.274,0.886,-0.285,0.863,-0.301,0.851,-0.308,0.854,-0.309,0.825,-0.341,0.82,-0.327,0.798,-0.324,0.792,-0.346,0.783,-0.334,0.759,-0.36,0.761,-0.385,0.769,-0.404,0.758,-0.39,0.748,-0.392,0.743,-0.403,0.731,-0.411,0.722,-0.388,0.73,-0.371,0.732,-0.378,0.732,-0.393,0.732,-0.377,0.744,-0.392,0.758,-0.38,0.765,-0.364,0.758,-0.335,0.754,-0.32,0.745,-0.277,0.748,-0.295,0.753,-0.282,0.763,-0.307,0.757,-0.332,0.76,-0.348,0.773,-0.328,0.785,-0.331,0.805,-0.313,0.813,-0.314,0.837,-0.297,0.848,-0.276,0.855,-0.282,0.874,-0.261,0.879,-0.248,0.863,-0.236,0.869,-0.209,0.863,-0.231,0.866,-0.236,0.871,-0.245,0.868,-0.265,0.886,-0.273,0.887],[1,0.334,0.835,0.341,0.821,0.35,0.808,0.362,0.813,0.378,0.784,0.382,0.787,0.362,0.818,0.342,0.804,0.344,0.825,0.334,0.835],[1,0.376,0.779,0.371,0.771,0.385,0.742,0.388,0.711,0.393,0.7,0.375,0.679,0.357,0.675,0.389,0.683,0.369,0.659,0.377,0.654,0.398,0.662,0.405,0.649,0.411,0.64,0.433,0.63,0.448,0.615,0.44,0.627,0.423,0.647,0.395,0.653,0.396,0.677,0.398,0.701,0.385,0.71,0.387,0.742,0.375,0.77,0.377,0.779],[1,-0.264,0.761,-0.256,0.743,-0.237,0.73,-0.211,0.733,-0.209,0.748,-0.217,0.735,-0.246,0.743,-0.23,0.745,-0.222,0.744,-0.25,0.75,-0.263,0.761],[1,-0.279,0.731,-0.268,0.719,-0.252,0.707,-0.23,0.707,-0.207,0.697,-0.218,0.697,-0.261,0.708,-0.231,0.699,-0.214,0.683,-0.195,0.697,-0.208,0.702,-0.233,0.71,-0.254,0.71,-0.259,0.726,-0.278,0.731],[1,-0.396,0.726,-0.408,0.711,-0.413,0.689,-0.417,0.696,-0.399,0.686,-0.374,0.672,-0.363,0.686,-0.326,0.678,-0.316,0.682,-0.332,0.667,-0.358,0.679,-0.339,0.669,-0.309,0.674,-0.335,0.681,-0.362,0.683,-0.369,0.676,-0.382,0.695,-0.404,0.713,-0.391,0.721,-0.395,0.726],[1,-0.4,0.677,-0.388,0.656,-0.431,0.655,-0.444,0.674,-0.453,0.648,-0.467,0.628,-0.473,0.621,-0.468,0.602,-0.468,0.58,-0.453,0.568,-0.427,0.566,-0.407,0.535,-0.41,0.523,-0.461,0.533,-0.494,0.538,-0.472,0.512,-0.436,0.504,-0.467,0.51,-0.489,0.539,-0.464,0.534,-0.448,0.528,-0.422,0.521,-0.422,0.512,-0.428,0.512,-0.432,0.504,-0.395,0.502,-0.404,0.52,-0.361,0.529,-0.326,0.52,-0.34,0.483,-0.355,0.47,-0.375,0.467,-0.401,0.437,-0.411,0.44,-0.396,0.433,-0.367,0.424,-0.387,0.445,-0.37,0.452,-0.374,0.441,-0.369,0.441,-0.335,0.466,-0.342,0.488,-0.314,0.516,-0.28,0.514,-0.304,0.539,-0.296,0.543,-0.322,0.551,-0.35,0.539,-0.347,0.53,-0.332,0.536,-0.328,0.527,-0.364,0.531,-0.398,0.535,-0.418,0.547,-0.429,0.584,-0.433,0.589,-0.459,0.587,-0.449,0.568,-0.474,0.583,-0.471,0.595,-0.466,0.605,-0.454,0.631,-0.439,0.649,-0.39,0.649,-0.376,0.659,-0.379,0.665,-0.399,0.677,-0.4,0.677],[1,0.061,0.66,0.061,0.657,0.071,0.656,0.086,0.656,0.083,0.649,0.065,0.652,0.053,0.656,0.049,0.661,0.052,0.653,0.07,0.638,0.089,0.651,0.084,0.657,0.072,0.656,0.062,0.661],[1,-0.055,0.653,-0.068,0.651,-0.067,0.636,-0.07,0.629,-0.071,0.621,-0.065,0.593,-0.064,0.602,-0.066,0.609,-0.065,0.618,-0.063,0.62,-0.065,0.632,-0.056,0.623,-0.054,0.639,-0.049,0.652,-0.053,0.654],[1,0.124,0.629,0.121,0.621,0.128,0.619,0.145,0.605,0.113,0.604,0.088,0.603,0.11,0.588,0.103,0.579,0.131,0.581,0.174,0.572,0.165,0.591,0.169,0.588,0.153,0.592,0.149,0.617,0.139,0.628,0.125,0.63],[1,-0.356,0.625,-0.369,0.623,-0.372,0.612,-0.347,0.603,-0.332,0.594,-0.304,0.585,-0.294,0.574,-0.298,0.57,-0.285,0.561,-0.281,0.57,-0.259,0.571,-0.252,0.56,-0.27,0.555,-0.255,0.564,-0.268,0.573,-0.3,0.578,-0.308,0.589,-0.315,0.6,-0.318,0.595,-0.334,0.601,-0.349,0.619,-0.352,0.625],[1,0.445,0.611,0.428,0.594,0.429,0.575,0.469,0.577,0.477,0.537,0.465,0.501,0.468,0.499,0.499,0.481,0.463,0.466,0.462,0.457,0.437,0.435,0.411,0.435,0.374,0.414,0.3,0.397,0.283,0.407,0.284,0.39,0.252,0.34,0.258,0.356,0.238,0.342,0.221,0.353,0.255,0.354,0.213,0.351,0.19,0.347,0.181,0.354,0.173,0.36,0.18,0.34,0.28,0.342,0.315,0.398,0.377,0.407,0.409,0.431,0.452,0.443,0.497,0.476,0.478,0.512,0.481,0.544,0.468,0.58,0.423,0.579,0.43,0.597,0.446,0.612],[1,-0.046,0.601,-0.06,0.565,-0.045,0.561,-0.035,0.566,-0.037,0.558,-0.038,0.552,-0.016,0.566,-0.025,0.573,-0.046,0.572,-0.027,0.584,-0.03,0.585,-0.038,0.598,-0.045,0.602],[1,0.143,0.514,0.141,0.509,0.155,0.512,0.15,0.51,0.124,0.509,0.086,0.51,0.071,0.508,0.065,0.499,0.079,0.494,0.092,0.487,0.091,0.481,0.106,0.485,0.112,0.493,0.132,0.505,0.161,0.507,0.143,0.515],[1,-0.082,0.486,-0.111,0.467,-0.127,0.466,-0.131,0.437,-0.13,0.446,-0.113,0.459,-0.087,0.467,-0.069,0.452,-0.061,0.462,-0.053,0.474,-0.044,0.47,-0.056,0.477,-0.068,0.461,-0.104,0.467,-0.084,0.474,-0.073,0.484,-0.08,0.487],[1,0.205,0.471,0.188,0.466,0.204,0.46,0.186,0.45,0.188,0.454,0.17,0.452,0.215,0.454,0.23,0.456,0.232,0.461,0.219,0.458,0.206,0.469,0.206,0.471],[1,0.028,0.466,0.042,0.447,0.052,0.45,0.068,0.444,0.064,0.44,0.057,0.445,0.065,0.436,0.058,0.435,0.057,0.428,0.068,0.446,0.069,0.456,0.052,0.456,0.031,0.461,0.029,0.466],[1,0.237,0.452,0.218,0.45,0.193,0.439,0.211,0.436,0.222,0.441,0.236,0.447,0.24,0.452,0.238,0.453],[1,-0.194,0.453,-0.197,0.447,-0.208,0.438,-0.23,0.437,-0.2,0.434,-0.181,0.422,-0.156,0.422,-0.181,0.438,-0.178,0.431,-0.158,0.423,-0.187,0.424,-0.203,0.444,-0.188,0.451,-0.182,0.443,-0.193,0.453],[1,0.146,0.442,0.129,0.425,0.121,0.415,0.135,0.411,0.148,0.418,0.158,0.408,0.167,0.415,0.167,0.417,0.168,0.428,0.164,0.431,0.163,0.433,0.144,0.428,0.15,0.44,0.147,0.443],[1,0.272,0.437,0.258,0.432,0.226,0.434,0.233,0.431,0.256,0.427,0.268,0.434,0.288,0.431,0.297,0.422,0.291,0.427,0.279,0.422,0.284,0.424,0.302,0.425,0.289,0.433,0.275,0.437,0.274,0.437],[1,-0.336,0.426,-0.33,0.406,-0.291,0.406,-0.277,0.399,-0.263,0.384,-0.288,0.391,-0.336,0.391,-0.349,0.395,-0.378,0.394,-0.361,0.398,-0.351,0.394,-0.339,0.387,-0.315,0.387,-0.289,0.389,-0.271,0.379,-0.277,0.388,-0.282,0.404,-0.314,0.406,-0.33,0.408,-0.347,0.419,-0.336,0.427],[1,-0.102,0.405,-0.136,0.394,-0.127,0.387,-0.104,0.395,-0.154,0.386,-0.208,0.386,-0.205,0.383,-0.167,0.385,-0.104,0.393,-0.131,0.374,-0.159,0.371,-0.199,0.372,-0.23,0.361,-0.251,0.345,-0.219,0.339,-0.185,0.343,-0.162,0.35,-0.123,0.345,-0.122,0.344,-0.112,0.344,-0.155,0.345,-0.172,0.347,-0.2,0.342,-0.227,0.344,-0.246,0.346,-0.235,0.353,-0.206,0.357,-0.195,0.373,-0.167,0.373,-0.163,0.368,-0.132,0.364,-0.123,0.373,-0.106,0.365,-0.103,0.382,-0.094,0.394,-0.101,0.405],[1,0.04,0.403,0.043,0.394,0.054,0.364,0.068,0.379,0.051,0.387,0.045,0.393,0.042,0.403,0.04,0.403],[1,-0.226,0.393,-0.246,0.382,-0.244,0.372,-0.266,0.369,-0.271,0.358,-0.286,0.361,-0.281,0.372,-0.295,0.36,-0.261,0.357,-0.248,0.37,-0.235,0.383,-0.225,0.393],[1,-0.39,0.391,-0.381,0.378,-0.356,0.374,-0.337,0.368,-0.301,0.373,-0.272,0.374,-0.312,0.375,-0.337,0.37,-0.362,0.376,-0.387,0.385,-0.384,0.392,-0.389,0.392],[1,0.013,0.384,-0.017,0.38,-0.013,0.377,-0.005,0.369,-0.007,0.347,0.037,0.347,0.03,0.383,0.016,0.385],[1,0.154,0.381,0.106,0.364,0.044,0.34,-0.063,0.361,-0.104,0.357,-0.108,0.338,-0.098,0.356,-0.077,0.362,-0.077,0.366,-0.022,0.34,-0.057,0.357,-0.072,0.349,-0.034,0.342,-0.06,0.336,-0.063,0.347,-0.063,0.341,-0.022,0.325,0.001,0.254,0.01,0.144,0.05,0.014,0.031,0.203,0.083,0.364,0.149,0.349,0.137,0.363,0.172,0.378,0.18,0.37,0.157,0.381]];
const TREE_ASPECT = 0.685; // width/height ratio of original tree

// ============================================================
// INTERPOLATE ELEVATION AT DISTANCE
// ============================================================
function elevationAtDist(d) {
    if (!elevationData || elevationData.length < 2) return 0;
    for (let i = 0; i < elevationData.length - 1; i++) {
        if (d >= elevationData[i].dist && d <= elevationData[i + 1].dist) {
            const t = (d - elevationData[i].dist) / (elevationData[i + 1].dist - elevationData[i].dist);
            return elevationData[i].z + t * (elevationData[i + 1].z - elevationData[i].z);
        }
    }
    return d <= elevationData[0].dist ? elevationData[0].z : elevationData[elevationData.length - 1].z;
}

// ============================================================
// GENERATE DXF
// ============================================================
function generateDXF(useOSM) {
    _h = 1; // reset handle counter
    const gridEl = document.getElementById('gridToggle');
    const showGrid = gridEl ? gridEl.checked : true;

    const vScale = parseFloat(document.getElementById('vScale').value) || 2;
    const hGrid = parseInt(document.getElementById('hGrid').value) || 200;
    const vGrid = 10;

    const dists = elevationData.map(p => p.dist);
    const elevs = elevationData.map(p => p.z);
    const maxDist = Math.max(...dists);
    const minElev = Math.min(...elevs);
    const maxElev = Math.max(...elevs);
    const refElev = Math.floor(minElev / 10) * 10;
    const topElev = (Math.floor(maxElev / 10) + 1) * 10;
    const yTop = (topElev - refElev) * vScale;
    const thickness = 0.5; // 50cm

    // Text sizes proportional to drawing height (not maxDist!)
    const txt_h = yTop * 0.015;        // grid labels
    const txt_h_small = yTop * 0.012;  // small labels
    const txt_h_title = yTop * 0.025;  // title
    const markerR = yTop * 0.008;      // marker radius
    const margin = yTop * 0.03;        // offset margin

    const layerNames = ['0', 'PROFILE', 'PROFILE_BODY', 'TERRAIN_FILL', 'TERRAIN_WHITE', 'TERRAIN_OUTLINE', 'GRID', 'AXIS', 'TEXT', 'POINTS', 'BUILDINGS', 'TREES', 'PLAN_3D'];
    const layerColors = {
        '0': 7, 'PROFILE': 250, 'PROFILE_BODY': 250, 'TERRAIN_FILL': 250,
        'TERRAIN_WHITE': 255, 'GRID': 9, 'AXIS': 7, 'TEXT': 7, 'POINTS': 3,
        'TERRAIN_OUTLINE': 250, 'BUILDINGS': 8, 'TREES': 3, 'PLAN_3D': 5
    };

    let dxf = '';
    const w = (s) => { dxf += s + '\n'; };
    const pair = (code, val) => { w(String(code)); w(String(val)); };

    // ===================== HEADER =====================
    pair(0, 'SECTION'); pair(2, 'HEADER');
    pair(9, '$ACADVER'); pair(1, 'AC1015');
    pair(9, '$HANDSEED'); pair(5, 'FFFF');
    pair(9, '$INSUNITS'); pair(70, 6); // meters
    pair(9, '$MEASUREMENT'); pair(70, 1);
    pair(9, '$EXTMIN');
    pair(10, -margin * 3); pair(20, -margin * 3); pair(30, -thickness);
    pair(9, '$EXTMAX');
    pair(10, maxDist + margin * 3); pair(20, yTop + margin * 3); pair(30, 0);
    pair(0, 'ENDSEC');

    // ===================== TABLES =====================
    pair(0, 'SECTION'); pair(2, 'TABLES');

    // --- VPORT ---
    pair(0, 'TABLE'); pair(2, 'VPORT'); pair(5, H()); pair(100, 'AcDbSymbolTable'); pair(70, 1);
    pair(0, 'VPORT'); pair(5, H()); pair(100, 'AcDbSymbolTableRecord'); pair(100, 'AcDbViewportTableRecord');
    pair(2, '*ACTIVE'); pair(70, 0);
    pair(10, 0); pair(20, 0);
    pair(11, 1); pair(21, 1);
    pair(12, maxDist / 2); pair(22, yTop / 2);
    pair(40, yTop * 1.2);
    pair(0, 'ENDTAB');

    // --- LTYPE ---
    pair(0, 'TABLE'); pair(2, 'LTYPE'); pair(5, H()); pair(100, 'AcDbSymbolTable'); pair(70, 3);
    for (const lt of [['ByBlock',''], ['ByLayer',''], ['CONTINUOUS','Solid line']]) {
        pair(0, 'LTYPE'); pair(5, H()); pair(100, 'AcDbSymbolTableRecord'); pair(100, 'AcDbLinetypeTableRecord');
        pair(2, lt[0]); pair(70, 0); pair(3, lt[1]); pair(72, 65); pair(73, 0); pair(40, 0);
    }
    pair(0, 'ENDTAB');

    // --- LAYER ---
    pair(0, 'TABLE'); pair(2, 'LAYER'); pair(5, H()); pair(100, 'AcDbSymbolTable'); pair(70, layerNames.length);
    for (const ln of layerNames) {
        pair(0, 'LAYER'); pair(5, H());
        pair(100, 'AcDbSymbolTableRecord'); pair(100, 'AcDbLayerTableRecord');
        pair(2, ln); pair(70, 0); pair(62, layerColors[ln]); pair(6, 'CONTINUOUS');
        pair(370, -3);
    }
    pair(0, 'ENDTAB');

    // --- STYLE ---
    pair(0, 'TABLE'); pair(2, 'STYLE'); pair(5, H()); pair(100, 'AcDbSymbolTable'); pair(70, 1);
    pair(0, 'STYLE'); pair(5, H()); pair(100, 'AcDbSymbolTableRecord'); pair(100, 'AcDbTextStyleTableRecord');
    pair(2, 'Standard'); pair(70, 0); pair(40, 0); pair(41, 1); pair(50, 0); pair(71, 0);
    pair(42, 2.5); pair(3, 'txt'); pair(4, '');
    pair(0, 'ENDTAB');

    // --- APPID ---
    pair(0, 'TABLE'); pair(2, 'APPID'); pair(5, H()); pair(100, 'AcDbSymbolTable'); pair(70, 1);
    pair(0, 'APPID'); pair(5, H()); pair(100, 'AcDbSymbolTableRecord'); pair(100, 'AcDbRegAppTableRecord');
    pair(2, 'ACAD'); pair(70, 0);
    pair(0, 'ENDTAB');

    // --- DIMSTYLE ---
    pair(0, 'TABLE'); pair(2, 'DIMSTYLE'); pair(5, H()); pair(100, 'AcDbSymbolTable'); pair(70, 0);
    pair(100, 'AcDbDimStyleTable');
    pair(0, 'ENDTAB');

    // --- BLOCK_RECORD ---
    pair(0, 'TABLE'); pair(2, 'BLOCK_RECORD'); pair(5, H()); pair(100, 'AcDbSymbolTable'); pair(70, 2);
    pair(0, 'BLOCK_RECORD'); pair(5, H()); pair(100, 'AcDbSymbolTableRecord'); pair(100, 'AcDbBlockTableRecord');
    pair(2, '*MODEL_SPACE');
    pair(0, 'BLOCK_RECORD'); pair(5, H()); pair(100, 'AcDbSymbolTableRecord'); pair(100, 'AcDbBlockTableRecord');
    pair(2, '*PAPER_SPACE');
    pair(0, 'ENDTAB');

    pair(0, 'ENDSEC');

    // ===================== BLOCKS =====================
    pair(0, 'SECTION'); pair(2, 'BLOCKS');
    pair(0, 'BLOCK'); pair(5, H()); pair(100, 'AcDbEntity'); pair(8, '0'); pair(100, 'AcDbBlockBegin');
    pair(2, '*MODEL_SPACE'); pair(70, 0); pair(10, 0); pair(20, 0); pair(30, 0); pair(3, '*MODEL_SPACE'); pair(1, '');
    pair(0, 'ENDBLK'); pair(5, H()); pair(100, 'AcDbEntity'); pair(8, '0'); pair(100, 'AcDbBlockEnd');
    pair(0, 'BLOCK'); pair(5, H()); pair(100, 'AcDbEntity'); pair(8, '0'); pair(100, 'AcDbBlockBegin');
    pair(2, '*PAPER_SPACE'); pair(70, 0); pair(10, 0); pair(20, 0); pair(30, 0); pair(3, '*PAPER_SPACE'); pair(1, '');
    pair(0, 'ENDBLK'); pair(5, H()); pair(100, 'AcDbEntity'); pair(8, '0'); pair(100, 'AcDbBlockEnd');
    pair(0, 'ENDSEC');

    // ===================== ENTITIES =====================
    pair(0, 'SECTION'); pair(2, 'ENTITIES');

    if (showGrid) {
        // --- Grid: horizontal lines (elevation) ---
        for (let elev = refElev; elev <= topElev; elev += vGrid) {
            const y = (elev - refElev) * vScale;
            dxf += dxfLine(0, y, maxDist, y, 'GRID');
            dxf += dxfText(`${elev} m`, -margin * 1.5, y - txt_h_small * 0.3, txt_h_small, 'TEXT');
        }

        // --- Grid: vertical lines (distance) ---
        for (let d = 0; d <= maxDist; d += hGrid) {
            dxf += dxfLine(d, 0, d, yTop, 'GRID');
            dxf += dxfText(`${d} m`, d, -margin, txt_h_small, 'TEXT');
        }

        // --- Axes ---
        dxf += dxfLine(0, 0, maxDist, 0, 'AXIS');
        dxf += dxfLine(0, 0, 0, yTop, 'AXIS');
    }

    // --- Terrain Fill (black): shifted 1m up behind white ---
    const yShift = 1.0 * vScale;
    for (let i = 0; i < elevationData.length - 1; i++) {
        const d1 = elevationData[i].dist;
        const d2 = elevationData[i + 1].dist;
        const y1 = (elevationData[i].z - refElev) * vScale + yShift;
        const y2 = (elevationData[i + 1].z - refElev) * vScale + yShift;
        dxf += dxfFilledFace(d1, 0, d2, 0, d1, y1, d2, y2, 'TERRAIN_FILL');
    }

    // --- Terrain White: on top, same shape as original profile ---
    for (let i = 0; i < elevationData.length - 1; i++) {
        const d1 = elevationData[i].dist;
        const d2 = elevationData[i + 1].dist;
        const y1 = (elevationData[i].z - refElev) * vScale;
        const y2 = (elevationData[i + 1].z - refElev) * vScale;
        dxf += dxfFilledFace(d1, 0, d2, 0, d1, y1, d2, y2, 'TERRAIN_WHITE');
    }

    // --- Terrain outline: closed polyline ---
    const fillPts = elevationData.map(p => [p.dist, (p.z - refElev) * vScale]);
    fillPts.push([maxDist, 0]);
    fillPts.push([0, 0]);
    dxf += dxfPolyline2D(fillPts, 'TERRAIN_OUTLINE', true);

    // --- 50cm thick 3DFACE extrusion of profile ---
    for (let i = 0; i < elevationData.length - 1; i++) {
        const d1 = elevationData[i].dist;
        const d2 = elevationData[i + 1].dist;
        const y1 = (elevationData[i].z - refElev) * vScale;
        const y2 = (elevationData[i + 1].z - refElev) * vScale;
        // Top surface ribbon (profile extruded in z)
        dxf += dxf3DFace(d1, y1, 0, d2, y2, 0, d2, y2, -thickness, d1, y1, -thickness, 'PROFILE_BODY');
        // Bottom fill quad (terrain body at z=0)
        dxf += dxf3DFace(d1, 0, 0, d2, 0, 0, d2, y2, 0, d1, y1, 0, 'TERRAIN_FILL');
        // Back face (terrain body at z=-thickness)
        dxf += dxf3DFace(d1, 0, -thickness, d2, 0, -thickness, d2, y2, -thickness, d1, y1, -thickness, 'TERRAIN_FILL');
    }
    // Bottom face ribbon
    dxf += dxf3DFace(0, 0, 0, maxDist, 0, 0, maxDist, 0, -thickness, 0, 0, -thickness, 'TERRAIN_FILL');

    // --- OSM BUILDINGS ---
    console.log('DXF export — useOSM:', useOSM, '| osmBuildings:', osmBuildings.length, '| osmTrees:', osmTrees.length);
    if (useOSM && osmBuildings.length > 0) {
        for (const bldg of osmBuildings) {
            const bStartElev = elevationAtDist(bldg.startDist);
            const bEndElev = elevationAtDist(bldg.endDist);
            const w1 = bldg.startDist, w2 = bldg.endDist;
            const yb1 = (bStartElev - refElev) * vScale;
            const yb2 = (bEndElev - refElev) * vScale;
            const ht = bldg.height * vScale;

            // Building outline (closed polyline)
            dxf += dxfPolyline2D([
                [w1, yb1], [w2, yb2], [w2, yb2 + ht], [w1, yb1 + ht]
            ], 'BUILDINGS', true);

            // 3DFACE for building front face
            dxf += dxf3DFace(w1, yb1, 0, w2, yb2, 0, w2, yb2 + ht, 0, w1, yb1 + ht, 0, 'BUILDINGS');

            // Building label
            if (bldg.name) {
                dxf += dxfText(bldg.name, (w1 + w2) / 2, Math.max(yb1, yb2) + ht + txt_h_small, txt_h_small, 'TEXT');
            }
            // Height label
            dxf += dxfText(`${bldg.height}m`, (w1 + w2) / 2, Math.max(yb1, yb2) + ht * 0.5, txt_h_small * 0.8, 'BUILDINGS');
        }
    }

    // --- OSM TREES (from tree.dxf silhouette data) ---
    if (useOSM && osmTrees.length > 0) {
        const treeH_real = 6; // fixed 6m height for all trees
        for (const tree of osmTrees) {
            const tElev = elevationAtDist(tree.dist);
            const yBase = (tElev - refElev) * vScale;
            const h = treeH_real * vScale;
            const w = h * TREE_ASPECT;
            const cx = tree.dist;

            // Draw each polyline from TREE_DATA, scaled and positioned
            for (const poly of TREE_DATA) {
                const closed = poly[0] === 1;
                const pts = [];
                for (let k = 1; k < poly.length; k += 2) {
                    const px = cx + poly[k] * w;
                    const py = yBase + poly[k + 1] * h;
                    pts.push([px, py]);
                }
                dxf += dxfPolyline2D(pts, 'TREES', closed);
            }
        }
    }

    // --- Min / Max markers ---
    const minIdx = elevs.indexOf(minElev);
    const maxIdx = elevs.indexOf(maxElev);
    for (const [idx, label] of [[minIdx, `Min: ${minElev.toFixed(1)} m`], [maxIdx, `Max: ${maxElev.toFixed(1)} m`]]) {
        const d = dists[idx], z = elevs[idx];
        const y = (z - refElev) * vScale;
        dxf += dxfCircle(d, y, markerR, 'POINTS');
        dxf += dxfText(label, d + markerR * 1.5, y + markerR, txt_h_small, 'TEXT');
    }

    // --- Title ---
    dxf += dxfText('PROFIL ALTIMETRIQUE - COUPEMAP',
        maxDist / 2, yTop + margin * 1.5, txt_h_title, 'TEXT');
    dxf += dxfText(
        `Echelle H: 1/1  |  Exag. V: x${vScale}  |  Distance: ${maxDist.toFixed(1)} m`,
        maxDist / 2, yTop + margin * 0.7, txt_h_small, 'TEXT');

    if (useOSM && (osmBuildings.length > 0 || osmTrees.length > 0)) {
        dxf += dxfText(
            `OSM: ${osmBuildings.length} batiments, ${osmTrees.length} arbres`,
            maxDist / 2, yTop + margin * 0.2, txt_h_small * 0.8, 'TEXT');
    }

    // --- Credentials ---
    dxf += dxfText('Ozan Dev - ozantokman.com',
        maxDist / 2, -margin * 2.5, txt_h_small, 'TEXT');

    // --- 3D Polyline (actual geographic coordinates) ---
    const latRef = elevationData[0].lat;
    const lonRef = elevationData[0].lon;
    const mPerDegLat = 111320;
    const mPerDegLon = 111320 * Math.cos(latRef * Math.PI / 180);

    const pts3d = elevationData.map(p => [
        (p.lon - lonRef) * mPerDegLon + maxDist + 500,
        (p.lat - latRef) * mPerDegLat,
        p.z
    ]);
    dxf += dxfPolyline3D(pts3d, 'PLAN_3D');

    pair(0, 'ENDSEC');

    // ===================== OBJECTS =====================
    pair(0, 'SECTION'); pair(2, 'OBJECTS');
    pair(0, 'DICTIONARY'); pair(5, H()); pair(100, 'AcDbDictionary');
    pair(0, 'ENDSEC');

    pair(0, 'EOF');

    // Download
    const blob = new Blob([dxf], { type: 'application/dxf' });
    downloadBlob(blob, buildExportFilename('dxf'));

    let msg = 'DXF téléchargé!';
    if (useOSM) msg += ` (${osmBuildings.length} bâtiments, ${osmTrees.length} arbres)`;
    showToast(msg, 'success');
}

// ============================================================
// DXF HELPER FUNCTIONS (with handles + subclass markers)
// ============================================================

function dxfLine(x1, y1, x2, y2, layer) {
    return `0\nLINE\n5\n${H()}\n100\nAcDbEntity\n8\n${layer}\n100\nAcDbLine\n` +
        `10\n${x1}\n20\n${y1}\n30\n0\n` +
        `11\n${x2}\n21\n${y2}\n31\n0\n`;
}

function dxfText(text, x, y, height, layer) {
    return `0\nTEXT\n5\n${H()}\n100\nAcDbEntity\n8\n${layer}\n100\nAcDbText\n` +
        `10\n${x}\n20\n${y}\n30\n0\n` +
        `40\n${height}\n1\n${text}\n`;
}

function dxfCircle(x, y, r, layer) {
    return `0\nCIRCLE\n5\n${H()}\n100\nAcDbEntity\n8\n${layer}\n100\nAcDbCircle\n` +
        `10\n${x}\n20\n${y}\n30\n0\n40\n${r}\n`;
}

function dxfPolyline2D(points, layer, closed) {
    let s = `0\nLWPOLYLINE\n5\n${H()}\n100\nAcDbEntity\n8\n${layer}\n100\nAcDbPolyline\n` +
            `90\n${points.length}\n70\n${closed ? 1 : 0}\n43\n0\n`;
    for (const [x, y] of points) {
        s += `10\n${x}\n20\n${y}\n`;
    }
    return s;
}

function dxfSolid(x1,y1, x2,y2, x3,y3, x4,y4, layer) {
    return `0\nSOLID\n5\n${H()}\n100\nAcDbEntity\n8\n${layer}\n100\nAcDbTrace\n` +
        `10\n${x1}\n20\n${y1}\n30\n0\n` +
        `11\n${x2}\n21\n${y2}\n31\n0\n` +
        `12\n${x3}\n22\n${y3}\n32\n0\n` +
        `13\n${x4}\n23\n${y4}\n33\n0\n`;
}

function dxfFilledFace(x1,y1, x2,y2, x3,y3, x4,y4, layer) {
    return `0\n3DFACE\n5\n${H()}\n100\nAcDbEntity\n8\n${layer}\n100\nAcDbFace\n` +
        `10\n${x1}\n20\n${y1}\n30\n0\n` +
        `11\n${x2}\n21\n${y2}\n31\n0\n` +
        `12\n${x3}\n22\n${y3}\n32\n0\n` +
        `13\n${x4}\n23\n${y4}\n33\n0\n` +
        `70\n15\n`;
}

function dxf3DFace(x1,y1,z1, x2,y2,z2, x3,y3,z3, x4,y4,z4, layer) {
    return `0\n3DFACE\n5\n${H()}\n100\nAcDbEntity\n8\n${layer}\n100\nAcDbFace\n` +
        `10\n${x1}\n20\n${y1}\n30\n${z1}\n` +
        `11\n${x2}\n21\n${y2}\n31\n${z2}\n` +
        `12\n${x3}\n22\n${y3}\n32\n${z3}\n` +
        `13\n${x4}\n23\n${y4}\n33\n${z4}\n`;
}

function dxfPolyline3D(points, layer) {
    let s = `0\nPOLYLINE\n5\n${H()}\n100\nAcDbEntity\n8\n${layer}\n100\nAcDb3dPolyline\n66\n1\n70\n8\n` +
            `10\n0\n20\n0\n30\n0\n`;
    for (const [x, y, z] of points) {
        s += `0\nVERTEX\n5\n${H()}\n100\nAcDbEntity\n8\n${layer}\n100\nAcDbVertex\n100\nAcDb3dPolylineVertex\n` +
             `10\n${x}\n20\n${y}\n30\n${z}\n70\n32\n`;
    }
    s += `0\nSEQEND\n5\n${H()}\n100\nAcDbEntity\n8\n${layer}\n`;
    return s;
}

// ============================================================
// CSV EXPORT
// ============================================================
document.getElementById('btnCsv').addEventListener('click', () => {
    if (!elevationData) { showToast('Pas de données', 'error'); return; }
    let csv = 'Distance_m,Longitude,Latitude,Altitude_m\n';
    for (const p of elevationData) {
        csv += `${p.dist.toFixed(2)},${p.lon},${p.lat},${p.z}\n`;
    }
    downloadBlob(new Blob([csv], { type: 'text/csv' }), buildExportFilename('csv'));
    showToast('CSV téléchargé', 'success');
});

// ============================================================
// REVERSE GEOCODE (French gov API)
// ============================================================
async function reverseGeocode(lat, lon) {
    try {
        const url = `https://api-adresse.data.gouv.fr/reverse/?lon=${lon}&lat=${lat}&limit=1`;
        const res = await fetch(url);
        if (!res.ok) return null;
        const data = await res.json();
        if (data.features && data.features.length > 0) {
            const props = data.features[0].properties;
            return props.city || props.name || null;
        }
    } catch (e) { console.warn('Reverse geocode failed:', e); }
    return null;
}

function buildExportFilename(ext) {
    const mid = Math.floor(drawnCoords.length / 2);
    const lat = drawnCoords[mid][0].toFixed(4);
    const lon = drawnCoords[mid][1].toFixed(4);
    const base = cachedLocationName
        ? `coupe_map_${cachedLocationName}_${lat}_${lon}`
        : `coupe_map_${lat}_${lon}`;
    // Sanitize for filesystem: keep alphanumeric, dots, underscores, hyphens
    return base.replace(/[^a-zA-Z0-9._-]/g, '_') + '.' + ext;
}

// ============================================================
// UTILITIES
// ============================================================
function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2 +
              Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) *
              Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function showLoading(show) {
    document.getElementById('loading').classList.toggle('active', show);
}

function showToast(msg, type) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = `toast ${type} show`;
    setTimeout(() => t.classList.remove('show'), 3000);
}

// ============================================================
// STEP WORKFLOW — lock/unlock sidebar steps based on state
// ============================================================
function updateStepStates() {
    const hasLine = drawnCoords.length >= 2;
    const hasProfile = elevationData !== null && elevationData.length > 0;

    // Step 1: always active, collapse content when line exists
    const step1 = document.getElementById('step1');
    const s1check = document.querySelector('#step1 .step-check');
    if (s1check) s1check.textContent = hasLine ? '✅' : '';
    if (step1) step1.classList.toggle('step-collapsed', hasLine);

    // Step 2: locked until line exists, collapse when profile loaded
    const step2 = document.getElementById('step2');
    if (step2) {
        step2.classList.toggle('step-locked', !hasLine);
        step2.classList.toggle('step-collapsed', hasProfile);
        const s2check = step2.querySelector('.step-check');
        if (s2check) s2check.textContent = hasProfile ? '✅' : '';
    }

    // Step 3: hidden until profile loaded
    const step3 = document.getElementById('step3');
    if (step3) {
        const wasHidden = step3.classList.contains('is-hidden');
        step3.classList.toggle('is-hidden', !hasProfile);
        // Scroll into view when first revealed
        if (wasHidden && hasProfile) {
            setTimeout(() => step3.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100);
        }
    }

    // Step 4: hidden until OSM data loaded (or user can skip via DXF button auto-fetch)
    const step4 = document.getElementById('step4');
    if (step4) step4.classList.toggle('is-hidden', !hasProfile || !osmDataLoaded);

    // Enable/disable OSM button
    const btnOSM = document.getElementById('btnFetchOSM');
    if (btnOSM) btnOSM.disabled = !hasProfile;
}

// Skip OSM — reveal Step 4 directly
document.getElementById('btnSkipOSM').addEventListener('click', function() {
    const step4 = document.getElementById('step4');
    if (step4) {
        step4.classList.remove('is-hidden');
        setTimeout(() => step4.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100);
    }
});

// Click collapsed step header to expand it
document.querySelectorAll('.step-header').forEach(header => {
    header.addEventListener('click', function() {
        const step = this.closest('.step');
        if (step && step.classList.contains('step-collapsed')) {
            step.classList.remove('step-collapsed');
        }
    });
});
