import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { MarswalkPlanner, evaluateTimeBudget, parseTerrainGrid, FIELD_CODES } from "../dist/engine.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const dataRoot = path.resolve(root, "..", "data", "homebound", "web");
const output = path.join(root, "evidence");
await mkdir(output, { recursive: true });
const gridBytes = await readFile(path.join(dataRoot, "terrain_grid.json"));
const scenarioBytes = await readFile(path.join(dataRoot, "scenario.json"));
const raw = JSON.parse(gridBytes);
const scenario = JSON.parse(scenarioBytes);
const preset = JSON.parse(await readFile(path.join(root, "config", "illustrative-preset.json")));
const grid = parseTerrainGrid(raw);
const origin = scenario.points.find(point => point.id === "H");
const targets = scenario.points.filter(point => point.id !== "H");
assert.ok(origin && targets.length === 3);
const nominal = {
  baseSpeedMPerMin: preset.baseSpeedMPerMin,
  maximumSlopeDegrees: preset.maximumSlopeDegrees,
  uphillPenalty: preset.uphillPenalty,
  downhillPenalty: preset.downhillPenalty,
};
const records = [];
const validations = [];

function verify(id, passed, details) {
  validations.push({ id, status: passed ? "PASS" : "FAIL", details });
  assert.ok(passed, `${id}: ${JSON.stringify(details)}`);
}

function mission(point, reserveMinutes = scenario.reserve_minutes) {
  return { missionBudgetMinutes: scenario.mission_time_budget_minutes, scienceMinutes: point.science_minutes, reserveMinutes };
}

const builds = new Map();
function getPlanner(parameters) {
  const key = JSON.stringify(parameters);
  if (!builds.has(key)) {
    const start = performance.now();
    const planner = new MarswalkPlanner(grid, origin, parameters);
    builds.set(key, { planner, milliseconds: performance.now() - start, parameters });
  }
  return builds.get(key);
}

function checkRoutes(planner, result, id) {
  if (result.time === null) {
    verify(`${id}-UNAVAILABLE-NULL`, result.outbound === null && result.return === null, result.status);
    return;
  }
  for (const [label, route] of [["outbound", result.outbound], ["return", result.return]]) {
    let sum = 0;
    for (let index = 1; index < route.cells.length; index++) {
      const edge = planner.edgeMinutes(route.cells[index - 1], route.cells[index]);
      assert.notEqual(edge, null, `Invalid ${label} edge in ${id}`);
      sum += edge;
    }
    verify(`${id}-${label}-RESUM`, Math.abs(sum - route.minutes) < 1e-7, { sum, reported: route.minutes, cells: route.cells.length });
  }
}

const nominalBuild = getPlanner(nominal);
const nominalResults = targets.map(point => {
  const result = nominalBuild.planner.plan(point, mission(point));
  checkRoutes(nominalBuild.planner, result, `NOMINAL-${point.id}`);
  return { targetId: point.id, ...result };
});

for (const maximumSlopeDegrees of preset.sensitivity.maximumSlopeDegrees) {
  const parameters = { ...nominal, maximumSlopeDegrees };
  const build = getPlanner(parameters);
  for (const point of targets) {
    const result = build.planner.plan(point, mission(point));
    checkRoutes(build.planner, result, `SLOPE-${maximumSlopeDegrees}-${point.id}`);
    records.push({
      experiment: "slope", targetId: point.id, ...parameters,
      reserveMinutes: scenario.reserve_minutes, scienceMinutes: point.science_minutes,
      status: result.status, reasonCode: result.reasonCode,
      outboundMinutes: result.time?.outboundMinutes ?? null,
      returnMinutes: result.time?.returnMinutes ?? null,
      requiredMinutes: result.time?.requiredMinutes ?? null,
      marginMinutes: result.time?.marginMinutes ?? null,
      maxScienceMinutes: result.time?.maxScienceMinutes ?? null,
      reachedCells: build.planner.statistics.outboundReached,
      buildMilliseconds: build.milliseconds,
    });
  }
}
for (const baseSpeedMPerMin of preset.sensitivity.baseSpeedMPerMin) {
  const parameters = { ...nominal, baseSpeedMPerMin };
  const build = getPlanner(parameters);
  for (const point of targets) {
    const result = build.planner.plan(point, mission(point));
    records.push({
      experiment: "speed", targetId: point.id, ...parameters, reserveMinutes: scenario.reserve_minutes,
      scienceMinutes: point.science_minutes, status: result.status, reasonCode: result.reasonCode,
      outboundMinutes: result.time?.outboundMinutes ?? null, returnMinutes: result.time?.returnMinutes ?? null,
      requiredMinutes: result.time?.requiredMinutes ?? null, marginMinutes: result.time?.marginMinutes ?? null,
      maxScienceMinutes: result.time?.maxScienceMinutes ?? null,
      reachedCells: build.planner.statistics.outboundReached, buildMilliseconds: build.milliseconds,
    });
  }
}
for (const reserveMinutes of preset.sensitivity.reserveMinutes) {
  for (const point of targets) {
    const result = nominalBuild.planner.plan(point, mission(point, reserveMinutes));
    records.push({
      experiment: "reserve", targetId: point.id, ...nominal, reserveMinutes, scienceMinutes: point.science_minutes,
      status: result.status, reasonCode: result.reasonCode,
      outboundMinutes: result.time?.outboundMinutes ?? null, returnMinutes: result.time?.returnMinutes ?? null,
      requiredMinutes: result.time?.requiredMinutes ?? null, marginMinutes: result.time?.marginMinutes ?? null,
      maxScienceMinutes: result.time?.maxScienceMinutes ?? null,
      reachedCells: nominalBuild.planner.statistics.outboundReached, buildMilliseconds: nominalBuild.milliseconds,
    });
  }
}

