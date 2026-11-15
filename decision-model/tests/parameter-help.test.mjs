import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { MarswalkPlanner, parseTerrainGrid } from "../dist/engine.js";

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const helps = {
  budget: "budget-help", science: "science-help", reserve: "reserve-help",
  speed: "speed-help", "slope-limit": "slope-help", uphill: "uphill-help", downhill: "downhill-help",
};
function paragraph(id) {
  const found = html.match(new RegExp(`<p[^>]*id="${id}"[^>]*>([\\s\\S]*?)<\\/p>`));
  assert.ok(found, `Missing visible helper ${id}`);
  return found[1].replace(/<[^>]*>/g, "");
}
function examplePlanner() {
  const grid = parseTerrainGrid({
    schema_version: "1.0", width: 2, height: 1, flattening: "row-major", horizontal_units: "metres",
    row_order: "north to south; row zero at top", working_radius_m: 3396036.8126024,
    working_crs_wkt: "Synthetic Mars parameter-example fixture, not an observation",
    model_affine_pixel_corner: { a: 10, b: 0, c: 0, d: 0, e: -10, f: 0 },
    elevation_m_mean: [0, 1], slope_max_deg: [0, 0], valid_mask: [1, 1],
  });
  return new MarswalkPlanner(grid, { row: 0, column: 0 }, {
    baseSpeedMPerMin: 30, maximumSlopeDegrees: 20, uphillPenalty: 4, downhillPenalty: 2,
  });
}

test("all seven parameters have nonempty visible helper text and accessible associations", () => {
  for (const [id, helper] of Object.entries(helps)) {
    const tag = html.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`))?.[0];
    assert.ok(tag && new RegExp(`aria-describedby="[^"]*\\b${helper}\\b`).test(tag), id);
    assert.ok(paragraph(helper).length > 30, helper);
  }
});
test("budget, observation and reserve definitions distinguish travel and protected time", () => {
  assert.match(paragraph("budget-help"), /outbound travel, observation, return travel/);
  assert.match(paragraph("science-help"), /excluding travel/);
  assert.match(paragraph("reserve-help"), /not available for additional observation/);
  assert.match(paragraph("reserve-margin-help"), /Extra margin.*left after/);
});
test("advanced parameters explain direction, units and non-operational assumptions", () => {
  assert.match(paragraph("speed-help"), /flat terrain/);
  assert.match(paragraph("slope-help"), /Steeper terrain or steps are excluded/);
  assert.match(paragraph("uphill-help"), /climbing.*Higher values/);
  assert.match(paragraph("downhill-help"), /descending.*Higher values/);
  assert.equal((html.match(/coefficient <span>\(unitless\)<\/span>/g) ?? []).length, 2);
  assert.match(paragraph("assumptions-warning"), /Adjustable planning assumptions/);
});
test("technical help is a native expandable disclosure rather than a hover-only tooltip", () => {
  assert.match(html, /<details id="parameter-explanation"><summary>How these assumptions affect the model<\/summary>/);
  assert.match(html, /A value of 4 is not four minutes or a direct four-times multiplier/);
});
test("uphill coefficient example agrees with the actual engine edge-time formula", () => {
  const model = examplePlanner();
  const baseTime = Math.hypot(10, 1) / 30;
  assert.ok(Math.abs(model.edgeMinutes(0, 1) / baseTime - 1.4) < 1e-12);
  assert.match(html, /10% uphill<\/th><td>4<\/td><td>1\.40/);
});
test("downhill coefficient example agrees with the actual engine edge-time formula", () => {
  const model = examplePlanner();
  const baseTime = Math.hypot(10, 1) / 30;
  assert.ok(Math.abs(model.edgeMinutes(1, 0) / baseTime - 1.2) < 1e-12);
  assert.match(html, /10% downhill<\/th><td>2<\/td><td>1\.20/);
});
test("percent grade is not mislabeled as degrees or astronaut calibration", () => {
  assert.ok(Math.abs(Math.atan(0.1) * 180 / Math.PI - 5.71) < 0.001);
  assert.match(html, /10% grade is about 5\.71 degrees, not 10 degrees/);
  assert.match(html, /affect the travel-time estimate/);
});
test("extra observation help identifies addition rather than replacing the original", () => {
  assert.match(paragraph("extra-help"), /Added to the original observation duration/);
  assert.match(html, /id="extra"[^>]*aria-describedby="extra-help"/);
});
