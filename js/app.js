/**
 * Global Administrative Boundaries Explorer
 * Uses DuckDB-WASM to query GeoParquet files and Leaflet for visualization
 */

import * as duckdb from 'https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.28.0/+esm';

// Global state
let map;
let db = null;
let conn = null;
let duckDBReady = false;
let countriesData = null;
let currentCountry = null;
let currentLevel = null;
let boundaryLayer = null;

// Initialize the application
async function init() {
    // Initialize map
    initMap();

    // Load countries metadata (doesn't need DuckDB)
    await loadCountriesMetadata();

    // Set up event listeners
    setupEventListeners();

    // Initialize DuckDB
    await initDuckDB();
}

// Initialize Leaflet map with dark basemap
function initMap() {
    map = L.map('map', {
        center: [20, 0],
        zoom: 2,
        minZoom: 2,
        maxZoom: 18
    });

    // Dark basemap - CartoDB Dark Matter (shows country boundaries)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a> | Data: <a href="https://gadm.org">GADM</a>',
        subdomains: 'abcd',
        maxZoom: 20
    }).addTo(map);
}

// Initialize DuckDB WASM
async function initDuckDB() {
    showLoading('Initializing database...');

    try {
        // Configure DuckDB bundles
        const MANUAL_BUNDLES = {
            mvp: {
                mainModule: 'https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.28.0/dist/duckdb-mvp.wasm',
                mainWorker: 'https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.28.0/dist/duckdb-browser-mvp.worker.js',
            },
            eh: {
                mainModule: 'https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.28.0/dist/duckdb-eh.wasm',
                mainWorker: 'https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.28.0/dist/duckdb-browser-eh.worker.js',
            },
        };

        // Select the best bundle for this browser
        const bundle = await duckdb.selectBundle(MANUAL_BUNDLES);

        // Create worker
        const worker = new Worker(bundle.mainWorker);
        const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING);

        // Instantiate DuckDB
        db = new duckdb.AsyncDuckDB(logger, worker);
        await db.instantiate(bundle.mainModule);

        // Create connection
        conn = await db.connect();

        // Load spatial extension
        await conn.query(`INSTALL spatial`);
        await conn.query(`LOAD spatial`);

        duckDBReady = true;
        hideLoading();
        console.log('DuckDB initialized successfully');
    } catch (error) {
        console.error('Failed to initialize DuckDB:', error);
        hideLoading();
        showError('Failed to initialize database: ' + error.message);
    }
}

// Show error message
function showError(message) {
    const errorDiv = document.createElement('div');
    errorDiv.id = 'error-message';
    errorDiv.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#c0392b;color:white;padding:20px 30px;border-radius:8px;z-index:9999;max-width:80%;text-align:center;';
    errorDiv.innerHTML = `<strong>Error:</strong> ${message}<br><br><button onclick="location.reload()" style="padding:8px 16px;cursor:pointer;">Refresh Page</button>`;
    document.body.appendChild(errorDiv);
}

// Wait for DuckDB to be ready
async function waitForDuckDB() {
    if (duckDBReady && conn) return true;

    // Wait up to 30 seconds for DuckDB to initialize
    for (let i = 0; i < 60; i++) {
        await new Promise(resolve => setTimeout(resolve, 500));
        if (duckDBReady && conn) return true;
    }

    return false;
}

// Load countries metadata
async function loadCountriesMetadata() {
    showLoading('Loading countries...');

    try {
        const response = await fetch('data/countries.json');
        countriesData = await response.json();

        // Populate country dropdown
        const select = document.getElementById('country-select');
        countriesData.countries
            .sort((a, b) => a.name.localeCompare(b.name))
            .forEach(country => {
                const option = document.createElement('option');
                option.value = country.filename;
                option.textContent = country.name;
                option.dataset.bounds = JSON.stringify(country.bounds);
                option.dataset.levels = JSON.stringify(country.admin_levels);
                option.dataset.name = country.name;
                select.appendChild(option);
            });

        hideLoading();
    } catch (error) {
        console.error('Failed to load countries:', error);
        hideLoading();
        showError('Failed to load country list. Please refresh the page.');
    }
}

// Set up event listeners
function setupEventListeners() {
    // Country selection
    document.getElementById('country-select').addEventListener('change', handleCountryChange);

    // Close info panel
    document.getElementById('close-info').addEventListener('click', () => {
        document.getElementById('info-panel').style.display = 'none';
    });
}

// Handle country selection
async function handleCountryChange(event) {
    const select = event.target;
    const selectedOption = select.options[select.selectedIndex];

    if (!selectedOption.value) {
        // Reset view
        document.getElementById('admin-levels-container').style.display = 'none';
        if (boundaryLayer) {
            map.removeLayer(boundaryLayer);
            boundaryLayer = null;
        }
        map.setView([20, 0], 2);
        return;
    }

    currentCountry = {
        filename: selectedOption.value,
        name: selectedOption.dataset.name,
        bounds: JSON.parse(selectedOption.dataset.bounds),
        levels: JSON.parse(selectedOption.dataset.levels)
    };

    // Zoom to country bounds
    const [minX, minY, maxX, maxY] = currentCountry.bounds;
    map.fitBounds([[minY, minX], [maxY, maxX]], { padding: [20, 20] });

    // Show admin level buttons
    showAdminLevelButtons(currentCountry.levels);

    // Clear existing boundaries
    if (boundaryLayer) {
        map.removeLayer(boundaryLayer);
        boundaryLayer = null;
    }

    // Auto-load the first available level
    if (currentCountry.levels.length > 0) {
        await loadBoundaries(currentCountry.levels[0]);
    }
}

