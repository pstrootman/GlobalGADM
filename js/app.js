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
    0: { color: '#FFD700', fill: 'transparent', width: 2, opacity: 0 },   // Golden Sun (Country)
    1: { color: '#FF6600', fill: '#FF6600', width: 1.5, opacity: 0.2 },   // Sunset Orange (Level 1)
    2: { color: '#00C5CD', fill: '#00C5CD', width: 1, opacity: 0.2 },     // Turquoise Waters (Level 2)
    3: { color: '#00C5CD', fill: '#00C5CD', width: 0.8, opacity: 0.2 },   // Turquoise (Level 3)
    4: { color: '#00C5CD', fill: '#00C5CD', width: 0.5, opacity: 0.2 },   // Turquoise (Level 4)
    5: { color: '#00C5CD', fill: '#00C5CD', width: 0.5, opacity: 0.2 }    // Turquoise (Level 5)
};

// Initialize the application
async function init() {
    try {
        // Initialize PMTiles protocol
        protocol = new pmtiles.Protocol({ metadata: true });
        maplibregl.addProtocol("pmtiles", (request, abortController) => protocol.tile(request, abortController));

        // Initialize map
        initMap();

        // Load countries metadata
        await loadCountriesMetadata();

        // Set up event listeners
        setupEventListeners();
    } catch (e) {
        console.error('Init failed:', e);
    }
}

// Initialize MapLibre map
function initMap() {
    map = new maplibregl.Map({
        container: 'map',
        style: {
            version: 8,
            sources: {},
            layers: [
                {
                    id: 'background',
                    type: 'background',
                    paint: {
                        'background-color': '#002244' // Deep Ocean Blue
                    }
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

        // Add Country Labels
        // We need to ensure the source exists first, which addLevelLayer(0) does.
        // But addLevelLayer is async in terms of source loading? No, addSource is sync.
        // Let's add the label layer after a brief moment or ensure it uses the same source.
        // Actually, addLevelLayer adds the source 'gadm-level0'. We can reuse it.

        if (!map.getLayer('country-labels')) {
            map.addLayer({
                id: 'country-labels',
                type: 'symbol',
                source: 'gadm-level0',
                'source-layer': 'countries',
                layout: {
                    'text-field': ['get', 'NAME_0'],
                    'text-font': ['Open Sans Bold'], // MapLibre default fonts might need checking, usually 'Open Sans Regular' is available if using a style that defines glyphs. 
                    // Wait, we provided a raw style object without 'glyphs'. MapLibre needs a glyphs URL for text.
                    // We can use a public glyphs URL.
                    'text-size': 12,
                    'text-transform': 'uppercase',
                    'text-variable-anchor': ['center'],
                    'text-justify': 'auto'
                },
                paint: {
                    'text-color': '#FFFFFF',
                    'text-halo-color': '#002244',
                    'text-halo-width': 2
                }
            });
        }
    });

    // Set glyphs URL for text rendering
    map.setStyle({
        version: 8,
        glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
        sources: {},
        layers: [
            {
                id: 'background',
                type: 'background',
                paint: {
                    'background-color': '#002244'
                }
            }
        ]
    });
}

// Store event handlers to allow removal
const layerClickHandlers = {};
const layerHoverHandlers = {};
const layerLeaveHandlers = {};

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
        console.log(`Creating layer ${lineLayerId} for ${currentCountry ? currentCountry.name : 'all'}`);
        const layerDef = {
            id: lineLayerId,
            type: 'line',
            source: sourceId,
            'source-layer': level === 0 ? 'countries' : `admin${level}`,
            layout: {
                'visibility': isVisible ? 'visible' : 'none'
            },
            paint: {
                'line-color': STYLES[level].color,
                'line-width': STYLES[level].width
            }
        };

        // Apply filter if level > 0 and a country is selected
        if (level > 0 && currentCountry) {
            layerDef.filter = ['==', ['get', 'NAME_0'], currentCountry.name];
        }

        map.addLayer(layerDef);
    }

    // Fill layer (interactive)
    const fillLayerId = `layer-fill-${level}`;
    if (!map.getLayer(fillLayerId)) {
        const fillDef = {
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
        };

        // Apply filter if level > 0 and a country is selected
        if (level > 0 && currentCountry) {
            fillDef.filter = ['==', ['get', 'NAME_0'], currentCountry.name];
        }

        map.addLayer(fillDef, lineLayerId); // Place fill below line

        // Clean up existing listeners if any (to prevent duplicates)
        if (layerClickHandlers[level]) {
            map.off('click', fillLayerId, layerClickHandlers[level]);
        }
        if (layerHoverHandlers[level]) {
            map.off('mouseenter', fillLayerId, layerHoverHandlers[level]);
        }
        if (layerLeaveHandlers[level]) {
            map.off('mouseleave', fillLayerId, layerLeaveHandlers[level]);
        }

        // Create and store new handlers
        layerClickHandlers[level] = (e) => handleFeatureClick(e, level);
        layerHoverHandlers[level] = () => map.getCanvas().style.cursor = 'pointer';
        layerLeaveHandlers[level] = () => map.getCanvas().style.cursor = '';

        // Add listeners
        map.on('click', fillLayerId, layerClickHandlers[level]);
        map.on('mouseenter', fillLayerId, layerHoverHandlers[level]);
        map.on('mouseleave', fillLayerId, layerLeaveHandlers[level]);
    }
}

// Toggle layer visibility
function setLayerVisibility(level, isVisible) {
    const lineId = `layer-line-${level}`;
    const fillId = `layer-fill-${level}`;

    if (map.getLayer(lineId)) {
        map.setLayoutProperty(lineId, 'visibility', isVisible ? 'visible' : 'none');
    }
    if (map.getLayer(fillId)) {
        map.setLayoutProperty(fillId, 'visibility', isVisible ? 'visible' : 'none');
    }
}

// Reset admin levels (hide all, clear UI)
function resetAdminLevels() {
    const buttonsDiv = document.getElementById('admin-level-buttons');
    if (buttonsDiv) buttonsDiv.innerHTML = '';

    const container = document.getElementById('admin-levels-container');
    if (container) container.style.display = 'none';

    // Remove all admin layers (except 0 if we want to keep it, but logic below handles 0 separately)
    // Actually, let's remove 1-5. Level 0 is usually kept but reset style.
    for (let i = 1; i <= 5; i++) {
        const lineId = `layer-line-${i}`;
        const fillId = `layer-fill-${i}`;
        if (map.getLayer(fillId)) map.removeLayer(fillId);
        if (map.getLayer(lineId)) map.removeLayer(lineId);
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
                country.name = country.name.trim(); // Ensure no whitespace issues
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

        currentCountry = null;
        resetAdminLevels();

        // Reset Level 0 style
        if (map.getLayer('layer-line-0')) {
            map.setPaintProperty('layer-line-0', 'line-color', STYLES[0].color);
            map.setPaintProperty('layer-line-0', 'line-width', STYLES[0].width);
        }
    });
}

