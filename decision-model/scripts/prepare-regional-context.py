from __future__ import annotations

import argparse
import base64
import hashlib
import json
import math
import re
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from html import escape
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORKSPACE = ROOT.parent
WEB = WORKSPACE / "data" / "homebound" / "web"
CACHE = ROOT / "evidence" / "mars-trek-source"
SPATIAL = WORKSPACE / "data" / "homebound" / "metadata" / "spatial_reference.json"
PRODUCT = "Mars_MGS_MOLA_ClrShade_merge_global_463m"
SOURCE_ID = "mars_trek_mola_context"
ENDPOINT = f"https://trek.nasa.gov/tiles/Mars/EQ/{PRODUCT}/1.0.0"
CAPABILITIES = f"{ENDPOINT}/WMTSCapabilities.xml"
MAP_BOUNDS = {"west": 135.9, "south": -7.4, "east": 139.9, "north": -3.4}
ZOOM = 6


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def download(url: str, filename: str, refresh: bool) -> tuple[bytes, dict]:
    path = CACHE / filename
    receipt_path = CACHE / f"{filename}.receipt.json"
    if path.exists() and not refresh:
        receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
        data = path.read_bytes()
        if receipt["url"] != url or receipt["sha256"] != digest(data):
            raise RuntimeError(f"Cached source does not match its download receipt: {filename}")
        return data, receipt
    request = urllib.request.Request(url, headers={"User-Agent": "HOMEBOUND-data-preparation/1.1.11"})
    with urllib.request.urlopen(request, timeout=60) as response:
        if response.status != 200:
            raise RuntimeError(f"NASA Mars Trek returned HTTP {response.status}: {url}")
        data = response.read()
        receipt = {
            "url": url, "retrievedUtc": datetime.now(timezone.utc).isoformat(),
            "bytes": len(data), "sha256": digest(data),
            "contentType": response.headers.get("Content-Type"),
            "lastModified": response.headers.get("Last-Modified"),
        }
    path.write_bytes(data)
    receipt_path.write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    return data, receipt


def study_area(spatial: dict) -> dict:
    wkt = spatial["working_crs_wkt"]
    if 'PROJECTION["Equirectangular"]' not in wkt or spatial["latitude_convention"] != "planetocentric":
        raise ValueError("The study-area transformation requires the recorded Mars equirectangular projection.")
    parameters = {name: float(value) for name, value in re.findall(r'PARAMETER\["([^"]+)",([-+\d.eE]+)\]', wkt)}
    radius = spatial["working_radius_m"]
    xmin, ymin, xmax, ymax = spatial["bounds_projected_m"]
    affine = spatial["model_affine_pixel_corner"]
    if affine["b"] != 0 or affine["d"] != 0 or affine["a"] <= 0 or affine["e"] >= 0:
        raise ValueError("Rotated or reversed source grids need an explicit transformation.")
    height, width = spatial["model_shape"]
    calculated_bounds = [affine["c"], affine["f"] + affine["e"] * height,
                         affine["c"] + affine["a"] * width, affine["f"]]
    if any(abs(a - b) > 1e-8 for a, b in zip(calculated_bounds, [xmin, ymin, xmax, ymax])):
        raise ValueError("The study-area bounds do not match the recorded pixel-corner affine.")

    def geographic(x: float, y: float) -> list[float]:
        longitude = parameters["central_meridian"] + math.degrees(
            (x - parameters["false_easting"]) / (radius * math.cos(math.radians(parameters["standard_parallel_1"]))))
        latitude = math.degrees((y - parameters["false_northing"]) / radius)
        return [longitude, latitude]

    corners = [geographic(x, y) for x, y in [(xmin, ymin), (xmin, ymax), (xmax, ymin), (xmax, ymax)]]
    recorded = spatial["corner_longitude_latitude"]
    if len(recorded) != 4 or any(abs(a - b) > 1e-10 for pair, other in zip(corners, recorded) for a, b in zip(pair, other)):
        raise ValueError("The independent inverse projection disagrees with the prepared geographic corners.")
    return {
        "bounds": {"west": corners[0][0], "south": corners[0][1], "east": corners[2][0], "north": corners[1][1]},
        "widthM": xmax - xmin, "heightM": ymax - ymin,
        "latitudeConvention": "planetocentric", "longitudeConvention": "east-positive",
    }


