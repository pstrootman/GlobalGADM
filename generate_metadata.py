import json
import os

# This script generates the countries.json file required by the web app.
# It assumes that process_data.sh has already run and 'data/level_0.geojson' exists.

INPUT_FILE = 'data/level_0.geojson'
OUTPUT_FILE = 'data/countries.json'

def calculate_bounds(coordinates):
    """Calculate bbox from GeoJSON coordinates (MultiPolygon or Polygon)."""
    minx, miny = 180, 90
    maxx, maxy = -180, -90

    def traverse(coords, depth=0):
        nonlocal minx, miny, maxx, maxy
        # Depth 0: MultiPolygon container
        # Depth 1: Polygon container
        # Depth 2: Linear Ring (list of points)
        # Depth 3: Point [x, y]
        
        # A polygon is [[[x,y], ...], [[hole], ...]]
        # A multipolygon is [Polygon, Polygon]
        
        # Flattening logic
        if isinstance(coords[0], (float, int)): # It's a point
             x, y = coords
             if x < minx: minx = x
             if x > maxx: maxx = x
             if y < miny: miny = y
             if y > maxy: maxy = y
        else:
            for item in coords:
                traverse(item)

    traverse(coordinates)
    return [minx, miny, maxx, maxy]

def main():
    if not os.path.exists(INPUT_FILE):
        print(f"Error: {INPUT_FILE} not found. Run process_data.sh first.")
        return

    print(f"Reading {INPUT_FILE}...")
    with open(INPUT_FILE, 'r') as f:
        data = json.load(f)

    countries_list = []
    
    print("Processing features...")
    for feature in data['features']:
        props = feature['properties']
        name = props.get('NAME_0', 'Unknown')
        
        # Simple bounds calculation
        # Note: For complex multipolygons this can be slow in python, 
        # but acceptable for 255 countries.
        bounds = calculate_bounds(feature['geometry']['coordinates'])
        
        # For now, we assume standard GADM levels (up to 2 or 3 commonly available)
        # To get actual available levels, we'd need to check the other files.
        # For the prototype, we'll list levels based on file existence or hardcode generic max.
        # Or better: we can scan the other geojson files to see if this country name exists in them.
        
        admin_levels = []
        # Check logic later or dynamic loading. 
        # For this script, let's assume if it's in level_0, it likely has levels 1 and 2.
        # A more robust way would be to check if GID_0 exists in level_1.geojson etc.
        
        countries_list.append({
            "name": name,
            "bounds": bounds,
            "admin_levels": [1, 2] # Default assumption for prototype
        })

    # Save metadata
    output = {
        "countries": countries_list
    }
    
    with open(OUTPUT_FILE, 'w') as f:
        json.dump(output, f)
    
    print(f"Saved metadata for {len(countries_list)} countries to {OUTPUT_FILE}")

if __name__ == "__main__":
    main()
