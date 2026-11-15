import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MarswalkPlanner, parseTerrainGrid, parseTravelParameters } from "../dist/engine.js";
import { parseScenario } from "../dist/protocol.js";
import { APPLICATION_VERSION, briefText, destinationsFromConfig, parseRegionalContext, parseSources } from "../dist/workflow.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const workspace = path.resolve(root, "..");
const read = async relative => JSON.parse(await readFile(path.join(workspace, relative), "utf8"));
const hash = data => createHash("sha256").update(data).digest("hex");
const fileHash = async relative => hash(await readFile(path.join(workspace, relative)));
const baseline = await read("decision-model/evidence/regional-context-preservation.json");
const rawSources = await read("data/homebound/web/sources.json");
const raw = await read("data/homebound/web/regional-context.json");
const context = parseRegionalContext(raw, parseSources(rawSources));
const checks = [];
const check = (id, description, evidence) => checks.push({ id, status: "PASS", check: description, evidence });

assert.deepEqual(rawSources.sources.slice(0, 3), baseline.originalSourceCatalog.sources);
assert.equal(rawSources.sources.length, 4);
assert.equal(context.source.id, "mars_trek_mola_context");
assert.equal(rawSources.thermal_limitation, baseline.originalSourceCatalog.thermal_limitation);
check("RD01", "Original source records preserved; new Mars Trek source has a distinct regional role", context.source);

for (const [relative, expected] of Object.entries(baseline.protectedFiles)) assert.equal(await fileHash(relative), expected, relative);
const configuration = await read("decision-model/config/application.json");
const { applicationVersion: previousVersion, ...previousConfiguration } = baseline.previousConfiguration;
const { applicationVersion, defaultPlanningPreset, planningPresets, ...currentConfiguration } = configuration;
assert.equal(applicationVersion, APPLICATION_VERSION);
assert.deepEqual(currentConfiguration, previousConfiguration);
check("RD02", "Engine, ten protected inputs and original scenario/science/default-travel definitions are unchanged; named presets are separate",
  { protectedFiles: Object.keys(baseline.protectedFiles).length, previousVersion, applicationVersion });

