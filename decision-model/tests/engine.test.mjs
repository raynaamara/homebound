import assert from "node:assert/strict";
import test from "node:test";
import {
  FIELD_CODES,
  MarswalkPlanner,
  ModelInputError,
  evaluateTimeBudget,
  parseTerrainGrid,
  parseTravelParameters,
  serializeOpportunityField,
} from "../dist/engine.js";

const parameters = { baseSpeedMPerMin: 30, maximumSlopeDegrees: 20, uphillPenalty: 4, downhillPenalty: 2 };
const mission = { missionBudgetMinutes: 120, scienceMinutes: 20, reserveMinutes: 20 };

function rawGrid(width, height, elevations = Array(width * height).fill(0), slopes = Array(width * height).fill(0)) {
  return {
    schema_version: "1.0", width, height, flattening: "row-major", horizontal_units: "metres",
    row_order: "north to south; row zero at top", working_radius_m: 3396036.8126024,
    working_crs_wkt: "Synthetic Mars fixture, not an observed study area",
    model_affine_pixel_corner: { a: 10, b: 0, c: 100, d: 0, e: -10, f: 200 },
    elevation_m_mean: elevations, slope_max_deg: slopes, valid_mask: elevations.map(value => value === null ? 0 : 1),
  };
}

function planner(raw, origin = { row: 0, column: 0 }, overrides = {}, blocked = []) {
  return new MarswalkPlanner(parseTerrainGrid(raw), origin, { ...parameters, ...overrides }, blocked);
}

function near(actual, expected, tolerance = 1e-10) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
}

test("grid parser copies numeric samples and retains valid negative and zero elevations", () => {
  const raw = rawGrid(2, 1, [-2500, 0]);
  const parsed = parseTerrainGrid(raw);
  raw.elevation_m_mean[0] = 900;
  assert.equal(parsed.elevationM[0], -2500);
  assert.equal(parsed.elevationM[1], 0);
});

test("unknown cells require null samples and retain an unknown mask", () => {
  const parsed = parseTerrainGrid(rawGrid(2, 1, [0, null], [0, null]));
  assert.equal(parsed.known[1], 0);
  assert.ok(Number.isNaN(parsed.elevationM[1]));
  const invalid = rawGrid(2, 1, [0, null], [0, 0]);
  assert.throws(() => parseTerrainGrid(invalid), ModelInputError);
});

test("grid rejects length mismatch and invalid validity codes", () => {
  const raw = rawGrid(2, 2);
  raw.elevation_m_mean.pop();
  assert.throws(() => parseTerrainGrid(raw), ModelInputError);
  const second = rawGrid(1, 1);
  second.valid_mask[0] = 2;
  assert.throws(() => parseTerrainGrid(second), ModelInputError);
});

test("grid rejects unsupported units, row order, Earth radius, rotation, and cell count", () => {
  for (const change of [
    { horizontal_units: "degrees" }, { row_order: "south-up" }, { working_radius_m: 6378137 },
    { width: 2000, height: 2000 }, { width: 1.5 },
  ]) {
    assert.throws(() => parseTerrainGrid({ ...rawGrid(1, 1), ...change }), ModelInputError);
  }
  const rotated = rawGrid(1, 1);
  rotated.model_affine_pixel_corner.b = 1;
  assert.throws(() => parseTerrainGrid(rotated), ModelInputError);
});

test("grid rejects nonfinite elevations and out-of-range slopes", () => {
  assert.throws(() => parseTerrainGrid(rawGrid(1, 1, [Infinity])), ModelInputError);
  assert.throws(() => parseTerrainGrid(rawGrid(1, 1, [0], [91])), ModelInputError);
  assert.throws(() => parseTerrainGrid(rawGrid(1, 1, [0], [-1])), ModelInputError);
});

test("travel parameters reject zero speed, invalid slope, and negative penalties", () => {
  for (const change of [
    { baseSpeedMPerMin: 0 }, { baseSpeedMPerMin: NaN }, { maximumSlopeDegrees: 90 },
    { maximumSlopeDegrees: -1 }, { uphillPenalty: -1 }, { downhillPenalty: Infinity },
  ]) assert.throws(() => parseTravelParameters({ ...parameters, ...change }), ModelInputError);
});

test("reference arithmetic preserves reserve and science time", () => {
  const result = evaluateTimeBudget({ ...mission, outboundMinutes: 25, returnMinutes: 35 });
  assert.equal(result.requiredMinutes, 100);
  assert.equal(result.marginMinutes, 20);
  assert.equal(result.maxScienceMinutes, 40);
  assert.equal(result.latestReturnDepartureMinute, 65);
  const extra = evaluateTimeBudget({ ...mission, scienceMinutes: 45, outboundMinutes: 25, returnMinutes: 35 });
  assert.equal(extra.requiredMinutes, 125);
  assert.equal(extra.marginMinutes, -5);
  assert.equal(extra.meetsModelBudget, false);
});