const fieldStart = performance.now();
const baselineField = nominalBuild.planner.scienceOpportunity(mission(targets[0]));
const fieldMilliseconds = performance.now() - fieldStart;
let witnessIndex = -1;
let witnessDistance = -1;
for (let index = 0; index < baselineField.codes.length; index++) {
  if (baselineField.codes[index] < FIELD_CODES.TIME_EXCEEDED) continue;
  const cell = nominalBuild.planner.cell(index);
  const distance = Math.hypot(cell.row - origin.row, cell.column - origin.column);
  if (distance > witnessDistance) {
    witnessIndex = index;
    witnessDistance = distance;
  }
}
assert.ok(witnessIndex >= 0);
const witnessCell = nominalBuild.planner.cell(witnessIndex);
const witnessResult = nominalBuild.planner.plan(witnessCell, mission(targets[0]));
checkRoutes(nominalBuild.planner, witnessResult, "CONNECTED-WITNESS");
const witnessExtra = nominalBuild.planner.plan(witnessCell, {
  ...mission(targets[0]),
  scienceMinutes: witnessResult.time.maxScienceMinutes + 1,
});
verify("CONNECTED-WITNESS-EXTRA-TASK", witnessExtra.status === "TIME_BUDGET_EXCEEDED", {
  baseline: witnessResult.status, extra: witnessExtra.status, extraMargin: witnessExtra.time.marginMinutes,
});
const witnessExact = nominalBuild.planner.plan(witnessCell, {
  ...mission(targets[0]), missionBudgetMinutes: witnessResult.time.requiredMinutes,
});
verify("CONNECTED-WITNESS-EXACT-BOUNDARY", witnessExact.status === "FEASIBLE" && witnessExact.time.marginMinutes === 0, witnessExact.time);
const witnessSpeedResults = preset.sensitivity.baseSpeedMPerMin.map(baseSpeedMPerMin => {
  const build = getPlanner({ ...nominal, baseSpeedMPerMin });
  return build.planner.plan(witnessCell, mission(targets[0]));
});
verify("CONNECTED-WITNESS-SPEED-MONOTONICITY", witnessSpeedResults.every((result, index) =>
  result.time !== null && (index === 0 || result.time.requiredMinutes <= witnessSpeedResults[index - 1].time.requiredMinutes)),
  witnessSpeedResults.map(result => ({ speed: result.parameters.baseSpeedMPerMin, requiredMinutes: result.time?.requiredMinutes })));
