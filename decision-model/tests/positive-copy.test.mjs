import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { briefText, decisionExplanation, destinationKindLabel, displayedPlan, destinationsFromConfig, parseSources } from "../dist/workflow.js";
import { parseScenario } from "../dist/protocol.js";
import { describeLayer, parseLayerMetadata } from "../dist/layer-display.js";

const read = url => JSON.parse(readFileSync(new URL(url, import.meta.url), "utf8"));
const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const config = read("../config/application.json");
const scenario = parseScenario(read("../../data/homebound/web/scenario.json"));
const destinations = destinationsFromConfig(scenario, config);
const sources = parseSources(read("../../data/homebound/web/sources.json"));
const audit = read("../evidence/model-audit.json");
const original = audit.connectedCellWitness.result;
const revised = audit.connectedCellWitness.extraTaskResult;
const banned = /\bAI assistance\b|\bnot an operational safety system\b|\bnot for operational use\b|\bno safety certification\b|\bnot a safety certification\b|\bno competition eligibility\b|\bNASA approval is asserted\b|\bNone certifies physical safety\b/i;

test("public interface removes requested boilerplate and keeps planning context", () => {
  assert.ok(!banned.test(html));
  assert.ok(html.includes("Marswalk planning simulation"));
  assert.ok(html.includes("Data, assumptions, and methods"));
});
test("public scenario and preset copy use positive method descriptions", () => {
  assert.ok(!banned.test(JSON.stringify(config)));
  assert.ok(!banned.test(JSON.stringify(read("../config/illustrative-preset.json"))));
  assert.match(destinations[0].evidence, /guided round-trip/);
});
test("human scenario labels retain their distinct meanings", () => {
  assert.equal(destinationKindLabel(destinations[0]), "Guided practice");
  assert.equal(destinationKindLabel(destinations.find(item => item.id === "A")), "Observation example");
  assert.equal(destinationKindLabel(destinations.find(item => item.id === "S")), "Science observation candidate");
  assert.equal(destinationKindLabel({ kind: "custom" }), "Custom location");
});
test("display adapter changes prose without changing model data or raw provenance", () => {
  const raw = JSON.stringify(original);
  const shown = displayedPlan(original);
  assert.ok(!banned.test(shown.explanation));
  assert.notEqual(shown.explanation, original.explanation);
  for (const key of ["status", "reasonCode", "time", "outbound", "return", "parameters", "mission", "scope", "safetyCertified"]) {
    assert.deepEqual(shown[key], original[key], key);
  }
  assert.equal(JSON.stringify(original), raw);
});
test("mission briefs remove boilerplate and retain sources, units and plan comparisons", () => {
  const text = briefText(destinations[0], { plan: revised }, original, sources);
  assert.ok(!banned.test(text));
  for (const expected of ["DATA AND METHODS", "Protected reserve", "SHA-256", "qualitative thermal-derived context", "Compared with original"]) assert.ok(text.includes(expected));
});
test("actionable outcomes remain truthful for over-budget and unavailable routes", () => {
  assert.match(decisionExplanation(revised), /needs .* more than/);
  assert.match(decisionExplanation(audit.nominalResults[0]), /exclude a complete round trip/);
  assert.match(decisionExplanation({ ...audit.nominalResults[0], status: "INSUFFICIENT_DATA" }), /additional terrain data/);
  assert.equal(displayedPlan(audit.nominalResults[0]).time, null);
});
test("layer copy retains qualitative DN, terrain units and source resolution without boilerplate", () => {
  const metadata = parseLayerMetadata(read("../../data/homebound/web/manifest.json"));
  for (const layer of ["optical", "elevation", "slope", "thermal", "opportunity"]) {
    const text = JSON.stringify(describeLayer(layer, metadata, 379.38, { minimum: -2705, maximum: -2654 }, "current"));
    assert.ok(!banned.test(text), layer);
  }
  const thermal = describeLayer("thermal", metadata, 379.38, null, "current");
  assert.equal(thermal.scale.units, "DN");
  assert.match(thermal.detail, /100 m/);
  assert.match(thermal.detail, /qualitative thermal context/);
});
