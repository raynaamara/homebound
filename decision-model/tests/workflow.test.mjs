import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseTravelParameters } from "../dist/engine.js";
import { parseScenario } from "../dist/protocol.js";
import {
  APPLICATION_VERSION, CLAIM_BOUNDARY, assumptionSummary, briefText, comparePlans,
  decisionTitle, destinationCode, destinationLabel, destinationsFromConfig, markerKey,
  minutes, missionWithExtra, nextAction, parseRegionalContext, parseSources,
  planningPresetContext, planningPresetForInputs, planningPresetsFromConfig, regionalBriefLines, requestKey,
} from "../dist/workflow.js";

const read = url => JSON.parse(readFileSync(new URL(url, import.meta.url), "utf8"));
const scenario = parseScenario(read("../../data/homebound/web/scenario.json"));
const config = read("../config/application.json");
const sourceData = read("../../data/homebound/web/sources.json");
const audit = read("../evidence/model-audit.json");
const original = audit.connectedCellWitness.result;
const revised = audit.connectedCellWitness.extraTaskResult;
const destinations = destinationsFromConfig(scenario, config);
const sources = parseSources(sourceData);
const nominal = parseTravelParameters(read("../config/illustrative-preset.json"));
const presets = planningPresetsFromConfig(scenario, nominal, config);
const regionalRaw = read("../../data/homebound/web/regional-context.json");
const regional = parseRegionalContext(regionalRaw, sources);
const response = plan => ({ plan, geometry: {}, statistics: {}, kind: "result", requestId: 1 });

test("Science remains the default and observation-only edits retain its preset identity", () => {
  assert.equal(presets.defaultPreset.id, "science_walkthrough");
  assert.equal(planningPresetForInputs(presets.presets, original.mission, original.parameters), presets.defaultPreset);
  assert.equal(planningPresetForInputs(presets.presets, revised.mission, revised.parameters), presets.defaultPreset);
});
test("planning presets reject unknown or duplicate IDs, invalid ranges and a changed Science default", () => {
  for (const changed of [
    { planningPresets: [config.planningPresets[0], config.planningPresets[0]] },
    { planningPresets: config.planningPresets.map(item => ({ ...item, id: "automatic_relaxation" })) },
    { planningPresets: config.planningPresets.map(item => ({ ...item, maximumSlopeDegrees: 90 })) },
    { planningPresets: config.planningPresets.map(item => ({ ...item, missionBudgetMinutes: -1 })) },
    { planningPresets: config.planningPresets.map(item => ({ ...item, missionBudgetMinutes: 180 })) },
    { defaultPlanningPreset: "terrain_exploration" },
    { defaultPlanningPreset: "missing" },
  ]) assert.throws(() => planningPresetsFromConfig(scenario, nominal, { ...config, ...changed }));
});
test("all six preset-controlled inputs must match; incomplete and manually edited values stay Custom", () => {
  const before = JSON.stringify(presets);
  for (const field of ["missionBudgetMinutes", "reserveMinutes"]) {
    const mission = { ...original.mission, [field]: original.mission[field] + 1 };
    assert.equal(planningPresetForInputs(presets.presets, mission, original.parameters), null);
    assert.equal(planningPresetContext(presets.presets, mission, original.parameters).name, "Custom settings");
  }
  for (const field of ["baseSpeedMPerMin", "maximumSlopeDegrees", "uphillPenalty", "downhillPenalty"]) {
    assert.equal(planningPresetForInputs(presets.presets, original.mission, { ...original.parameters, [field]: original.parameters[field] + 1 }), null);
  }
  assert.equal(planningPresetForInputs(presets.presets, { ...original.mission, missionBudgetMinutes: NaN }, original.parameters), null);
  assert.equal(JSON.stringify(presets), before);
});
test("brief preset identity follows the calculated assumptions, including extended observation", () => {
  for (const plan of [original, revised]) {
    const brief = briefText(destinations[0], response(plan), null, sources, null, null, presets.presets);
    assert.match(brief, /Planning preset: Science walkthrough/);
    assert.ok(brief.includes(`Observation: ${plan.mission.scienceMinutes.toFixed(2)} min`));
    assert.match(brief, /observation duration is separate/);
  }
});