const spatialPath = raw.georeferencing.sourceMetadata;
const spatial = await read(spatialPath);
assert.equal(await fileHash(spatialPath), context.georeferencingSourceSha256);
const corners = spatial.corner_longitude_latitude;
assert.deepEqual(context.studyArea.bounds, {
  west: Math.min(...corners.map(point => point[0])), south: Math.min(...corners.map(point => point[1])),
  east: Math.max(...corners.map(point => point[0])), north: Math.max(...corners.map(point => point[1])),
});
const projection = Object.fromEntries([...spatial.working_crs_wkt.matchAll(/PARAMETER\["([^"]+)",([-+\d.eE]+)\]/g)].map(match => [match[1], Number(match[2])]));
const degrees = radians => radians * 180 / Math.PI;
const [xmin, ymin, xmax, ymax] = spatial.bounds_projected_m;
const expectedCorners = [[xmin, ymin], [xmin, ymax], [xmax, ymin], [xmax, ymax]].map(([x, y]) => [
  projection.central_meridian + degrees((x - projection.false_easting) / (spatial.working_radius_m * Math.cos(projection.standard_parallel_1 * Math.PI / 180))),
  degrees((y - projection.false_northing) / spatial.working_radius_m),
]);
for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) assert.ok(Math.abs(expectedCorners[i][j] - corners[i][j]) < 1e-10);
const scale = 672 / (context.mapBounds.east - context.mapBounds.west);
const expectedFootprint = [24 + (context.studyArea.bounds.west - context.mapBounds.west) * scale,
  84 + (context.mapBounds.north - context.studyArea.bounds.north) * scale,
  (context.studyArea.bounds.east - context.studyArea.bounds.west) * scale,
  (context.studyArea.bounds.north - context.studyArea.bounds.south) * scale];
assert.deepEqual(raw.georeferencing.footprintPixels, expectedFootprint);
check("RD03", "Mars inverse projection and plotted AOI footprint independently match the original geographic corners",
  { studyArea: context.studyArea, footprintPixels: expectedFootprint, toleranceDegrees: 1e-10 });

const svgBytes = await readFile(path.join(workspace, "data", "homebound", "web", context.imageAsset));
assert.equal(hash(svgBytes), context.imageSha256);
const svg = svgBytes.toString("utf8");
const embedded = [...svg.matchAll(/<image [^>]+href="data:image\/jpeg;base64,([^"]+)"/g)];
assert.equal(embedded.length, 4);
for (let i = 0; i < raw.tiles.length; i++) {
  const tile = raw.tiles[i];
  const name = `mola-z6-r${tile.row}-c${tile.column}.jpg`;
  const original = await readFile(path.join(root, "evidence", "mars-trek-source", name));
  const receipt = await read(`decision-model/evidence/mars-trek-source/${name}.receipt.json`);
  assert.equal(hash(original), tile.sha256);
  assert.equal(receipt.url, tile.url); assert.equal(receipt.sha256, tile.sha256);
  assert.deepEqual(Buffer.from(embedded[i][1], "base64"), original);
}
assert.equal(await fileHash("decision-model/evidence/mars-trek-source/WMTSCapabilities.xml"), context.serviceMetadata.sha256);
assert.ok(svg.includes("not a walking route") && svg.includes("463 m"));
check("RD04", "All four original NASA tiles, download receipts, service metadata and embedded image pixels match their hashes",
  { tiles: context.tiles, imageSha256: context.imageSha256, serviceMetadata: context.serviceMetadata });

const grid = parseTerrainGrid(await read("data/homebound/web/terrain_grid.json"));
const scenario = parseScenario(await read("data/homebound/web/scenario.json"));
const parameters = parseTravelParameters(await read("decision-model/config/illustrative-preset.json"));
const destinations = destinationsFromConfig(scenario, configuration);
for (const { id, plan: expected } of baseline.referencePlans) {
  const planner = new MarswalkPlanner(grid, scenario.origin, expected.parameters);
  assert.deepEqual(planner.plan(expected.destination, expected.mission), expected, id);
}
assert.equal(parameters.maximumSlopeDegrees, 20);
check("RD05", "Nine complete plans, route cells, times and reserves are identical to the captured 1.1.10 baseline",
  baseline.referencePlans.map(({ id, plan }) => ({ id, status: plan.status, margin: plan.time?.marginMinutes ?? null, reserve: plan.mission.reserveMinutes })));

const practice = destinations[0];
const plan = baseline.referencePlans.find(item => item.id === "P-20").plan;
const brief = briefText(practice, { plan }, null, parseSources(rawSources), null, context);
for (const expected of [context.imageSha256, context.source.productId, context.scope, ...context.tiles.map(tile => tile.sha256)]) assert.ok(brief.includes(expected), expected);
assert.ok(!brief.includes("SCIENCE CONTEXT - IMAGE-SUPPORTED"));
check("RD06", "Practice brief includes complete regional provenance without inheriting S's location-specific science evidence",
  { tileReferences: context.tiles.length, usedForRouting: context.usedForRouting });

const historicalEvidence = [];
const currentPreservation = await read("decision-model/evidence/planning-preset-preservation.json");
for (const [relative, expected] of [...Object.entries(currentPreservation.unchangedDeliverables),
  [baseline.historicalSnapshot, baseline.snapshotSha256], [currentPreservation.historicalSnapshot, currentPreservation.snapshotSha256]]) {
  let actual;
  try {
    actual = await fileHash(relative);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    historicalEvidence.push({ relativePath: relative, status: "NOT_PRESENT", note: "Not distributed in the source-only handoff; not asserted as preserved here." });
    continue;
  }
  assert.equal(actual, expected, relative);
  historicalEvidence.push({ relativePath: relative, status: "PASS", sha256: actual });
}
check("RD07", "Current preset-release media/reference hashes and prior snapshots are verified; old regional media hashes retain historical scope; absent handoff history is not checked",
  { verified: historicalEvidence.filter(item => item.status === "PASS").length, notPresent: historicalEvidence.filter(item => item.status === "NOT_PRESENT").length, historicalEvidence });

const verifiedFiles = {};
for (const relative of ["data/homebound/web/sources.json", "data/homebound/web/regional-context.json",
  "data/homebound/web/regional-context.svg", spatialPath]) verifiedFiles[relative] = await fileHash(relative);
await writeFile(path.join(root, "evidence", "regional-context-data-checks.json"), JSON.stringify({
  applicationVersion: APPLICATION_VERSION, modelVersion: "1.0.0", executedUtc: new Date().toISOString(),
  method: "Actual NASA WMTS originals, hash-checked receipts, independent Mars inverse projection, exact baseline plan comparison, and prepared/export metadata inspection.",
  checks, verifiedFiles, historicalEvidence,
}, null, 2) + "\n");
console.log("Regional context data/model checks:", checks.length, "PASS; nine complete plans unchanged.");
