#!/usr/bin/env python3
"""
Convert GADM GeoPackage to GeoParquet files (one per country).
Simplifies geometries for web use and generates countries.json metadata.
"""

import geopandas as gpd
import pandas as pd
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
    return name.replace(" ", "_").replace("/", "_").replace("\\", "_").replace(":", "_")

def get_admin_levels(df, country):
    """Determine which admin levels have data for a country."""
    country_df = df[df['COUNTRY'] == country]
    levels = []

    for level in range(1, 6):
        name_col = f'NAME_{level}'
        if name_col in country_df.columns:
            non_empty = country_df[name_col].notna() & (country_df[name_col] != '')
            if non_empty.any():
                levels.append(level)

    return levels

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

        # Determine available admin levels
        admin_levels = get_admin_levels(country_gdf, country)

        # Select columns to keep (reduce file size)
        columns_to_keep = [
            'geometry', 'UID', 'GID_0', 'NAME_0', 'COUNTRY',
            'GID_1', 'NAME_1', 'TYPE_1', 'ENGTYPE_1',
            'GID_2', 'NAME_2', 'TYPE_2', 'ENGTYPE_2',
            'GID_3', 'NAME_3', 'TYPE_3', 'ENGTYPE_3',
            'GID_4', 'NAME_4', 'TYPE_4', 'ENGTYPE_4',
            'GID_5', 'NAME_5', 'TYPE_5', 'ENGTYPE_5',
        ]
        columns_to_keep = [c for c in columns_to_keep if c in country_gdf.columns]
        country_gdf = country_gdf[columns_to_keep]

        # Save as GeoParquet
        filename = sanitize_filename(country) + ".parquet"
        filepath = os.path.join(OUTPUT_DIR, filename)
        country_gdf.to_parquet(filepath)

        # Get file size
        file_size = os.path.getsize(filepath)

        # Add to metadata
        countries_meta.append({
            "name": country,
            "filename": filename,
            "bounds": [float(bounds[0]), float(bounds[1]), float(bounds[2]), float(bounds[3])],
            "admin_levels": admin_levels,
            "record_count": len(country_gdf),
            "file_size": file_size
        })

        print(f"  Saved {filename} ({len(country_gdf)} records, {file_size/1024:.1f} KB)")

    # Save countries metadata
    meta_path = os.path.join(OUTPUT_DIR, "countries.json")
    with open(meta_path, 'w') as f:
        json.dump({
            "countries": countries_meta,
            "total_countries": len(countries_meta),
            "simplify_tolerance": SIMPLIFY_TOLERANCE
        }, f, indent=2)

    print(f"\nDone! Created {len(countries_meta)} country files")
    print(f"Metadata saved to {meta_path}")

    # Calculate total size
    total_size = sum(c['file_size'] for c in countries_meta)
    print(f"Total data size: {total_size / (1024*1024):.1f} MB")

if __name__ == "__main__":
    main()
