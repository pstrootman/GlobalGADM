# Global GADM Explorer

A web application for visualizing Global Administrative Areas (GADM) using cloud-optimized PMTiles and MapLibre GL JS.

## Setup

1.  **Data Processing**:
    You need to convert the GADM GeoPackage to PMTiles.
    
    Ensure you have `ogr2ogr` (GDAL) and `tippecanoe` installed.
    Then run:
    ```bash
    cd GlobalGADM
    chmod +x process_data.sh
    ./process_data.sh
    ```
    This will generate the `.pmtiles` files and `countries.json` in the `data/` directory.

2.  **Local Development**:
    Serve the `GlobalGADM` directory using a static file server.
    ```bash
    python3 -m http.server
    ```
    Open `http://localhost:8000`.

## Deployment to GitHub Pages

1.  Enable GitHub Pages in your repository settings.
2.  Push the contents of `GlobalGADM` to your repository (e.g., `main` branch or `gh-pages` branch).
3.  Ensure the `data/` folder contains the generated PMTiles and JSON files.
    *Note: GitHub has a file size limit of 100MB. If your PMTiles files are larger, you may need to use Git LFS or split them.*

## Technologies

- **MapLibre GL JS**: Map rendering
- **PMTiles**: Serverless map tiles
- **Tippecanoe**: Tile generation
- **GDAL/OGR**: Data conversion