// Show admin level buttons
function showAdminLevelButtons(levels) {
    const container = document.getElementById('admin-levels-container');
    const buttonsDiv = document.getElementById('admin-level-buttons');
    buttonsDiv.innerHTML = '';

    const levelNames = {
        1: 'Level 1 (States/Provinces)',
        2: 'Level 2 (Districts/Counties)',
        3: 'Level 3 (Municipalities)',
        4: 'Level 4 (Sub-municipalities)',
        5: 'Level 5 (Villages/Wards)'
    };

    levels.forEach(level => {
        const btn = document.createElement('button');
        btn.className = 'admin-level-btn';
        btn.textContent = levelNames[level] || `Level ${level}`;
        btn.dataset.level = level;
        btn.addEventListener('click', () => loadBoundaries(level));
        buttonsDiv.appendChild(btn);
    });

    container.style.display = 'block';
}

// Load boundaries for a specific admin level
async function loadBoundaries(level) {
    if (!currentCountry) return;

    showLoading(`Loading Level ${level} boundaries...`);
    currentLevel = level;

    // Update button states
    document.querySelectorAll('.admin-level-btn').forEach(btn => {
        btn.classList.toggle('active', parseInt(btn.dataset.level) === level);
    });

    // Wait for DuckDB to be ready
    if (!duckDBReady || !conn) {
        const ready = await waitForDuckDB();
        if (!ready) {
            hideLoading();
            showError('Database failed to initialize. Please refresh the page.');
            return;
        }
    }

    try {
        // Get the base URL for the data files
        const baseUrl = new URL('.', window.location.href).href;
        const parquetUrl = `${baseUrl}data/${currentCountry.filename}`;

        // Query the parquet file
        const nameCol = `NAME_${level}`;
        const typeCol = `TYPE_${level}`;
        const engTypeCol = `ENGTYPE_${level}`;
        const gidCol = `GID_${level}`;

        // Build query to get unique boundaries at this level
        const query = `
            SELECT
                ${nameCol} as name,
                ${typeCol} as type,
                ${engTypeCol} as eng_type,
                ${gidCol} as gid,
                NAME_0 as country,
                ${level > 1 ? `NAME_${level-1} as parent,` : ''}
                ST_AsGeoJSON(ST_Union_Agg(ST_GeomFromWKB(geometry))) as geojson
            FROM '${parquetUrl}'
            WHERE ${nameCol} IS NOT NULL AND ${nameCol} != ''
            GROUP BY ${nameCol}, ${typeCol}, ${engTypeCol}, ${gidCol}, NAME_0${level > 1 ? `, NAME_${level-1}` : ''}
        `;

        const result = await conn.query(query);
        const rows = result.toArray();

        // Create GeoJSON features
        const features = rows.map(row => {
            const props = {
                name: row.name,
                type: row.type,
                eng_type: row.eng_type,
                gid: row.gid,
                country: row.country,
                level: level
            };
            if (row.parent) {
                props.parent = row.parent;
            }

            let geometry;
            try {
                geometry = JSON.parse(row.geojson);
            } catch (e) {
                console.warn('Failed to parse geometry for', row.name);
                return null;
            }

            return {
                type: 'Feature',
                properties: props,
                geometry: geometry
            };
        }).filter(f => f !== null);

        const geojson = {
            type: 'FeatureCollection',
            features: features
        };

        // Remove existing layer
        if (boundaryLayer) {
            map.removeLayer(boundaryLayer);
        }

        // Add new layer with yellow border styling
        boundaryLayer = L.geoJSON(geojson, {
            style: {
                color: '#FFD700',      // Gold/yellow border
                weight: 3,              // Thick border
                fillColor: '#FFD700',
                fillOpacity: 0.1
            },
            onEachFeature: (feature, layer) => {
                layer.on({
                    click: () => showFeatureInfo(feature.properties),
                    mouseover: (e) => {
                        e.target.setStyle({
                            weight: 5,          // Even thicker on hover
                            fillOpacity: 0.25
                        });
                        e.target.bringToFront();
                    },
                    mouseout: (e) => {
                        boundaryLayer.resetStyle(e.target);
                    }
                });
            }
        }).addTo(map);

        hideLoading();
    } catch (error) {
        console.error('Failed to load boundaries:', error);
        hideLoading();
        showError(`Failed to load boundaries: ${error.message}`);
    }
}

// Show feature information in the info panel
function showFeatureInfo(props) {
    const panel = document.getElementById('info-panel');
    const content = document.getElementById('info-content');

    let html = `<h3>${props.name}</h3>`;
    html += `<table>`;
    html += `<tr><td><strong>Country:</strong></td><td>${props.country}</td></tr>`;

    if (props.parent) {
        html += `<tr><td><strong>Parent Region:</strong></td><td>${props.parent}</td></tr>`;
    }

    if (props.type) {
        html += `<tr><td><strong>Type:</strong></td><td>${props.type}</td></tr>`;
    }

    if (props.eng_type && props.eng_type !== props.type) {
        html += `<tr><td><strong>Type (English):</strong></td><td>${props.eng_type}</td></tr>`;
    }

    html += `<tr><td><strong>Admin Level:</strong></td><td>${props.level}</td></tr>`;

    if (props.gid) {
        html += `<tr><td><strong>GID:</strong></td><td>${props.gid}</td></tr>`;
    }

    html += `</table>`;

    content.innerHTML = html;
    panel.style.display = 'block';
}

// Loading indicator functions
function showLoading(text = 'Loading...') {
    document.getElementById('loading-text').textContent = text;
    document.getElementById('loading-indicator').style.display = 'flex';
}

function hideLoading() {
    document.getElementById('loading-indicator').style.display = 'none';
}

// Start the application when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
