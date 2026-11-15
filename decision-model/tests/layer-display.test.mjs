import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseTerrainGrid } from "../dist/engine.js";
import {
  ELEVATION_COLORS, describeLayer, elevationColor, parseLayerMetadata, visibleElevationRange,
} from "../dist/layer-display.js";

const manifest = JSON.parse(readFileSync(new URL("../../data/homebound/web/manifest.json", import.meta.url), "utf8"));
const metadata = parseLayerMetadata(manifest);
function fixture(values = [-2700, -2690, -2500, -2490]) {
  return parseTerrainGrid({
    schema_version: "1.0", width: 2, height: 2, flattening: "row-major", horizontal_units: "metres",
    row_order: "north to south; row zero at top", working_radius_m: 3396036.8126024,
    working_crs_wkt: "Synthetic Mars fixture",
    model_affine_pixel_corner: { a: 5, b: 0, c: 0, d: 0, e: -5, f: 0 },
    elevation_m_mean: values, slope_max_deg: values.map(value => value === null ? null : 0),
    valid_mask: values.map(value => value === null ? 0 : 1),
  });
}

test("elevation uses actual visible negative-elevation endpoints", () => {
  assert.deepEqual(visibleElevationRange(fixture(), { row: 0, column: 0, size: 2 }), { minimum: -2700, maximum: -2490 });
});
test("focusing recomputes display range without changing physical values", () => {
  const grid = fixture();
  const original = Array.from(grid.elevationM);
  assert.deepEqual(visibleElevationRange(grid, { row: 0, column: 0, size: 1 }), { minimum: -2700, maximum: -2700 });
  assert.deepEqual(visibleElevationRange(grid, { row: 1, column: 0, size: 2 }), { minimum: -2500, maximum: -2490 });
  assert.deepEqual(Array.from(grid.elevationM), original);
});
test("partial pixel intersections contribute to the displayed range", () => {
  assert.deepEqual(visibleElevationRange(fixture(), { row: 0.5, column: 0.5, size: 1 }), { minimum: -2700, maximum: -2490 });
});
test("unknown samples never become zero elevation", () => {
  assert.deepEqual(visibleElevationRange(fixture([null, -2690, -2500, null]), { row: 0, column: 0, size: 2 }), { minimum: -2690, maximum: -2500 });
});
test("all-unknown viewport has no fabricated range", () => {
  assert.equal(visibleElevationRange(fixture([null, null, null, null]), { row: 0, column: 0, size: 2 }), null);
});
test("invalid map windows are rejected explicitly", () => {
  assert.throws(() => visibleElevationRange(fixture(), { row: 0, column: 0, size: 0 }));
  assert.throws(() => visibleElevationRange(fixture(), { row: NaN, column: 0, size: 2 }));
});
test("color endpoints match the visible elevation legend", () => {
  const range = { minimum: -2700, maximum: -2650 };
  assert.deepEqual(elevationColor(-2700, range), ELEVATION_COLORS[0]);
  assert.deepEqual(elevationColor(-2650, range), ELEVATION_COLORS.at(-1));
});
test("local elevation variation uses the whole color palette rather than near-black global tones", () => {
  const range = { minimum: -2700, maximum: -2650 };
  const low = elevationColor(-2700, range), high = elevationColor(-2650, range);
  assert.ok(Math.max(...low) >= 100);
  assert.ok(high.reduce((sum, item) => sum + item, 0) - low.reduce((sum, item) => sum + item, 0) > 250);
});
test("constant elevation produces one honest color and one-value legend", () => {
  const range = { minimum: -2700, maximum: -2700 };
  assert.deepEqual(elevationColor(-2700, range), ELEVATION_COLORS[2]);
  const description = describeLayer("elevation", metadata, 380, range, "not_calculated");
  assert.equal(description.scale.colors.length, 1);
  assert.match(description.detail, /shown in one color/);
});
test("invalid colors and reversed ranges do not silently become valid colors", () => {
  assert.throws(() => elevationColor(NaN, { minimum: 0, maximum: 1 }));
  assert.throws(() => elevationColor(0, { minimum: 1, maximum: 0 }));
});
test("native thermal and slope display metadata are read from the actual source manifest", () => {
  assert.equal(metadata.thermalResolutionM, 100);
  assert.equal(metadata.slopeDisplayMaximumDegrees, 60);
});
test("missing or invalid layer metadata fail instead of defaulting silently", () => {
  assert.throws(() => parseLayerMetadata({ display_assets: [] }));
  assert.throws(() => parseLayerMetadata({ display_assets: [
    { url: "thermal_context.png", native_resolution_m: 0 },
    { url: "slope.png", display_range_degrees: [0, 60] },
  ] }));
});
test("uncalculated overlay explicitly discloses its optical base", () => {
  const description = describeLayer("opportunity", metadata, 380, null, "not_calculated");
  assert.match(description.notice, /Complete Activities \/ Review/);
  assert.match(description.notice, /Optical base shown/);
  assert.match(description.title, /not available/);
});
test("calculating and stale overlay states are explicit and distinct", () => {
  assert.match(describeLayer("opportunity", metadata, 380, null, "calculating").notice, /Calculating/);
  assert.match(describeLayer("opportunity", metadata, 380, null, "stale").notice, /Recalculate/);
});
test("current overlay is not mislabeled unavailable and keeps the non-safety interpretation", () => {
  const description = describeLayer("opportunity", metadata, 380, null, "current");
  assert.equal(description.notice, null);
  assert.match(description.detail, /routing and time-budget outcomes/);
});
test("thermal legend honestly uses DN and native resolution, not fabricated temperature", () => {
  const description = describeLayer("thermal", metadata, 379.38, null, "not_calculated");
  assert.equal(description.scale.units, "DN");
  assert.deepEqual([description.scale.minimum, description.scale.maximum], [0, 255]);
  assert.match(description.detail, /100 m/);
  assert.match(description.detail, /3\.8 native pixel widths/);
  assert.match(description.detail, /relative display codes for qualitative thermal context/);
});
test("elevation legend describes view-dependent contrast, datum, and unavailable data", () => {
  const description = describeLayer("elevation", metadata, 380, { minimum: -2700, maximum: -2650 }, "not_calculated");
  assert.equal(description.scale.units, "m");
  assert.match(description.scale.title, /source Mars datum/);
  assert.match(description.detail, /numeric terrain and model inputs are unchanged/);
  const unknown = describeLayer("elevation", metadata, 380, null, "not_calculated");
  assert.equal(unknown.scale, null);
  assert.match(unknown.notice, /unavailable/);
});
test("slope and optical descriptions retain their distinct meanings", () => {
  assert.equal(describeLayer("slope", metadata, 380, null, "current").scale.units, "degrees");
  assert.match(describeLayer("optical", metadata, 380, null, "current").detail, /visual surface context/);
  assert.throws(() => describeLayer("invented", metadata, 380, null, "current"));
});