test("guided destination is explicitly hypothetical and retains the verified witness coordinates", () => {
  assert.equal(destinations[0].kind, "hypothetical_practice");
  assert.equal(destinations[0].row, 70);
  assert.equal(destinations[0].column, 37);
  assert.match(destinations[0].evidence, /guided round-trip planning exercise/);
});
test("all original scenario destinations retain their exact coordinates and task durations", () => {
  for (const point of scenario.targets) {
    const result = destinations.find(destination => destination.id === point.id);
    assert.equal(result.row, point.row); assert.equal(result.column, point.column);
    assert.equal(result.scienceMinutes, point.scienceMinutes);
    assert.equal(result.kind, "original_case");
  }
});
test("application config rejects an unapproved version or policy", () => {
  assert.throws(() => destinationsFromConfig(scenario, { ...config, applicationVersion: "999" }));
  assert.throws(() => destinationsFromConfig(scenario, { ...config, scenarioPolicy: "silently_relax_limits" }));
});
test("practice cannot be presented as a validated target or placed outside the data grid", () => {
  assert.throws(() => destinationsFromConfig(scenario, { ...config, practice: { ...config.practice, kind: "validated_science" } }));
  assert.throws(() => destinationsFromConfig(scenario, { ...config, practice: { ...config.practice, row: 300 } }));
});
test("practice identifiers and original descriptions are validated", () => {
  assert.throws(() => destinationsFromConfig(scenario, { ...config, practice: { ...config.practice, id: "A" } }));
  assert.throws(() => destinationsFromConfig(scenario, { ...config, originalCases: {} }));
});
test("source parsing preserves the original three records and adds a distinct regional source", () => {
  const originalSources = read("../evidence/regional-context-preservation.json").originalSourceCatalog.sources;
  assert.deepEqual(sourceData.sources.slice(0, 3), originalSources);
  assert.equal(sources.length, originalSources.length + 1);
  assert.equal(sources[0].sha256.length, 64);
  assert.match(sources[0].url, /^https:/);
  assert.match(regional.source.role, /not used for route calculation/);
});
test("source references reject executable URLs and missing identities", () => {
  assert.throws(() => parseSources({ sources: [{ ...sourceData.sources[0], url: "javascript:alert(1)" }] }));
  assert.throws(() => parseSources({ sources: [{ ...sourceData.sources[0], product_id: "" }] }));
});
test("regional context retains a contained Mars footprint and complete matching source-tile provenance", () => {
  assert.deepEqual(regional.studyArea.bounds, regionalRaw.studyArea.bounds);
  assert.ok(regional.studyArea.bounds.west > regional.mapBounds.west && regional.studyArea.bounds.east < regional.mapBounds.east);
  assert.equal(regional.studyArea.latitudeConvention, "planetocentric");
  assert.equal(regional.usedForRouting, false);
  assert.equal(regional.source, sources.find(source => source.id === regionalRaw.sourceId));
  assert.ok(regional.tiles.some(tile => tile.url === regional.source.url && tile.sha256 === regional.source.sha256));
});
test("regional context rejects route-role changes, external image paths, bad hashes and incomplete tiles", () => {
  for (const changed of [{ usedForRouting: true }, { sourceId: "hirise_dem" }, { imageAsset: "https://example.com/map.svg" },
    { imageSha256: "not-a-hash" }, { tiles: regionalRaw.tiles.slice(1) },
    { tiles: regionalRaw.tiles.map(() => regionalRaw.tiles[0]) },
    { tiles: regionalRaw.tiles.map(tile => ({ ...tile, sha256: "0".repeat(64) })) }]) {
    assert.throws(() => parseRegionalContext({ ...regionalRaw, ...changed }, sources));
  }
  assert.throws(() => parseRegionalContext(regionalRaw, [...sources, regional.source]));
});
test("regional context rejects Earth conventions, reversed bounds and a footprint outside its map", () => {
  for (const changed of [
    { studyArea: { ...regionalRaw.studyArea, latitudeConvention: "Earth WGS84" } },
    { studyArea: { ...regionalRaw.studyArea, bounds: { ...regionalRaw.studyArea.bounds, west: 150, east: 151 } } },
    { mapBounds: { ...regionalRaw.mapBounds, north: regionalRaw.mapBounds.south } },
  ]) assert.throws(() => parseRegionalContext({ ...regionalRaw, ...changed }, sources));
});
test("regional briefs retain actual map provenance without changing a practice plan or adding S science", () => {
  const before = JSON.stringify(original);
  const brief = briefText(destinations[0], response(original), null, sources, null, regional);
  for (const expected of ["REGIONAL CONTEXT - NASA MARS TREK", regional.source.productId,
    regional.imageSha256, regional.scope, "planetocentric", ...regional.tiles.map(tile => tile.sha256)]) assert.ok(brief.includes(expected), expected);
  assert.ok(!brief.includes("SCIENCE CONTEXT - IMAGE-SUPPORTED"));
  assert.equal(JSON.stringify(original), before);
  assert.ok(regionalBriefLines(regional).some(line => line.includes("not a walking route")));
});
test("request fingerprint includes point, travel assumptions and all mission inputs", () => {
  const key = requestKey(original);
  assert.notEqual(key, requestKey({ ...original, mission: { ...original.mission, scienceMinutes: 21 } }));
  assert.notEqual(key, requestKey({ ...original, parameters: { ...original.parameters, maximumSlopeDegrees: 25 } }));
  assert.notEqual(key, requestKey({ ...original, destination: { row: 1, column: 2 } }));
});
test("request fingerprint does not depend on object insertion order", () => {
  const input = {
    mission: { reserveMinutes: 20, scienceMinutes: 20, missionBudgetMinutes: 120 },
    parameters: { downhillPenalty: 2, uphillPenalty: 4, maximumSlopeDegrees: 20, baseSpeedMPerMin: 30 },
    destination: { column: 37, row: 70 }, origin: { column: 43, row: 105 },
  };
  assert.equal(requestKey(input), requestKey(original));
});
test("comparison preserves reserve and reports the science-only consequences", () => {
  const result = comparePlans(original, revised);
  assert.equal(result.statusChanged, true);
  assert.equal(result.evaluable, true);
  assert.ok(Math.abs(result.requiredDeltaMinutes + result.marginDeltaMinutes) < 1e-10);
  assert.equal(original.mission.reserveMinutes, revised.mission.reserveMinutes);
});
test("comparison refuses to mix different destinations, budgets, or travel assumptions", () => {
  for (const changed of [
    { ...revised, destination: { row: 0, column: 0 } },
    { ...revised, mission: { ...revised.mission, missionBudgetMinutes: 130 } },
    { ...revised, parameters: { ...revised.parameters, maximumSlopeDegrees: 30 } },
  ]) assert.throws(() => comparePlans(original, changed));
});
test("comparison refuses a negative additional observation duration", () => {
  assert.throws(() => comparePlans(original, { ...original, mission: { ...original.mission, scienceMinutes: 19 } }));
});
test("unavailable time comparisons retain null deltas rather than fabricating zero", () => {
  const noRoute = audit.nominalResults[0];
  const result = comparePlans(noRoute, { ...noRoute, mission: { ...noRoute.mission, scienceMinutes: 25 } });
  assert.equal(result.evaluable, false);
  assert.equal(result.marginDeltaMinutes, null);
});
test("extra duration is explicit, finite and nonnegative; other mission inputs are unchanged", () => {
  const result = missionWithExtra(original.mission, 63);
  assert.equal(result.scienceMinutes, 83);
  assert.equal(result.reserveMinutes, 20);
  assert.equal(result.missionBudgetMinutes, 120);
  assert.throws(() => missionWithExtra(original.mission, -1));
  assert.throws(() => missionWithExtra(original.mission, Infinity));
});
test("all four engine statuses have distinct human-readable decisions and next actions", () => {
  const statuses = ["FEASIBLE", "TIME_BUDGET_EXCEEDED", "NO_MODELED_ROUTE", "INSUFFICIENT_DATA"];
  const titles = statuses.map(status => decisionTitle({ ...original, status }));
  assert.equal(new Set(titles).size, 4);
  assert.ok(titles.every(title => !/safe route/i.test(title)));
  assert.match(nextAction({ ...original, status: "NO_MODELED_ROUTE" }), /review the selected terrain/);
  assert.match(nextAction({ ...original, status: "INSUFFICIENT_DATA" }), /complete terrain inputs/);
});
test("time formatting preserves unavailable and negative values", () => {
  assert.equal(minutes(null), "Not evaluable");
  assert.equal(minutes(-1), "-1.00 min");
  assert.throws(() => minutes(NaN));
  assert.throws(() => minutes(Infinity));
});
test("brief states the hypothetical purpose, assumptions, reserve, source identity and scope", () => {
  const brief = briefText(destinations[0], response(original), null, sources);
  for (const expected of [APPLICATION_VERSION, CLAIM_BOUNDARY, "Guided practice", "Protected reserve: 20.00 min", "Latest planned return departure", "SHA-256", "qualitative thermal-derived context"]) {
    assert.ok(brief.includes(expected), expected);
  }
});
test("no-route brief contains unavailable return values and an explicit no-route decision", () => {
  const brief = briefText(destinations.find(item => item.id === "A"), response(audit.nominalResults[0]), null, sources);
  assert.ok(brief.includes("Return: Not evaluable"));
  assert.ok(brief.includes("No route under the selected assumptions"));
  assert.ok(!brief.includes("Return: 0.00 min"));
});
test("comparison brief identifies the original and revised duration without mutating either", () => {
  const before = JSON.stringify([original, revised]);
  const brief = briefText(destinations[0], response(revised), original, sources);
  assert.match(brief, /Compared with original: \+/);
  assert.equal(JSON.stringify([original, revised]), before);
});
test("assumption summary is explicit rather than a hidden preset label", () => {
  const summary = assumptionSummary(original.parameters);
  for (const expected of ["30 m/min", "20-degree", "uphill 4", "downhill 2"]) assert.ok(summary.includes(expected));
});

