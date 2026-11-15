import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MarswalkPlanner, parseTerrainGrid, parseTravelParameters } from "../dist/engine.js";
import { parseScenario } from "../dist/protocol.js";
import {
  APPLICATION_VERSION, briefText, destinationsFromConfig, parseRegionalContext, parseSources,
  planningPresetContext, planningPresetsFromConfig,
} from "../dist/workflow.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const workspace = path.resolve(root, "..");
const read = async relative => JSON.parse(await readFile(path.join(workspace, relative), "utf8"));
const hash = data => createHash("sha256").update(data).digest("hex");
const fileHash = async relative => hash(await readFile(path.join(workspace, relative)));
const preserved = await read("decision-model/evidence/planning-preset-preservation.json");
const configuration = await read("decision-model/config/application.json");
const scenario = parseScenario(await read("data/homebound/web/scenario.json"));
const nominal = parseTravelParameters(await read("decision-model/config/illustrative-preset.json"));
const catalog = planningPresetsFromConfig(scenario, nominal, configuration);
const destinations = destinationsFromConfig(scenario, configuration);
const grid = parseTerrainGrid(await read("data/homebound/web/terrain_grid.json"));
const sources = parseSources(await read("data/homebound/web/sources.json"));
const regional = parseRegionalContext(await read("data/homebound/web/regional-context.json"), sources);
const checks = [];
const examples = [];
const check = (id, description, evidence) => checks.push({ id, status: "PASS", check: description, evidence });
const cell = ({ row, column }) => ({ row, column });
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

for (const [relative, expected] of Object.entries(preserved.protectedFiles)) assert.equal(await fileHash(relative), expected, relative);
const metadataRevision = preserved.publicPackageMetadataRevision;
const svgPath = "data\\homebound\\web\\regional-context.svg";
const contextPath = "data\\homebound\\web\\regional-context.json";
const regionalSvg = await readFile(path.join(workspace, svgPath), "utf8");
const regionalJson = await readFile(path.join(workspace, contextPath), "utf8");
const metadataParts = [...regionalSvg.matchAll(/<metadata>[\s\S]*?<\/metadata>/g)];
assert.equal(metadataParts.length, 1);
assert.equal(hash(regionalSvg.replace(metadataParts[0][0], "")), metadataRevision.svgOutsideMetadataSha256);
assert.equal(hash(regionalJson.replace(regional.imageSha256, metadataRevision.originalFiles[svgPath])),
  metadataRevision.originalFiles[contextPath]);
const { applicationVersion: previousVersion, ...previousConfiguration } = preserved.previousConfiguration;
const { applicationVersion, defaultPlanningPreset, planningPresets, ...currentConfiguration } = configuration;
assert.equal(applicationVersion, APPLICATION_VERSION);
assert.deepEqual(currentConfiguration, previousConfiguration);
check("PD01", "Engine, scientific inputs, waypoint coordinates and science definitions are unchanged; regional production metadata revision is explicitly verified",
  { protectedFiles: Object.keys(preserved.protectedFiles).length, previousVersion, applicationVersion, publicPackageMetadataRevision: metadataRevision });

assert.equal(catalog.defaultPreset.id, "science_walkthrough");
assert.deepEqual(catalog.defaultPreset.parameters, nominal);
assert.equal(catalog.defaultPreset.missionBudgetMinutes, scenario.missionBudgetMinutes);
assert.equal(catalog.defaultPreset.reserveMinutes, scenario.reserveMinutes);
const terrain = catalog.presets.find(preset => preset.id === "terrain_exploration");
assert.ok(terrain);
assert.equal(terrain.reserveMinutes, 20);
assert.equal(terrain.parameters.baseSpeedMPerMin, 30);
assert.equal(terrain.parameters.uphillPenalty, 4);
assert.equal(terrain.parameters.downhillPenalty, 2);
check("PD02", "Science retains the initial 120-minute/20-degree example; both presets preserve shared assumptions", catalog);

const sciencePlanner = new MarswalkPlanner(grid, scenario.origin, catalog.defaultPreset.parameters);
const oldPlans = (await read("decision-model/evidence/regional-context-preservation.json")).referencePlans;
const scienceCases = [];
for (const id of ["S-20", "S-88", "S-85"]) {
  const expected = oldPlans.find(item => item.id === id).plan;
  const plan = sciencePlanner.plan(cell(expected.destination), expected.mission);
  assert.deepEqual(plan, { ...expected, destination: cell(expected.destination) }, id);
  assert.equal(planningPresetContext(catalog.presets, plan.mission, plan.parameters).id, "science_walkthrough");
  examples.push({ id, plan });
  scienceCases.push({ id, status: plan.status, margin: plan.time.marginMinutes, reserve: plan.mission.reserveMinutes });
}
check("PD03", "Science S 20/88/85 retains exact routes, times, statuses and protected reserve", scienceCases);