const revisedField = nominalBuild.planner.scienceOpportunity({ ...mission(targets[0]), scienceMinutes: targets[0].science_minutes + 25 });
let expanded = 0;
for (let index = 0; index < baselineField.codes.length; index++) {
  if (revisedField.codes[index] >= FIELD_CODES.FEASIBLE && baselineField.codes[index] < FIELD_CODES.FEASIBLE) expanded++;
}
verify("REAL-FIELD-SCIENCE-MONOTONICITY", expanded === 0, { newlyFeasibleAfterExtraScience: expanded });
const revisedReserve = nominalBuild.planner.scienceOpportunity({ ...mission(targets[0]), reserveMinutes: scenario.reserve_minutes + 10 });
expanded = 0;
for (let index = 0; index < baselineField.codes.length; index++) {
  if (revisedReserve.codes[index] >= FIELD_CODES.FEASIBLE && baselineField.codes[index] < FIELD_CODES.FEASIBLE) expanded++;
}
verify("REAL-FIELD-RESERVE-MONOTONICITY", expanded === 0, { newlyFeasibleAfterMoreReserve: expanded });
const slopeBuilds = preset.sensitivity.maximumSlopeDegrees.map(slope => getPlanner({ ...nominal, maximumSlopeDegrees: slope }));
verify("REAL-CONNECTIVITY-SLOPE-MONOTONICITY", slopeBuilds.every((build, index) => index === 0 || build.planner.statistics.outboundReached >= slopeBuilds[index - 1].planner.statistics.outboundReached), slopeBuilds.map(build => ({ slope: build.parameters.maximumSlopeDegrees, reached: build.planner.statistics.outboundReached })));
for (const result of nominalResults) {
  if (result.time !== null) {
    const exact = nominalBuild.planner.plan(result.destination, { ...result.mission, missionBudgetMinutes: result.time.requiredMinutes });
    const short = nominalBuild.planner.plan(result.destination, { ...result.mission, missionBudgetMinutes: result.time.requiredMinutes - 1 });
    verify(`REAL-${result.targetId}-BOUNDARY`, exact.status === "FEASIBLE" && short.status === "TIME_BUDGET_EXCEEDED", { exact: exact.status, oneMinuteShort: short.status });
  }
}
for (const point of targets) {
  const speedRecords = records.filter(record => record.experiment === "speed" && record.targetId === point.id);
  if (speedRecords.every(record => record.outboundMinutes !== null)) {
    verify(`REAL-${point.id}-SPEED-MONOTONICITY`, speedRecords.every((record, index) => index === 0 || record.requiredMinutes <= speedRecords[index - 1].requiredMinutes), speedRecords.map(record => ({ speed: record.baseSpeedMPerMin, required: record.requiredMinutes })));
  }
}
const analytical = [
  { label: "Analytical reference, not a Mars-route measurement", ...evaluateTimeBudget({ missionBudgetMinutes: 120, outboundMinutes: 25, returnMinutes: 35, scienceMinutes: 20, reserveMinutes: 20 }) },
  { label: "Analytical extra-task case, not a Mars-route measurement", ...evaluateTimeBudget({ missionBudgetMinutes: 120, outboundMinutes: 25, returnMinutes: 35, scienceMinutes: 45, reserveMinutes: 20 }) },
];
const countCodes = {};
for (const [label, code] of Object.entries(FIELD_CODES)) countCodes[label] = baselineField.codes.reduce((sum, value) => sum + (value === code ? 1 : 0), 0);
const evidence = {
  executedUtc: new Date().toISOString(),
  modelVersion: "1.0.0",
  status: "RESEARCH_PROTOTYPE_NOT_PHYSICALLY_VALIDATED",
  runtime: { node: process.version, platform: process.platform, architecture: process.arch },
  inputs: [
    { filename: "terrain_grid.json", sha256: createHash("sha256").update(gridBytes).digest("hex") },
    { filename: "scenario.json", sha256: createHash("sha256").update(scenarioBytes).digest("hex") },
  ],
  nominalParameters: nominal,
  nominalStatistics: nominalBuild.planner.statistics,
  nominalBuildMilliseconds: nominalBuild.milliseconds,
  fieldUpdateMilliseconds: fieldMilliseconds,
  nominalFieldCounts: countCodes,
  nominalResults,
  connectedCellWitness: {
    label: "Numerical integration witness, not a recommended science target",
    selection: "Farthest grid-distance cell in the nominal origin-connected component; neither origin nor A/B/C was relocated.",
    cell: witnessCell,
    result: witnessResult,
    extraTaskResult: witnessExtra,
  },
  sensitivity: records,
  analyticalReferences: analytical,
  validations,
  claimBoundaries: [
    "The user-approved preset is illustrative; no astronaut-speed or slope-safety calibration.",
    "No threshold is silently relaxed and no scenario endpoint is relocated.",
    "A model route is not a certified physical route; maximum native slope aggregation may be restrictive.",
    "No quantitative thermal, oxygen, battery, fatigue, or dynamic-environment model.",
    "Local runtime timings are observations, not a cross-device performance guarantee.",
  ],
};
await writeFile(path.join(output, "model-audit.json"), JSON.stringify(evidence, null, 2));
const fields = Object.keys(records[0]);
const csv = [fields.join(","), ...records.map(record => fields.map(key => JSON.stringify(record[key] ?? "")).join(","))].join("\n");
await writeFile(path.join(output, "sensitivity-results.csv"), csv);
console.log("Nominal parameters:", nominal);
console.log("Nominal statistics:", evidence.nominalStatistics);
console.log("Nominal target results:", nominalResults.map(result => ({ target: result.targetId, status: result.status, margin: result.time?.marginMinutes ?? null })));
console.log("Nominal build / field update milliseconds:", evidence.nominalBuildMilliseconds, evidence.fieldUpdateMilliseconds);
console.log("Executed sensitivity records:", records.length, "| validation checks:", validations.length);
console.log("Evidence:", path.join(output, "model-audit.json"));
