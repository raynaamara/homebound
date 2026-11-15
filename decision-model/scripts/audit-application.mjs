import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MarswalkPlanner, parseTerrainGrid, parseTravelParameters } from "../dist/engine.js";
import { parseScenario } from "../dist/protocol.js";
import { APPLICATION_VERSION, briefText, comparePlans, destinationsFromConfig, missionWithExtra, parseRegionalContext, parseSources, planningPresetContext, planningPresetsFromConfig } from "../dist/workflow.js";
import { evidenceGeometry, scienceSources } from "../dist/science-context.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const workspace = path.resolve(root, "..");
const read = async filename => JSON.parse(await readFile(filename, "utf8"));
const preserved = await read(path.join(root, "evidence", "application-preserved-inputs.json"));
const checks = [];
const historicalReleaseChecks = [];
let requiredInputsVerified = 0;
for (const [relative, expected] of Object.entries(preserved)) {
  const historical = relative.startsWith("docs\\") || relative.startsWith("docs/");
  if (historical && path.basename(relative).startsWith("~$")) {
    historicalReleaseChecks.push({ relativePath: relative, status: "TRANSIENT_OFFICE_LOCK_NOT_CHECKED", note: "Office session state is not a deliverable or a preserved scientific input." });
    console.warn("Transient Office lock excluded from release preservation:", relative);
    continue;
  }
  let data;
  try {
    data = await readFile(path.join(workspace, relative));
  } catch (error) {
    if (!historical || error.code !== "ENOENT") throw error;
    console.warn("Historical release not distributed in this source-only workspace; not checked:", relative);
    historicalReleaseChecks.push({ relativePath: relative, status: "NOT_PRESENT", note: "Not asserted as preserved in this workspace." });
    continue;
  }
  assert.equal(createHash("sha256").update(data).digest("hex"), expected, relative);
  if (historical) historicalReleaseChecks.push({ relativePath: relative, status: "PASS", sha256: expected });
  else requiredInputsVerified++;
}
assert.equal(requiredInputsVerified, 3);
checks.push({ id: "UNCHANGED-REQUIRED-ENGINE-AND-DATA", status: "PASS", observed: requiredInputsVerified });
const grid = parseTerrainGrid(await read(path.join(workspace, "data", "homebound", "web", "terrain_grid.json")));
const scenario = parseScenario(await read(path.join(workspace, "data", "homebound", "web", "scenario.json")));
const config = await read(path.join(root, "config", "application.json"));
const destinations = destinationsFromConfig(scenario, config);
const parameters = parseTravelParameters(await read(path.join(root, "config", "illustrative-preset.json")));
const presets = planningPresetsFromConfig(scenario, parameters, config);
const sources = parseSources(await read(path.join(workspace, "data", "homebound", "web", "sources.json")));
const regionalContext = parseRegionalContext(await read(path.join(workspace, "data", "homebound", "web", "regional-context.json")), sources);
const planner = new MarswalkPlanner(grid, scenario.origin, parameters);
const mission = { missionBudgetMinutes: 120, scienceMinutes: 20, reserveMinutes: 20 };
const original = planner.plan(destinations[0], mission);
const revised = planner.plan(destinations[0], missionWithExtra(mission, 63));
assert.equal(original.status, "FEASIBLE");
assert.equal(revised.status, "TIME_BUDGET_EXCEEDED");
assert.ok(Math.abs(original.time.marginMinutes - 61.91699854342489) < 1e-8);
assert.ok(Math.abs(revised.time.marginMinutes + 1.0830014565751185) < 1e-8);
checks.push({ id: "PRACTICE-ACTUAL-TERRAIN", status: "PASS", observed: { baseline: original.status, revised: revised.status, margin: revised.time.marginMinutes } });
const comparison = comparePlans(original, revised);
assert.equal(comparison.extraScienceMinutes, 63);
assert.ok(Math.abs(comparison.requiredDeltaMinutes - 63) < 1e-9);
assert.ok(Math.abs(comparison.marginDeltaMinutes + 63) < 1e-9);
checks.push({ id: "COMPARISON-RESERVE-PRESERVED", status: "PASS", observed: comparison });
const originalCases = [];
for (const destination of destinations.filter(item => item.kind === "original_case")) {
  const result = planner.plan(destination, { ...mission, scienceMinutes: destination.scienceMinutes });
  assert.equal(result.status, "NO_MODELED_ROUTE");
  assert.equal(result.time, null);
  originalCases.push({ id: destination.id, status: result.status, destination: result.destination });
}
checks.push({ id: "ORIGINAL-ABC-NOT-MOVED-OR-RELAXED", status: "PASS", observed: originalCases });
const response = {
  kind: "result", requestId: 1, plan: revised, field: planner.scienceOpportunity(revised.mission),
  statistics: planner.statistics, searchRebuilt: false, elapsedMilliseconds: 0,
  geometry: { width: grid.width, height: grid.height, affine: grid.affine, crsWkt: grid.crsWkt, radiusM: grid.radiusM },
};
const text = briefText(destinations[0], response, original, sources, null, regionalContext, presets.presets);
assert.ok(text.includes("Protected reserve: 20.00 min") && text.includes("margin change -63.00 min"));
assert.ok(text.includes("Planning estimates for the selected Mars terrain") && text.includes("qualitative thermal-derived context"));
await writeFile(path.join(root, "evidence", "application-example-brief.txt"), text);
await writeFile(path.join(root, "evidence", "application-example-result.json"), JSON.stringify({
  applicationVersion: APPLICATION_VERSION, destination: destinations[0], planningPreset: planningPresetContext(presets.presets, revised.mission, revised.parameters),
  original, revised, comparison, geometry: response.geometry, sources, regionalContext,
}, null, 2));
checks.push({ id: "TRACEABLE-ENGLISH-BRIEF", status: "PASS", observed: "Actual revised plan and original comparison; not a new scientific validation." });
const scienceDestination = destinations.find(item => item.kind === "science_candidate");
assert.ok(scienceDestination?.science);
const sciencePlan = planner.plan(scienceDestination, { ...mission, scienceMinutes: scienceDestination.scienceMinutes });
assert.equal(sciencePlan.status, "FEASIBLE");
assert.ok(Math.abs(sciencePlan.time.marginMinutes - 67.59608929948027) < 1e-8);
assert.equal(parameters.maximumSlopeDegrees, 20);
checks.push({ id: "SCIENCE-CANDIDATE-ACTUAL-TERRAIN", status: "PASS", observed: { destination: sciencePlan.destination, margin: sciencePlan.time.marginMinutes } });
const geometry = evidenceGeometry(scienceDestination, scienceDestination.science.crop, grid.width, grid.height, 1500, 1500);
assert.deepEqual(geometry, { sourceX: 60, sourceY: 270, sourceWidth: 300, sourceHeight: 300, markerX: 183, markerY: 183, outputSize: 360 });
assert.equal(scienceSources(scienceDestination.science, sources).length, 3);
checks.push({ id: "SCIENCE-EVIDENCE-GEOMETRY-AND-SOURCES", status: "PASS", observed: geometry });
const scienceText = briefText(scienceDestination, { ...response, plan: sciencePlan }, null, sources, null, regionalContext, presets.presets);
for (const expected of [scienceDestination.science.question, "SCIENCE CONTEXT", "3 March 2009", "Location S", "crop row 54, column 12", "Protected reserve: 20.00 min"]) assert.ok(scienceText.includes(expected), expected);
checks.push({ id: "TRACEABLE-SCIENCE-BRIEF", status: "PASS", observed: "Image-supported question, fixed evidence window and original source references retained alongside the actual modeled plan." });
const window = scienceDestination.science.crop;
const elevations = [];
for (let row = window.row; row < window.row + window.size; row++) {
  for (let column = window.column; column < window.column + window.size; column++) {
    const index = row * grid.width + column;
    if (grid.known[index] === 1) elevations.push(grid.elevationM[index]);
  }
}
assert.equal(elevations.length, 3600);
assert.equal(Math.min(...elevations), -2701.418);
assert.equal(Math.max(...elevations), -2665.249);
const opticalBytes = await readFile(path.join(workspace, "data", "homebound", "web", "optical.webp"));
await writeFile(path.join(root, "evidence", "science-selection-evidence.json"), JSON.stringify({
  applicationVersion: APPLICATION_VERSION,
  status: "IMAGE_SUPPORTED_CANDIDATE",
  selectionBasis: "Manual inspection of the prepared HiRISE image; the observed texture contrast motivates an investigation, not a confirmed geological interpretation.",
  destination: scienceDestination,
  opticalDisplay: {
    relativePath: "data/homebound/web/optical.webp",
    sha256: createHash("sha256").update(opticalBytes).digest("hex"),
    source: sources.find(source => source.id === scienceDestination.science.opticalSourceId),
    acquisitionMetadata: scienceDestination.science.observationPageUrl,
    acquisitionDate: scienceDestination.science.opticalObservationDate,
    providerDtmPage: "https://www.uahirise.org/dtm/dtm.php?ID=ESP_012340_1750",
  },
  evidenceGeometry: geometry,
  terrain: {
    knownCells: elevations.length, totalCells: window.size ** 2,
    minimumElevationM: Math.min(...elevations), maximumElevationM: Math.max(...elevations),
    targetElevationM: grid.elevationM[scienceDestination.row * grid.width + scienceDestination.column],
    targetMaximumNativeSlopeDegrees: grid.slopeMaxDegrees[scienceDestination.row * grid.width + scienceDestination.column],
    metresPerCell: grid.affine.a,
  },
  nominalPlan: sciencePlan,
  sources: scienceSources(scienceDestination.science, sources),
  note: "The original P, H/A/B/C inputs and the nominal travel preset are preserved. S is a separate user-approved observation candidate.",
}, null, 2));
await writeFile(path.join(root, "evidence", "application-model-checks.json"), JSON.stringify({
  executedUtc: new Date().toISOString(), applicationVersion: APPLICATION_VERSION, modelVersion: "1.0.0",
  checks, humanUsabilityStudy: "NOT_PERFORMED", scienceValidation: "NOT_PERFORMED",
  historicalReleaseChecks,
  originalCasePolicy: "Preserved as original illustrative cases; guided practice is explicitly hypothetical.",
}, null, 2));
console.log("Application integration checks:", checks.length, "PASS; required engine/data verified.");
console.log("Historical releases:", historicalReleaseChecks.filter(item => item.status === "PASS").length, "verified;", historicalReleaseChecks.filter(item => item.status === "NOT_PRESENT").length, "not present/not checked.");