const terrainPlanner = new MarswalkPlanner(grid, scenario.origin, terrain.parameters);
const expectedTerrain = {
  A: [21.734604065821443, 17.75714151420771, 79.49174558002915, 100.50825441997085],
  B: [68.23230598293063, 56.532183288156695, 169.7644892710873, 10.235510728912686],
  C: [60.339491389044085, 52.19740916378039, 162.53690055282448, 17.463099447175523],
};
const terrainCases = [];
for (const destination of destinations.filter(item => item.kind === "original_case")) {
  const mission = { missionBudgetMinutes: terrain.missionBudgetMinutes, reserveMinutes: terrain.reserveMinutes, scienceMinutes: destination.scienceMinutes };
  const plan = terrainPlanner.plan(cell(destination), mission);
  assert.equal(plan.status, "FEASIBLE", destination.id);
  assert.ok(plan.outbound.cells.length > 1 && plan.return.cells.length > 1);
  const expected = expectedTerrain[destination.id];
  [plan.time.outboundMinutes, plan.time.returnMinutes, plan.time.requiredMinutes, plan.time.marginMinutes].forEach((value, i) => close(value, expected[i]));
  assert.equal(planningPresetContext(catalog.presets, plan.mission, plan.parameters).id, "terrain_exploration");
  examples.push({ id: `terrain-${destination.id}`, plan });
  terrainCases.push({ destination: destination.id, ...plan.time });
}
check("PD04", "Terrain exploration gives original A/B/C complete routes that fit 180 minutes, with original observation durations", terrainCases);

const shortCases = [];
for (const id of ["B", "C"]) {
  const original = examples.find(item => item.id === `terrain-${id}`).plan;
  const plan = terrainPlanner.plan(original.destination, { ...original.mission, missionBudgetMinutes: 120 });
  assert.equal(plan.status, "TIME_BUDGET_EXCEEDED");
  assert.ok(plan.outbound !== null && plan.return !== null);
  assert.equal(planningPresetContext(catalog.presets, plan.mission, plan.parameters).id, null);
  examples.push({ id: `custom-${id}-120`, plan });
  shortCases.push({ id, status: plan.status, margin: plan.time.marginMinutes });
}
check("PD05", "A larger slope allowance opens routes but does not hide B/C budget overruns at 120 minutes", shortCases);

const before = JSON.stringify(catalog);
const terrainB = examples.find(item => item.id === "terrain-B").plan;
const customPlan = terrainPlanner.plan(terrainB.destination, { ...terrainB.mission, missionBudgetMinutes: 181 });
const custom = planningPresetContext(catalog.presets, customPlan.mission, customPlan.parameters);
assert.equal(custom.id, null); assert.equal(custom.name, "Custom settings");
assert.equal(JSON.stringify(catalog), before);
examples.push({ id: "custom-B-181", plan: customPlan });
check("PD06", "A manual assumption edit is labeled Custom from its actual calculated inputs without mutating either preset", custom);

for (const id of ["terrain-B", "custom-B-181"]) {
  const plan = examples.find(item => item.id === id).plan;
  const destination = destinations.find(item => item.id === "B");
  const brief = briefText(destination, { plan }, null, sources, null, regional, catalog.presets);
  assert.ok(brief.includes(`Planning preset: ${id === "terrain-B" ? "Terrain exploration" : "Custom settings"}`));
  assert.ok(brief.includes(`Mission budget: ${plan.mission.missionBudgetMinutes.toFixed(2)} min`));
  assert.ok(brief.includes("slope limit 30 degrees") && brief.includes("Protected reserve: 20.00 min"));
  assert.ok(brief.includes(regional.imageSha256));
  assert.ok(!brief.includes("SCIENCE CONTEXT - IMAGE-SUPPORTED"));
}
check("PD07", "Named and custom text briefs retain calculated assumptions and NASA provenance without inheriting S science",
  { checked: ["terrain-B", "custom-B-181"], sources: sources.length });

const historicalEvidence = [];
for (const [relative, expected] of [...Object.entries(preserved.unchangedDeliverables), [preserved.historicalSnapshot, preserved.snapshotSha256]]) {
  let actual;
  try { actual = await fileHash(relative); } catch (error) {
    if (error.code !== "ENOENT") throw error;
    historicalEvidence.push({ relativePath: relative, status: "NOT_PRESENT", note: "Not distributed in the source-only handoff; not asserted as preserved here." });
    continue;
  }
  assert.equal(actual, expected, relative);
  historicalEvidence.push({ relativePath: relative, status: "PASS", sha256: actual });
}
check("PD08", "Current deck, video and reference documents plus the previous application/register snapshot remain untouched",
  { verified: historicalEvidence.filter(item => item.status === "PASS").length, notPresent: historicalEvidence.filter(item => item.status === "NOT_PRESENT").length });

const verifiedFiles = { ...preserved.protectedFiles, "decision-model/config/application.json": await fileHash("decision-model/config/application.json") };
await writeFile(path.join(root, "evidence", "planning-preset-examples.json"), JSON.stringify({
  applicationVersion: APPLICATION_VERSION, modelVersion: "1.0.0", examples,
  note: "Actual engine plans with cell-only destinations, matching the browser worker boundary.",
}, null, 2) + "\n");
await writeFile(path.join(root, "evidence", "planning-preset-data-checks.json"), JSON.stringify({
  applicationVersion: APPLICATION_VERSION, modelVersion: "1.0.0", executedUtc: new Date().toISOString(),
  method: "Actual prepared terrain, exact Science baseline comparisons, independently specified A/B/C time expectations, calculated-input preset matching, and SHA-256 preservation.",
  checks, verifiedFiles, historicalEvidence,
}, null, 2) + "\n");
console.log("Planning-preset data/model checks:", checks.length, "PASS; Science unchanged; Terrain A/B/C fit.");
