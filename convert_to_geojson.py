#!/usr/bin/env python3
"""
Convert GADM GeoPackage to GeoJSON files organized by country and admin level.
This creates a simpler structure that can be loaded directly by Leaflet without DuckDB.
"""

import geopandas as gpd
import json
import os
from pathlib import Path
import warnings
warnings.filterwarnings('ignore')

# Configuration
INPUT_FILE = "../gadm.gpkg"
OUTPUT_DIR = "data"
SIMPLIFY_TOLERANCE = 0.001  # degrees (~100m at equator)

def sanitize_filename(name):
    """Convert country name to safe filename."""
    return name.replace(" ", "_").replace("/", "_").replace("\\", "_").replace(":", "_").replace(",", "_")

def main():
    print("Loading GADM GeoPackage...")
    print("This may take a few minutes due to file size...")

    # Read the GeoPackage
    gdf = gpd.read_file(INPUT_FILE, layer='gadm_410')
    print(f"Loaded {len(gdf)} records")

    # Ensure output directory exists
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    # Get unique countries
    countries = sorted(gdf['COUNTRY'].unique())
    print(f"Processing {len(countries)} countries...")

    # Metadata for countries.json
    countries_meta = []

    for i, country in enumerate(countries):
        print(f"[{i+1}/{len(countries)}] Processing {country}...")

        # Filter data for this country
        country_gdf = gdf[gdf['COUNTRY'] == country].copy()

        if len(country_gdf) == 0:
            print(f"  Skipping {country} - no data")
            continue

        # Simplify geometries
        country_gdf['geometry'] = country_gdf['geometry'].simplify(
            tolerance=SIMPLIFY_TOLERANCE,
            preserve_topology=True
        )

        # Get bounding box
        bounds = country_gdf.total_bounds  # [minx, miny, maxx, maxy]

        # Create country directory
        country_dir = os.path.join(OUTPUT_DIR, sanitize_filename(country))
        os.makedirs(country_dir, exist_ok=True)

        # Determine available admin levels and create GeoJSON for each
        admin_levels = []

        for level in range(1, 6):
            name_col = f'NAME_{level}'
            type_col = f'TYPE_{level}'
            engtype_col = f'ENGTYPE_{level}'
            gid_col = f'GID_{level}'

            if name_col not in country_gdf.columns:
                continue

            # Check if this level has data
            has_data = country_gdf[name_col].notna() & (country_gdf[name_col] != '')
            if not has_data.any():
                continue

            admin_levels.append(level)

            # Filter rows that have data at this level
            level_gdf = country_gdf[has_data].copy()

            # Dissolve by the admin level to get unique regions
            # Group by name and other attributes at this level
            group_cols = [name_col]
            if type_col in level_gdf.columns:
                group_cols.append(type_col)
            if engtype_col in level_gdf.columns:
                group_cols.append(engtype_col)
            if gid_col in level_gdf.columns:
                group_cols.append(gid_col)

            # Add parent column if level > 1
            parent_col = f'NAME_{level-1}' if level > 1 else None
            if parent_col and parent_col in level_gdf.columns:
                group_cols.append(parent_col)

            # Also keep NAME_0 (country name)
            if 'NAME_0' in level_gdf.columns and 'NAME_0' not in group_cols:
                group_cols.append('NAME_0')

            try:
                dissolved = level_gdf.dissolve(by=group_cols, as_index=False)
            except Exception as e:
                print(f"  Warning: Could not dissolve level {level}: {e}")
                dissolved = level_gdf

            # Create feature collection
            features = []
            for _, row in dissolved.iterrows():
                props = {
                    'name': row[name_col] if name_col in dissolved.columns else '',
                    'country': row['NAME_0'] if 'NAME_0' in dissolved.columns else country,
                    'level': level
                }

                if type_col in dissolved.columns and row[type_col]:
                    props['type'] = row[type_col]
                if engtype_col in dissolved.columns and row[engtype_col]:
                    props['eng_type'] = row[engtype_col]
                if gid_col in dissolved.columns and row[gid_col]:
                    props['gid'] = row[gid_col]
                if parent_col and parent_col in dissolved.columns and row[parent_col]:
                    props['parent'] = row[parent_col]

                # Convert geometry to GeoJSON
                geom = row.geometry.__geo_interface__

                features.append({
                    'type': 'Feature',
                    'properties': props,
                    'geometry': geom
                })

            geojson = {
                'type': 'FeatureCollection',
                'features': features
            }

            # Save GeoJSON file
            filename = f"level_{level}.geojson"
            filepath = os.path.join(country_dir, filename)
            with open(filepath, 'w') as f:
                json.dump(geojson, f)

            file_size = os.path.getsize(filepath)
            print(f"  Level {level}: {len(features)} regions ({file_size/1024:.1f} KB)")

        if not admin_levels:
            print(f"  Skipping {country} - no admin levels found")
            continue

        # Add to metadata
        countries_meta.append({
            "name": country,
            "folder": sanitize_filename(country),
            "bounds": [float(bounds[0]), float(bounds[1]), float(bounds[2]), float(bounds[3])],
            "admin_levels": admin_levels
        })

    # Save countries metadata
    meta_path = os.path.join(OUTPUT_DIR, "countries.json")
    with open(meta_path, 'w') as f:
        json.dump({
            "countries": countries_meta,
            "total_countries": len(countries_meta)
        }, f, indent=2)

    print(f"\nDone! Created GeoJSON files for {len(countries_meta)} countries")
    print(f"Metadata saved to {meta_path}")

    # Calculate total size
    total_size = 0
    for root, dirs, files in os.walk(OUTPUT_DIR):
        for file in files:
            total_size += os.path.getsize(os.path.join(root, file))
    print(f"Total data size: {total_size / (1024*1024):.1f} MB")

if __name__ == "__main__":
    main()