// Handle country selection
function handleCountryChange(event) {
    const countryName = event.target.value;

    // Reset if empty
    if (!countryName) {
        currentCountry = null;
        resetAdminLevels();

        // Reset Level 0 style
        if (map.getLayer('layer-line-0')) {
            map.setPaintProperty('layer-line-0', 'line-color', STYLES[0].color);
            map.setPaintProperty('layer-line-0', 'line-width', STYLES[0].width);
        }
        return;
    }

    const country = countriesData.find(c => c.name === countryName);
    if (country) {
        console.log('Selected country:', country.name);
        currentCountry = country;

        // Fly to country
        map.fitBounds([
            [country.bounds[0], country.bounds[1]], // sw
            [country.bounds[2], country.bounds[3]]  // ne
        ], { padding: 50 });

        // Highlight Level 0 (Country Boundary)
        if (map.getLayer('layer-line-0')) {
            // Highlight logic: Purple (#D500F9) and Thick (4px) for selected, default for others.
            map.setPaintProperty('layer-line-0', 'line-color', [
                'case',
                ['==', ['get', 'NAME_0'], country.name],
                '#D500F9',
                STYLES[0].color
            ]);
            map.setPaintProperty('layer-line-0', 'line-width', [
                'case',
                ['==', ['get', 'NAME_0'], country.name],
                4,
                STYLES[0].width
            ]);
        }

        // Remove existing admin layers to ensure clean state and correct filtering
        for (let i = 1; i <= 5; i++) {
            const lineId = `layer-line-${i}`;
            const fillId = `layer-fill-${i}`;
            if (map.getLayer(fillId)) map.removeLayer(fillId);
            if (map.getLayer(lineId)) map.removeLayer(lineId);
        }

        // Update UI for admin levels
        updateAdminLevelUI(country);
    }
}

// Update Admin Level Buttons
function updateAdminLevelUI(country) {
    const container = document.getElementById('admin-levels-container');
    const buttonsDiv = document.getElementById('admin-level-buttons');
    const infoDiv = document.getElementById('level-info');

    if (container) container.style.display = 'flex';
    if (buttonsDiv) buttonsDiv.innerHTML = '';
    if (infoDiv) infoDiv.textContent = `This country has ${country.admin_levels.length} administrative levels.`;

    // Add button for Level 0 (Country Boundary)
    createLevelButton(0, 'Country Boundary', true);

    country.admin_levels.forEach(level => {
        createLevelButton(level, `Level ${level}`);
    });
}

// Helper to create admin level buttons
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

// Handle feature click (popup)
function handleFeatureClick(e, level) {
    const props = e.features[0].properties;
    window.lastClickedProps = props; // Store for debugging
    console.log(`Clicked Level ${level} Feature Properties:`, props);

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



// Start the application
init();