test("destination labels explicitly include P/A/B/C in the same map codes", () => {
  assert.deepEqual(destinations.map(destinationCode), ["P", "S", "A", "B", "C"]);
  for (const destination of destinations) assert.equal(destinationLabel(destination), `Location ${destination.id}: ${destination.name}`);
});
test("custom selector identifier maps to X, not the internal word custom", () => {
  assert.equal(destinationLabel({ id: "custom", kind: "custom", name: "Custom inspection point" }), "Location X: Custom inspection point");
  assert.equal(destinationCode({ id: "X", kind: "custom" }), "X");
});
test("map key shares the same names and codes and explicitly explains H and X", () => {
  const key = markerKey(destinations);
  assert.deepEqual(key.map(entry => entry.code), ["H", "P", "S", "A", "B", "C", "X"]);
  assert.match(key[0].note, /Fixed starting and return point/);
  assert.match(key.at(-1).note, /only when a custom point is selected/);
  for (const destination of destinations) assert.equal(key.find(entry => entry.code === destination.id).name, destination.name);
});
test("invalid or origin-reserved destination codes are explicit errors", () => {
  assert.throws(() => destinationCode({ id: "H", kind: "original_case" }));
  assert.throws(() => destinationCode({ id: "custom", kind: "original_case" }));
  assert.throws(() => destinationCode({ id: "B", kind: "custom" }));
});
test("duplicate marker codes cannot create an ambiguous map key", () => {
  assert.throws(() => markerKey([...destinations, destinations[0]]));
});
test("human text brief explains both origin H and selected destination code", () => {
  const brief = briefText(destinations[0], response(original), null, sources);
  assert.match(brief, /Origin \/ return marker: H/);
  assert.ok(brief.includes(`Destination: Location P: ${destinations[0].name}`));
});