test("exact boundary retains reserve and one minute less is infeasible", () => {
  const exact = evaluateTimeBudget({ ...mission, missionBudgetMinutes: 100, outboundMinutes: 25, returnMinutes: 35 });
  assert.equal(exact.marginMinutes, 0);
  assert.equal(exact.meetsModelBudget, true);
  assert.equal(exact.zeroExtraMargin, true);
  const less = evaluateTimeBudget({ ...mission, missionBudgetMinutes: 99, outboundMinutes: 25, returnMinutes: 35 });
  assert.equal(less.meetsModelBudget, false);
});

test("floating-point boundary uses only a documented numerical tolerance", () => {
  const decision = evaluateTimeBudget({
    missionBudgetMinutes: 0.3, outboundMinutes: 0.1, returnMinutes: 0.2, scienceMinutes: 0, reserveMinutes: 0,
  });
  assert.equal(decision.marginMinutes, 0);
  assert.equal(decision.meetsModelBudget, true);
  assert.ok(decision.rawMarginMinutes < 0);
});

test("negative, missing, nonfinite, and overflowing time inputs are explicit errors", () => {
  assert.throws(() => evaluateTimeBudget({ ...mission, outboundMinutes: -1, returnMinutes: 1 }), ModelInputError);
  assert.throws(() => evaluateTimeBudget({ ...mission, outboundMinutes: NaN, returnMinutes: 1 }), ModelInputError);
  assert.throws(() => evaluateTimeBudget({ ...mission, outboundMinutes: 1 }), ModelInputError);
  assert.throws(() => evaluateTimeBudget({ ...mission, outboundMinutes: 1e308, returnMinutes: 1e308 }), ModelInputError);
});

test("reserve larger than budget produces an infeasible decision, not a silent cap", () => {
  const result = evaluateTimeBudget({ ...mission, missionBudgetMinutes: 10, reserveMinutes: 20, outboundMinutes: 0, returnMinutes: 0 });
  assert.equal(result.marginMinutes, -30);
  assert.equal(result.maxScienceMinutes, -10);
});

test("flat cardinal and diagonal edge times use metric cell dimensions", () => {
  const model = planner(rawGrid(2, 2));
  near(model.edgeMinutes(0, 1), 10 / 30);
  near(model.edgeMinutes(0, 3), Math.sqrt(200) / 30);
  assert.deepEqual(model.center({ row: 0, column: 0 }), { eastingM: 105, northingM: 195 });
});

test("directional uphill/downhill edge cost matches hand calculation", () => {
  const model = planner(rawGrid(2, 1, [0, 2]));
  const distance = Math.sqrt(104);
  near(model.edgeMinutes(0, 1), distance / 30 * 1.8);
  near(model.edgeMinutes(1, 0), distance / 30 * 1.4);
});

test("reverse Dijkstra preserves the original return-direction cost", () => {
  const model = planner(rawGrid(3, 1, [0, 1, 3]));
  const result = model.plan({ row: 0, column: 2 }, mission);
  const uphill = Math.sqrt(101) / 30 * 1.4 + Math.sqrt(104) / 30 * 1.8;
  const downhill = Math.sqrt(104) / 30 * 1.4 + Math.sqrt(101) / 30 * 1.2;
  near(result.time.outboundMinutes, uphill);
  near(result.time.returnMinutes, downhill);
  assert.deepEqual(result.outbound.cells, [0, 1, 2]);
  assert.deepEqual(result.return.cells, [2, 1, 0]);
});

test("Dijkstra finds the expected flat 3x3 diagonal route", () => {
  const result = planner(rawGrid(3, 3)).plan({ row: 2, column: 2 }, mission);
  near(result.outbound.distanceM, 2 * Math.sqrt(200));
  near(result.time.outboundMinutes, 2 * Math.sqrt(200) / 30);
  assert.equal(result.status, "FEASIBLE");
});

test("non-neighbor indices cannot wrap across rows", () => {
  assert.equal(planner(rawGrid(3, 2)).edgeMinutes(2, 3), null);
});

test("diagonal cannot cut between excluded orthogonal neighbors", () => {
  const model = planner(rawGrid(2, 2, [0, 0, 0, 0], [0, 40, 40, 0]));
  assert.equal(model.edgeMinutes(0, 3), null);
  assert.equal(model.plan({ row: 1, column: 1 }, mission).status, "NO_MODELED_ROUTE");
});

test("diagonal requires both orthogonal corridors to meet edge-grade limits", () => {
  const model = planner(rawGrid(2, 2, [0, 20, 20, 0]));
  assert.equal(model.edgeMinutes(0, 3), null);
});

