import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { MarswalkPlanner, parseTerrainGrid, parseTravelParameters } from "../dist/engine.js";
import { parseScenario } from "../dist/protocol.js";
import { briefText, destinationsFromConfig, markerKey, parseSources } from "../dist/workflow.js";
import { evidenceGeometry, parseScienceContext, scienceBriefLines, scienceExportContext, scienceSources } from "../dist/science-context.js";

const read = file => JSON.parse(readFileSync(new URL(file, import.meta.url), "utf8"));
const config = read("../config/application.json");
const scenario = parseScenario(read("../../data/homebound/web/scenario.json"));
const destinations = destinationsFromConfig(scenario, config);
const selected = destinations.find(item => item.id === "S");
const science = selected.science;
const sourcesRaw = read("../../data/homebound/web/sources.json");
const sources = parseSources(sourcesRaw);
const grid = parseTerrainGrid(read("../../data/homebound/web/terrain_grid.json"));
const parameters = parseTravelParameters(read("../config/illustrative-preset.json"));
const planner = new MarswalkPlanner(grid, scenario.origin, parameters);
const mission = { missionBudgetMinutes: 120, scienceMinutes: 20, reserveMinutes: 20 };
const plan = planner.plan(selected, mission);
const response = { plan };
const summary = {
  location: { row: 84, column: 42 }, markerCode: "S", crop: science.crop,
  opticalSourceId: science.opticalSourceId, terrainSourceId: science.terrainSourceId,
  viewWidthM: 60 * grid.affine.a, opticalDisplayMetresPerPixel: grid.affine.a / 5,
};