def prepare(*, refresh: bool) -> None:
    CACHE.mkdir(parents=True, exist_ok=True)
    spatial = json.loads(SPATIAL.read_text(encoding="utf-8"))
    area = study_area(spatial)
    metadata, metadata_receipt = download(CAPABILITIES, "WMTSCapabilities.xml", refresh)
    xml = ET.fromstring(metadata)
    namespaces = {"wmts": "http://www.opengis.net/wmts/1.0", "ows": "http://www.opengis.net/ows/1.1"}
    identifier = xml.find("wmts:Contents/wmts:Layer/ows:Identifier", namespaces)
    if identifier is None or identifier.text != PRODUCT:
        raise ValueError("NASA Mars Trek returned metadata for a different product.")
    matrix = xml.find(f".//wmts:TileMatrix[ows:Identifier='{ZOOM}']", namespaces)
    if matrix is None:
        raise ValueError("The requested WMTS tile matrix is unavailable.")
    matrix_width = int(float(matrix.findtext("wmts:MatrixWidth", namespaces=namespaces)))
    matrix_height = int(float(matrix.findtext("wmts:MatrixHeight", namespaces=namespaces)))
    if matrix_width != 128 or matrix_height != 64:
        raise ValueError("The regional image requires the verified global 128 by 64 tile matrix.")
    degrees_per_tile = 360 / matrix_width
    column_start = math.floor((MAP_BOUNDS["west"] + 180) / degrees_per_tile)
    column_end = math.floor((MAP_BOUNDS["east"] + 180) / degrees_per_tile)
    row_start = math.floor((90 - MAP_BOUNDS["north"]) / degrees_per_tile)
    row_end = math.floor((90 - MAP_BOUNDS["south"]) / degrees_per_tile)
    images = []
    tiles = []
    for row in range(row_start, row_end + 1):
        for column in range(column_start, column_end + 1):
            url = f"{ENDPOINT}/default/default028mm/{ZOOM}/{row}/{column}.jpg"
            image, receipt = download(url, f"mola-z{ZOOM}-r{row}-c{column}.jpg", refresh)
            if not image.startswith(b"\xff\xd8") or not image.endswith(b"\xff\xd9"):
                raise ValueError(f"NASA Mars Trek did not return a complete JPEG tile: {url}")
            images.append(f'<image x="{(column-column_start)*256}" y="{(row-row_start)*256}" width="256" height="256" '
                          f'href="data:image/jpeg;base64,{base64.b64encode(image).decode("ascii")}"/>')
            tiles.append({"row": row, "column": column, **receipt})
    west = column_start * degrees_per_tile - 180
    north = 90 - row_start * degrees_per_tile
    view_x = (MAP_BOUNDS["west"] - west) / degrees_per_tile * 256
    view_y = (north - MAP_BOUNDS["north"]) / degrees_per_tile * 256
    view_size = (MAP_BOUNDS["east"] - MAP_BOUNDS["west"]) / degrees_per_tile * 256
    pixels_per_degree = 672 / (MAP_BOUNDS["east"] - MAP_BOUNDS["west"])

    def point(longitude: float, latitude: float) -> tuple[float, float]:
        return 24 + (longitude - MAP_BOUNDS["west"]) * pixels_per_degree, 84 + (MAP_BOUNDS["north"] - latitude) * pixels_per_degree

    bounds = area["bounds"]
    marker_x, marker_y = point((bounds["west"] + bounds["east"]) / 2, (bounds["north"] + bounds["south"]) / 2)
    footprint_x, footprint_y = point(bounds["west"], bounds["north"])
    footprint_width = (bounds["east"] - bounds["west"]) * pixels_per_degree
    footprint_height = (bounds["north"] - bounds["south"]) * pixels_per_degree
    grid = []
    for longitude in range(136, 140):
        x, _ = point(longitude, MAP_BOUNDS["north"])
        grid.append(f'<path d="M{x:.5f} 84V756" stroke="#fff" stroke-opacity=".24"/><text x="{x:.5f}" y="77" text-anchor="middle">{longitude} E</text>')
    for latitude in range(-4, -8, -1):
        _, y = point(MAP_BOUNDS["west"], latitude)
        grid.append(f'<path d="M24 {y:.5f}H696" stroke="#fff" stroke-opacity=".24"/>'
                    f'<text x="34" y="{y-7:.5f}" fill="#fff" stroke="#17324d" stroke-width="3" paint-order="stroke">{abs(latitude)} S</text>')
    scale_width = math.degrees(50000 / (spatial["working_radius_m"] * math.cos(math.radians(-5.4)))) * pixels_per_degree
    credit = "NASA Mars Trek / NASA MGS-MOLA"
    processing = "Cropped WMTS source tiles, geographic grid and georeferenced study-area locator. No synthetic terrain or new spatial detail."
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="720" height="850" viewBox="0 0 720 850" role="img" aria-labelledby="title description">
<title id="title">HOMEBOUND study area in Gale Crater</title>
<desc id="description">Actual NASA Mars Trek MGS/MOLA regional color-shaded relief, north up. The orange footprint locates the approximately 1.52 kilometre study area near 137.35 degrees east, 5.19 degrees south. The larger locator ring is for visibility, not a route.</desc>
<metadata>{escape(json.dumps({"source": PRODUCT, "credit": credit, "processing": processing}, ensure_ascii=True))}</metadata>
<rect width="720" height="850" fill="#ffffff"/>
<g font-family="Arial, sans-serif" fill="#17324d">
<text x="24" y="33" font-size="24" font-weight="700">Gale Crater: regional setting</text>
<text x="24" y="55" font-size="14">Planetocentric latitude / east-positive longitude</text>
<defs><clipPath id="map-clip"><rect x="24" y="84" width="672" height="672"/></clipPath></defs>
<g clip-path="url(#map-clip)"><g transform="translate(24 84) scale({672/view_size:.10f}) translate({-view_x:.10f} {-view_y:.10f})">{''.join(images)}</g></g>
<g font-size="14">{''.join(grid)}</g>
<rect x="24" y="84" width="672" height="672" fill="none" stroke="#526372"/>
<circle cx="{marker_x:.10f}" cy="{marker_y:.10f}" r="12" fill="none" stroke="#fff" stroke-width="5"/>
<circle cx="{marker_x:.10f}" cy="{marker_y:.10f}" r="12" fill="none" stroke="#b94f2e" stroke-width="3"/>
<rect x="{footprint_x:.10f}" y="{footprint_y:.10f}" width="{footprint_width:.10f}" height="{footprint_height:.10f}" fill="#b94f2e" stroke="#fff" stroke-width="1"/>
<path d="M{marker_x+14:.5f} {marker_y:.5f}h28" stroke="#fff" stroke-width="3"/>
<rect x="{marker_x+41:.5f}" y="{marker_y-17:.5f}" width="120" height="34" rx="5" fill="#ffffff" stroke="#b94f2e" stroke-width="2"/>
<text x="{marker_x+51:.5f}" y="{marker_y+5:.5f}" font-size="18" font-weight="700">Study area</text>
<text x="658" y="122" font-size="20" font-weight="700" fill="#fff" stroke="#17324d" stroke-width="3" paint-order="stroke">N</text>
<path d="M666 158v-27m-6 8 6-8 6 8" fill="none" stroke="#fff" stroke-width="3"/>
<rect x="36" y="702" width="{scale_width+30:.5f}" height="42" rx="4" fill="#fff" fill-opacity=".92"/>
<path d="M51 715v12h{scale_width:.5f}v-12" fill="none" stroke="#17324d" stroke-width="3"/>
<text x="55" y="718" font-size="13">Approx. 50 km</text>
<text x="24" y="784" font-size="15">Locator ring: study area, not a walking route.</text>
<text x="24" y="808" font-size="14">{credit} | Source spacing about 463 m</text>
<text x="24" y="831" font-size="13">Source relief with a cropped view and HOMEBOUND study-area annotation.</text>
</g></svg>
'''
    image = svg.encode("utf-8")
    (WEB / "regional-context.svg").write_bytes(image)
    context = {
        "schemaVersion": 1, "sourceId": SOURCE_ID, "title": "Where is this Marswalk?",
        "imageAsset": "regional-context.svg", "imageSha256": digest(image),
        "description": "HOMEBOUND explores a small area within Gale Crater. This regional map shows its setting; the detailed HiRISE terrain supports the walking-route calculation.",
        "scope": "Regional color-shaded relief only; not a walking-route layer, local slope measurement or geological-unit identification.",
        "usedForRouting": False, "nativeResolutionM": 463, "credit": credit,
        "studyArea": area, "mapBounds": MAP_BOUNDS,
        "serviceMetadata": metadata_receipt, "tiles": tiles,
        "georeferencing": {
            "sourceMetadata": str(SPATIAL.relative_to(WORKSPACE)), "sourceMetadataSha256": digest(SPATIAL.read_bytes()),
            "workingCrsWkt": spatial["working_crs_wkt"], "inverseProjectionCornerToleranceDegrees": 1e-10,
            "mapPixelOrigin": [24, 84], "mapPixelSize": [672, 672],
            "footprintPixels": [footprint_x, footprint_y, footprint_width, footprint_height],
            "locatorCenterPixels": [marker_x, marker_y], "locatorRingRadiusPixels": 12,
            "locatorNote": "The footprint follows the AOI corners; the larger ring is a visibility aid, not a route or destination marker.",
        },
        "processing": processing,
    }
    (WEB / "regional-context.json").write_text(json.dumps(context, indent=2) + "\n", encoding="utf-8")
    primary_row = math.floor((90 - (bounds["north"] + bounds["south"]) / 2) / degrees_per_tile)
    primary_column = math.floor(((bounds["west"] + bounds["east"]) / 2 + 180) / degrees_per_tile)
    primary = next(tile for tile in tiles if tile["row"] == primary_row and tile["column"] == primary_column)
    source_path = WEB / "sources.json"
    catalog = json.loads(source_path.read_text(encoding="utf-8"))
    if [source["id"] for source in catalog["sources"]] not in [
        ["hirise_dem", "hirise_optical", "themis_context_cube"],
        ["hirise_dem", "hirise_optical", "themis_context_cube", SOURCE_ID],
    ]:
        raise ValueError("The source catalog differs from the approved original three products plus the regional context.")
    catalog["sources"] = catalog["sources"][:3] + [{
        "id": SOURCE_ID, "mission": "Mars Global Surveyor", "instrument": "MOLA",
        "data_type": "regional topographic visualization",
        "role": "Regional relief context only; not used for route calculation. This download is the study-area tile; all four mosaic tiles and hashes are recorded in regional-context.json.",
        "product_id": PRODUCT, "url": primary["url"], "provider_page": "https://trek.nasa.gov/mars/",
        "metadata_url": CAPABILITIES,
        "interpretation": "Color-shaded relief served by NASA Mars Trek, based on MGS/MOLA. Approximate native product spacing 463 m. The AOI footprint is georeferenced; the locator ring is enlarged for visibility.",
        "sha256": primary["sha256"], "retrieved_utc": primary["retrievedUtc"],
    }]
    additional_credit = "MOLA regional relief: NASA MGS/MOLA; map service: NASA Mars Trek."
    if additional_credit not in catalog["credit"]:
        catalog["credit"] += " " + additional_credit
    source_path.write_text(json.dumps(catalog, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"sourceId": SOURCE_ID, "tiles": len(tiles), "studyArea": area,
                      "imageBytes": len(image), "imageSha256": context["imageSha256"]}, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Prepare traceable NASA Mars Trek regional context without changing route inputs.")
    parser.add_argument("--refresh", action="store_true", help="Download fresh source metadata and tiles instead of using hash-verified cached originals.")
    prepare(refresh=parser.parse_args().refresh)