test("edge-grade rule blocks a steep jump even if cell slope metadata are low", () => {
  const model = planner(rawGrid(2, 1, [0, 20]));
  assert.equal(model.edgeMinutes(0, 1), null);
  assert.equal(model.plan({ row: 0, column: 1 }, mission).status, "NO_MODELED_ROUTE");
});

test("unknown endpoint yields insufficient data and no fabricated route or time", () => {
  const result = planner(rawGrid(2, 1, [0, null], [0, null])).plan({ row: 0, column: 1 }, mission);
  assert.equal(result.status, "INSUFFICIENT_DATA");
  assert.equal(result.time, null);
  assert.equal(result.outbound, null);
  assert.ok(!JSON.stringify(result).includes("Infinity"));
});

test("unknown origin propagates unknown opportunity field", () => {
  const model = planner(rawGrid(2, 1, [null, 0], [null, 0]));
  assert.equal(model.plan({ row: 0, column: 1 }, mission).status, "INSUFFICIENT_DATA");
  assert.deepEqual(Array.from(model.scienceOpportunity(mission).codes), [FIELD_CODES.UNKNOWN, FIELD_CODES.UNKNOWN]);
});

test("excluded origin is reported without relocating it", () => {
  const result = planner(rawGrid(2, 1, [0, 0], [30, 0])).plan({ row: 0, column: 1 }, mission);
  assert.equal(result.reasonCode, "ENDPOINT_EXCLUDED");
  assert.deepEqual(result.origin, { row: 0, column: 0 });
});

test("explicit blocked cells break a route without silently changing thresholds", () => {
  const model = planner(rawGrid(3, 1), { row: 0, column: 0 }, {}, [{ row: 0, column: 1 }]);
  assert.equal(model.plan({ row: 0, column: 2 }, mission).status, "NO_MODELED_ROUTE");
  assert.equal(model.parameters.maximumSlopeDegrees, 20);
});

test("routing through unknown cells is not permitted", () => {
  const model = planner(rawGrid(3, 1, [0, null, 0], [0, null, 0]));
  assert.equal(model.plan({ row: 0, column: 2 }, mission).reasonCode, "NO_KNOWN_PERMITTED_ROUNDTRIP");
});

test("stationary origin plan retains science and reserve, with zero route time", () => {
  const model = planner(rawGrid(1, 1));
  const result = model.plan({ row: 0, column: 0 }, mission);
  assert.deepEqual(result.outbound.cells, [0]);
  assert.equal(result.time.requiredMinutes, 40);
  assert.equal(result.time.marginMinutes, 80);
});

test("invalid coordinates and blocked-cell declarations are explicit errors", () => {
  const model = planner(rawGrid(2, 2));
  assert.throws(() => model.plan({ row: -1, column: 0 }, mission), ModelInputError);
  assert.throws(() => model.plan({ row: 0.5, column: 0 }, mission), ModelInputError);
  assert.throws(() => model.edgeMinutes(0, 99), ModelInputError);
  assert.throws(() => planner(rawGrid(2, 2), { row: 0, column: 0 }, {}, [{ row: 99, column: 0 }]), ModelInputError);
});

test("unrepresentable edge time is an explicit numerical error", () => {
  assert.throws(() => planner(rawGrid(2, 1), { row: 0, column: 0 }, { baseSpeedMPerMin: 1e-320 }), error => error.code === "NUMERIC_RANGE");
});

test("route re-summing matches returned time and preserves path direction", () => {
  const model = planner(rawGrid(4, 3, [0, 1, 2, 3, 0, 2, 2, 4, 1, 2, 3, 4]));
  const result = model.plan({ row: 2, column: 3 }, mission);
  for (const route of [result.outbound, result.return]) {
    let total = 0;
    for (let i = 1; i < route.cells.length; i++) {
      const step = model.edgeMinutes(route.cells[i - 1], route.cells[i]);
      assert.notEqual(step, null);
      total += step;
    }
    near(total, route.minutes);
  }
});

test("opportunity field matches selected plan arithmetic", () => {
  const model = planner(rawGrid(3, 3));
  const field = model.scienceOpportunity(mission);
  const result = model.plan({ row: 2, column: 2 }, mission);
  near(field.marginMinutes[8], result.time.marginMinutes);
  assert.equal(field.codes[8], FIELD_CODES.FEASIBLE);
});

test("negative margins, exact margin, excluded and unknown field codes are distinct", () => {
  const raw = rawGrid(4, 1, [0, 0, 0, null], [0, 0, 50, null]);
  const model = planner(raw);
  const low = model.scienceOpportunity({ ...mission, missionBudgetMinutes: 0 });
  assert.equal(low.codes[0], FIELD_CODES.TIME_EXCEEDED);
  assert.equal(low.codes[2], FIELD_CODES.EXCLUDED);
  assert.equal(low.codes[3], FIELD_CODES.UNKNOWN);
  assert.equal(model.scienceOpportunity({ missionBudgetMinutes: 0, reserveMinutes: 0, scienceMinutes: 0 }).codes[0], FIELD_CODES.ZERO_EXTRA_MARGIN);
});