test("the new science point has its own identity without repurposing practice or originals", () => {
  assert.equal(selected.kind, "science_candidate");
  assert.deepEqual([selected.row, selected.column], [84, 42]);
  assert.equal(destinations[0].kind, "hypothetical_practice");
  assert.equal(destinations[0].science, null);
  for (const point of scenario.targets) {
    const result = destinations.find(item => item.id === point.id);
    assert.deepEqual([result.row, result.column, result.scienceMinutes], [point.row, point.column, point.scienceMinutes]);
    assert.equal(result.kind, "original_case"); assert.equal(result.science, null);
  }
});
test("science IDs cannot conflict with P, H, X or an original example", () => {
  for (const id of ["P", "H", "X", "A"]) assert.throws(() => destinationsFromConfig(scenario, {
    ...config, scienceCandidate: { ...config.scienceCandidate, id },
  }));
});
test("science status describes an image-supported question rather than validated geology", () => {
  assert.equal(science.status, "image_supported_candidate");
  assert.match(science.question, /texture|linear-patterned/);
  assert.match(science.interpretation, /illumination/);
  assert.throws(() => parseScienceContext({ ...science, status: "validated_geology" }, selected, 300, 300));
});
test("all science narrative fields and source identities are required", () => {
  for (const key of ["question", "observationTask", "whyHere", "observed", "interpretation", "opticalObservationDate", "opticalSourceId", "terrainSourceId", "thermalSourceId"]) {
    assert.throws(() => parseScienceContext({ ...science, [key]: "" }, selected, 300, 300), key);
  }
});
test("the crop maps the exact selected cell center into the prepared optical image", () => {
  assert.deepEqual(evidenceGeometry(selected, science.crop, 300, 300, 1500, 1500), {
    sourceX: 60, sourceY: 270, sourceWidth: 300, sourceHeight: 300,
    markerX: 183, markerY: 183, outputSize: 360,
  });
});
test("off-grid, unrelated and non-integer crop geometry is rejected explicitly", () => {
  for (const crop of [{ row: 290, column: 12, size: 60 }, { row: 0, column: 0, size: 10 },
    { row: 54, column: 12, size: 0 }, { row: 54, column: 12, size: 1.5 }]) {
    assert.throws(() => evidenceGeometry(selected, crop, 300, 300, 1500, 1500));
  }
});
test("evidence sources retain three distinct roles and reject unknown IDs", () => {
  const resolved = scienceSources(science, sources);
  assert.deepEqual(resolved.map(item => item.source.id), ["hirise_optical", "hirise_dem", "themis_context_cube"]);
  assert.match(resolved[2].role, /Regional qualitative.*100 m/);
  assert.throws(() => scienceSources({ ...science, opticalSourceId: "unknown" }, sources));
  assert.throws(() => scienceSources({ ...science, opticalSourceId: science.terrainSourceId, terrainSourceId: science.opticalSourceId }, sources));
  assert.throws(() => parseScienceContext({ ...science, thermalSourceId: science.opticalSourceId }, selected, 300, 300));
});
test("observation and source-provider links reject executable protocols", () => {
  assert.throws(() => parseScienceContext({ ...science, observationPageUrl: "javascript:alert(1)" }, selected, 300, 300));
  assert.throws(() => parseSources({ sources: [{ ...sourcesRaw.sources[0], provider_page: "javascript:alert(1)" }] }));
});
test("the image-supported candidate has a nominal round trip without relaxing the preset", () => {
  assert.equal(parameters.maximumSlopeDegrees, 20);
  assert.equal(plan.status, "FEASIBLE");
  assert.ok(Math.abs(plan.time.marginMinutes - 67.59608929948027) < 1e-10);
  assert.equal(plan.mission.reserveMinutes, 20);
});
test("the candidate can exceed its budget while the protected reserve remains intact", () => {
  const revised = planner.plan(selected, { ...mission, scienceMinutes: 88 });
  assert.equal(revised.status, "TIME_BUDGET_EXCEEDED");
  assert.ok(Math.abs(revised.time.marginMinutes + 0.40391070051973) < 1e-10);
  assert.equal(revised.mission.reserveMinutes, 20);
});
test("a stricter route assumption changes feasibility without changing the science rationale", () => {
  const before = JSON.stringify(science);
  const strict = new MarswalkPlanner(grid, scenario.origin, { ...parameters, maximumSlopeDegrees: 10 });
  assert.equal(strict.plan(selected, mission).status, "NO_MODELED_ROUTE");
  assert.equal(JSON.stringify(science), before);
});
test("the recorded evidence window has the measured complete terrain context", () => {
  const values = [];
  for (let row = 54; row < 114; row++) for (let column = 12; column < 72; column++) {
    const index = row * 300 + column; assert.equal(grid.known[index], 1); values.push(grid.elevationM[index]);
  }
  assert.equal(values.length, 3600);
  assert.equal(Math.min(...values), -2701.418);
  assert.equal(Math.max(...values), -2665.249);
  assert.equal(grid.elevationM[84 * 300 + 42], -2685.702);
});
test("science text brief retains the question, task, window, date and source provenance", () => {
  const text = briefText(selected, response, null, sources, summary);
  for (const expected of [science.question, science.observationTask, science.observed, "3 March 2009",
    science.observationPageUrl, "crop row 54, column 12", "Location S", "Protected reserve: 20.00 min", "SHA-256"]) assert.ok(text.includes(expected), expected);
});
test("a science brief cannot be paired with another calculated destination", () => {
  assert.throws(() => briefText(selected, { plan: { ...plan, destination: { row: 70, column: 37 } } }, null, sources));
});
test("practice briefs do not inherit a previously selected science evidence window", () => {
  assert.deepEqual(scienceBriefLines(destinations[0], sources), []);
  assert.throws(() => scienceBriefLines(destinations[0], sources, summary));
});
test("mismatched evidence location, crop or source is rejected", () => {
  for (const changed of [{ ...summary, location: { row: 70, column: 37 } },
    { ...summary, markerCode: "P" }, { ...summary, crop: { ...science.crop, column: 13 } }, { ...summary, opticalSourceId: "hirise_dem" }]) {
    assert.throws(() => scienceBriefLines(selected, sources, changed));
  }
});
test("structured science exports retain exact evidence and source roles", () => {
  const exported = scienceExportContext(selected, sources, summary);
  assert.equal(exported.question, science.question);
  assert.equal(exported.markerCode, "S");
  assert.deepEqual(exported.location, { row: 84, column: 42 });
  assert.equal(exported.references.length, 3);
  assert.equal(exported.evidence, summary);
});
test("structured exports reject missing evidence and clear science for planning-only points", () => {
  assert.throws(() => scienceExportContext(selected, sources, null));
  assert.equal(scienceExportContext(destinations[0], sources, null), null);
  assert.throws(() => scienceExportContext(destinations[0], sources, summary));
});
test("the marker key explicitly distinguishes practice, science and custom points", () => {
  const key = markerKey(destinations);
  assert.deepEqual(key.map(item => item.code), ["H", "P", "S", "A", "B", "C", "X"]);
  assert.match(key.find(item => item.code === "S").note, /Image-supported science/);
});
test("science explanations are native disclosures and the review has a dedicated summary", () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(html, /<details id="science-context"><summary>Why this location\?<\/summary>/);
  assert.ok(html.includes('id="science-review"'));
});
