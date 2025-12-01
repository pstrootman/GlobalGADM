/**
 * Global Administrative Boundaries Explorer
 * Uses MapLibre GL JS and PMTiles
 */

// Global state
let map;
let protocol;
let currentCountry = null;
let activeLevel = 0;
let countriesData = null;

// Styling configuration
const STYLES = {
    0: { color: '#FFD700', fill: 'transparent', width: 2, opacity: 0 },
    1: { color: '#00FFFF', fill: '#00FFFF', width: 1, opacity: 0.15 },
    2: { color: '#FF00FF', fill: '#FF00FF', width: 1, opacity: 0.15 },
    3: { color: '#FF6600', fill: '#FF6600', width: 1, opacity: 0.15 },
    4: { color: '#00FF00', fill: '#00FF00', width: 1, opacity: 0.15 },
    5: { color: '#00FF00', fill: '#00FF00', width: 1, opacity: 0.15 }
};

// Initialize the application
async function init() {
    // Initialize PMTiles protocol
    protocol = new pmtiles.Protocol();
    maplibregl.addProtocol("pmtiles", protocol.tile);

    // Initialize map
    initMap();

    // Load countries metadata
    await loadCountriesMetadata();

    // Set up event listeners
    setupEventListeners();
}

// Initialize MapLibre map
function initMap() {
    map = new maplibregl.Map({
        container: 'map',
        style: {
            version: 8,
            sources: {
                'carto-dark': {
                    type: 'raster',
                    tiles: [
                        'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
                        'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
                        'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
                        'https://d.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png'
                    ],
                    tileSize: 256,
                    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
                }
            },
            layers: [
                {
                    id: 'basemap',
                    type: 'raster',
                    source: 'carto-dark',
                    minzoom: 0,
                    maxzoom: 20
                }
            ]
        },
        center: [0, 20],
        zoom: 2
    });

    map.addControl(new maplibregl.NavigationControl(), 'bottom-right');

    map.on('load', () => {
        // Add Level 0 (Countries) source and layer by default
        addLevelLayer(0, true);
    });
}

// Add a PMTiles source and layer for a specific admin level
function addLevelLayer(level, isVisible = false) {
    const sourceId = `gadm-level${level}`;
    
    if (!map.getSource(sourceId)) {
        map.addSource(sourceId, {
            type: 'vector',
            url: `pmtiles://https://pub-381407fb739040e09035a4fb8219a3af.r2.dev/gadm_level${level}.pmtiles`,
            attribution: 'GADM'
        });
    }

    // Line layer (borders)
    const lineLayerId = `layer-line-${level}`;
    if (!map.getLayer(lineLayerId)) {
        map.addLayer({
            id: lineLayerId,
            type: 'line',
            source: sourceId,
            'source-layer': level === 0 ? 'countries' : `admin${level}`, // Adjust based on tippecanoe layer name
            layout: {
                'visibility': isVisible ? 'visible' : 'none'
            },
            paint: {
                'line-color': STYLES[level].color,
                'line-width': STYLES[level].width
            }
        });
    }

    // Fill layer (interactive)
    const fillLayerId = `layer-fill-${level}`;
    if (!map.getLayer(fillLayerId)) {
        map.addLayer({
            id: fillLayerId,
            type: 'fill',
            source: sourceId,
            'source-layer': level === 0 ? 'countries' : `admin${level}`,
            layout: {
                'visibility': isVisible ? 'visible' : 'none'
            },
            paint: {
                'fill-color': STYLES[level].fill,
                'fill-opacity': STYLES[level].opacity,
                'fill-outline-color': STYLES[level].color
            }
        }, lineLayerId); // Place fill below line

        // Interactions
        map.on('click', fillLayerId, (e) => handleFeatureClick(e, level));
        map.on('mouseenter', fillLayerId, () => map.getCanvas().style.cursor = 'pointer');
        map.on('mouseleave', fillLayerId, () => map.getCanvas().style.cursor = '');
    }
}

// Toggle layer visibility
function setLayerVisibility(level, isVisible) {
    const visibility = isVisible ? 'visible' : 'none';
    
    if (map.getLayer(`layer-line-${level}`)) {
        map.setLayoutProperty(`layer-line-${level}`, 'visibility', visibility);
    }
    if (map.getLayer(`layer-fill-${level}`)) {
        map.setLayoutProperty(`layer-fill-${level}`, 'visibility', visibility);
    }
}