test("serialized opportunity fields retain unknowns as null, never nonfinite JSON", () => {
  const model = planner(rawGrid(2, 1, [0, null], [0, null]));
  const serialized = serializeOpportunityField(model.scienceOpportunity(mission));
  assert.deepEqual(serialized.marginMinutes, [80, null]);
  assert.ok(!JSON.stringify(serialized).includes("NaN"));
});

test("increasing science time or reserve never expands the feasible field", () => {
  const model = planner(rawGrid(6, 6), { row: 0, column: 0 }, { baseSpeedMPerMin: 1 });
  const original = model.scienceOpportunity({ missionBudgetMinutes: 100, scienceMinutes: 0, reserveMinutes: 0 });
  for (const change of [{ scienceMinutes: 30, reserveMinutes: 0 }, { scienceMinutes: 0, reserveMinutes: 30 }]) {
    const revised = model.scienceOpportunity({ missionBudgetMinutes: 100, ...change });
    for (let i = 0; i < original.codes.length; i++) {
      if (revised.codes[i] >= FIELD_CODES.FEASIBLE) assert.ok(original.codes[i] >= FIELD_CODES.FEASIBLE);
    }
  }
});

test("slower speed cannot improve a fixed plan's time margin", () => {
  const raw = rawGrid(4, 4);
  const fast = planner(raw).plan({ row: 3, column: 3 }, mission);
  const slow = planner(raw, { row: 0, column: 0 }, { baseSpeedMPerMin: 15 }).plan({ row: 3, column: 3 }, mission);
  near(slow.time.outboundMinutes, 2 * fast.time.outboundMinutes);
  assert.ok(slow.time.marginMinutes < fast.time.marginMinutes);
});

test("tightening a slope limit cannot create new modeled connectivity", () => {
  const raw = rawGrid(3, 1, [0, 0, 0], [0, 25, 0]);
  assert.equal(planner(raw, { row: 0, column: 0 }, { maximumSlopeDegrees: 30 }).plan({ row: 0, column: 2 }, mission).status, "FEASIBLE");
  assert.equal(planner(raw).plan({ row: 0, column: 2 }, mission).status, "NO_MODELED_ROUTE");
});

test("parameters are copied, frozen and reflected in an inspectable result", () => {
  const input = { ...parameters };
  const model = new MarswalkPlanner(parseTerrainGrid(rawGrid(2, 1)), { row: 0, column: 0 }, input);
  input.maximumSlopeDegrees = 89;
  const result = model.plan({ row: 0, column: 1 }, mission);
  assert.equal(result.parameters.maximumSlopeDegrees, 20);
  assert.equal(result.safetyCertified, false);
  assert.throws(() => { result.parameters.uphillPenalty = 0; }, TypeError);
});

test("deterministic ties return the same complete result", () => {
  const a = planner(rawGrid(5, 5)).plan({ row: 4, column: 3 }, mission);
  const b = planner(rawGrid(5, 5)).plan({ row: 4, column: 3 }, mission);
  assert.deepEqual(a, b);
});

test("directed shortest paths agree with an independent Floyd-Warshall oracle", () => {
  const elevations = [0, 1, 1.5, 0.2, 0.8, 2, 0.5, 1, 2.5];
  const size = elevations.length;
  const reference = Array.from({ length: size }, (_, from) => Array.from({ length: size }, (_, to) => {
    if (from === to) return 0;
    const dr = Math.floor(to / 3) - Math.floor(from / 3);
    const dc = to % 3 - from % 3;
    if (Math.abs(dr) > 1 || Math.abs(dc) > 1) return Infinity;
    const horizontal = 10 * Math.sqrt(dr * dr + dc * dc);
    const rise = elevations[to] - elevations[from];
    const grade = rise / horizontal;
    return Math.sqrt(horizontal * horizontal + rise * rise) / 30 *
      (1 + 4 * Math.max(grade, 0) + 2 * Math.max(-grade, 0));
  }));
  for (let k = 0; k < size; k++) {
    for (let i = 0; i < size; i++) {
      for (let j = 0; j < size; j++) reference[i][j] = Math.min(reference[i][j], reference[i][k] + reference[k][j]);
    }
  }
  for (let from = 0; from < size; from++) {
    const model = planner(rawGrid(3, 3, elevations), { row: Math.floor(from / 3), column: from % 3 });
    for (let to = 0; to < size; to++) {
      const result = model.plan({ row: Math.floor(to / 3), column: to % 3 }, mission);
      near(result.time.outboundMinutes, reference[from][to]);
      near(result.time.returnMinutes, reference[to][from]);
    }
  }
});
