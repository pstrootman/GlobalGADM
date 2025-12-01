#!/bin/bash
# Script to process GADM GPKG to PMTiles
# Requires: ogr2ogr (GDAL), tippecanoe

GADM_GPKG="../gadm.gpkg"
OUTPUT_DIR="data"
mkdir -p $OUTPUT_DIR

echo "=========================================="
echo "GADM to PMTiles Conversion Pipeline"
echo "=========================================="

# Check requirements
if ! command -v ogr2ogr &> /dev/null;
    then
    echo "Error: ogr2ogr (GDAL) is not installed."
    exit 1
fi

if ! command -v tippecanoe &> /dev/null;
    then
    echo "Error: tippecanoe is not installed."
    exit 1
fi

echo "Step 1: Extracting layers to GeoJSON..."

# Clean up existing files to avoid ogr2ogr overwrite issues
rm -f $OUTPUT_DIR/level_0.geojson
rm -f $OUTPUT_DIR/level_1.geojson
rm -f $OUTPUT_DIR/level_2.geojson
rm -f $OUTPUT_DIR/level_3.geojson

# Allow large GeoJSON objects for complex geometries (like Russia, Antarctica, Canada)
export OGR_GEOJSON_MAX_OBJ_SIZE=0

# Extract Level 0 (Country boundaries)
echo "Extracting Level 0 (Countries)..."
ogr2ogr -f GeoJSON $OUTPUT_DIR/level_0.geojson $GADM_GPKG \
    -sql "SELECT NAME_0, GID_0, ST_Union(geom) as geometry FROM gadm_410 GROUP BY GID_0, NAME_0" \
    -lco COORDINATE_PRECISION=5

# Extract Level 1
echo "Extracting Level 1 (States/Provinces)..."
ogr2ogr -f GeoJSON $OUTPUT_DIR/level_1.geojson $GADM_GPKG \
    -sql "SELECT NAME_0, NAME_1, GID_1, TYPE_1, ENGTYPE_1, ST_Union(geom) as geometry FROM gadm_410 WHERE NAME_1 IS NOT NULL GROUP BY GID_1, NAME_1, NAME_0, TYPE_1, ENGTYPE_1" \
    -lco COORDINATE_PRECISION=5

# Extract Level 2
echo "Extracting Level 2 (Districts)..."
ogr2ogr -f GeoJSON $OUTPUT_DIR/level_2.geojson $GADM_GPKG \
    -sql "SELECT NAME_0, NAME_1, NAME_2, GID_2, TYPE_2, ENGTYPE_2, ST_Union(geom) as geometry FROM gadm_410 WHERE NAME_2 IS NOT NULL GROUP BY GID_2, NAME_2, NAME_1, NAME_0, TYPE_2, ENGTYPE_2" \
    -lco COORDINATE_PRECISION=5

# Extract Level 3 (if needed - optional due to size)
echo "Extracting Level 3..."
ogr2ogr -f GeoJSON $OUTPUT_DIR/level_3.geojson $GADM_GPKG \
    -sql "SELECT NAME_0, NAME_1, NAME_2, NAME_3, GID_3, TYPE_3, ENGTYPE_3, ST_Union(geom) as geometry FROM gadm_410 WHERE NAME_3 IS NOT NULL GROUP BY GID_3, NAME_3, NAME_2, NAME_1, NAME_0, TYPE_3, ENGTYPE_3" \
    -lco COORDINATE_PRECISION=5



echo "Step 2: Converting GeoJSON to PMTiles with Tippecanoe..."

# Convert Level 0
echo "Tiling Level 0..."
tippecanoe -o $OUTPUT_DIR/gadm_level0.pmtiles \
  --layer=countries \
  --minimum-zoom=0 \
  --maximum-zoom=5 \
  --simplification=10 \
  --detect-shared-borders \
  --force \
  $OUTPUT_DIR/level_0.geojson

# Convert Level 1
echo "Tiling Level 1..."
tippecanoe -o $OUTPUT_DIR/gadm_level1.pmtiles \
  --layer=admin1 \
  --minimum-zoom=2 \
  --maximum-zoom=9 \
  --simplification=10 \
  --detect-shared-borders \
  --force \
  $OUTPUT_DIR/level_1.geojson

# Convert Level 2
echo "Tiling Level 2..."
tippecanoe -o $OUTPUT_DIR/gadm_level2.pmtiles \
  --layer=admin2 \
  --minimum-zoom=5 \
  --maximum-zoom=11 \
  --simplification=10 \
  --detect-shared-borders \
  --force \
  $OUTPUT_DIR/level_2.geojson

# Convert Level 3
echo "Tiling Level 3..."
tippecanoe -o $OUTPUT_DIR/gadm_level3.pmtiles \
  --layer=admin3 \
  --minimum-zoom=7 \
  --maximum-zoom=12 \
  --simplification=10 \
  --detect-shared-borders \
  --force \
  $OUTPUT_DIR/level_3.geojson



echo "Step 3: Generating Metadata (countries.json)..."
# Run the python script for metadata
python3 generate_metadata.py

echo "Done! Data is ready in $OUTPUT_DIR"