// Load countries metadata
async function loadCountriesMetadata() {
    try {
        const response = await fetch('data/countries.json');
        const data = await response.json();
        countriesData = data.countries;

        // Populate country dropdown
        const select = document.getElementById('country-select');
        countriesData
            .sort((a, b) => a.name.localeCompare(b.name))
            .forEach(country => {
                const option = document.createElement('option');
                option.value = country.name;
                option.textContent = country.name;
                select.appendChild(option);
            });
            
    } catch (error) {
        console.error('Failed to load countries:', error);
        alert('Failed to load country list. Please ensure data/countries.json exists.');
    }
}

// Set up event listeners
function setupEventListeners() {
    document.getElementById('country-select').addEventListener('change', handleCountryChange);
    document.getElementById('reset-view').addEventListener('click', () => {
        map.flyTo({ center: [0, 20], zoom: 2 });
        document.getElementById('country-select').value = '';
        resetAdminLevels();
    });
}

// Handle country selection
function handleCountryChange(event) {
    const countryName = event.target.value;
    if (!countryName) return;

    const country = countriesData.find(c => c.name === countryName);
    if (country) {
        currentCountry = country;
        
        // Fly to country
        map.fitBounds([
            [country.bounds[0], country.bounds[1]], // sw
            [country.bounds[2], country.bounds[3]]  // ne
        ], { padding: 50 });

        // Update UI for admin levels
        updateAdminLevelUI(country);
    }
}

// Update Admin Level Buttons
function updateAdminLevelUI(country) {
    const container = document.getElementById('admin-levels-container');
    const buttonsDiv = document.getElementById('admin-level-buttons');
    const infoDiv = document.getElementById('level-info');
    
    container.style.display = 'flex';
    buttonsDiv.innerHTML = '';
    infoDiv.textContent = `This country has ${country.admin_levels.length} administrative levels.`;

    // Always show Level 0
    createLevelButton(0, 'Country Boundary', true);

    // Show available levels
    country.admin_levels.forEach(level => {
        createLevelButton(level, `Level ${level}`);
    });
}

function createLevelButton(level, label, active = false) {
    const btn = document.createElement('button');
    btn.className = `admin-level-btn ${active ? 'active' : ''}`;
    btn.textContent = label;
    btn.onclick = () => {
        // Toggle active state
        const isActive = btn.classList.toggle('active');
        
        // Ensure source/layer exists
        addLevelLayer(level, isActive);
        
        // Toggle visibility
        setLayerVisibility(level, isActive);
    };
    
    document.getElementById('admin-level-buttons').appendChild(btn);
    
    // Initialize layer if it doesn't exist, but respect 'active' for visibility
    addLevelLayer(level, active);
    setLayerVisibility(level, active);
}

function resetAdminLevels() {
    document.getElementById('admin-levels-container').style.display = 'none';
    
    // Hide all levels except 0
    for (let i = 1; i <= 5; i++) {
        setLayerVisibility(i, false);
    }
    setLayerVisibility(0, true);
}

// Handle feature click (popup)
function handleFeatureClick(e, level) {
    const props = e.features[0].properties;
    
    let content = `<div class="popup-title">${props[`NAME_${level}`] || props.name || 'Unknown'}</div>`;
    content += `<table class="popup-table">`;
    
    // Hierarchy
    if (level > 0) content += `<tr><td>Country</td><td>${props.NAME_0 || props.country}</td></tr>`;
    if (level > 1) content += `<tr><td>Level 1</td><td>${props.NAME_1}</td></tr>`;
    if (level > 2) content += `<tr><td>Level 2</td><td>${props.NAME_2}</td></tr>`;
    
    // Type
    const type = props[`TYPE_${level}`] || props.type;
    const engType = props[`ENGTYPE_${level}`] || props.engtype;
    
    if (type) content += `<tr><td>Type</td><td>${type}</td></tr>`;
    if (engType && engType !== type) content += `<tr><td>Type (En)</td><td>${engType}</td></tr>`;
    
    // Codes
    const gid = props[`GID_${level}`] || props.gid;
    if (gid) content += `<tr><td>GID</td><td>${gid}</td></tr>`;
    
    content += `</table>`;

    new maplibregl.Popup()
        .setLngLat(e.lngLat)
        .setHTML(content)
        .addTo(map);
}
