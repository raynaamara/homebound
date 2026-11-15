import assert from "node:assert/strict";
import test from "node:test";
import { parseScenario } from "../dist/protocol.js";

function fixture() {
  return {
    grid_width: 2, grid_height: 2, mission_time_budget_minutes: 120, reserve_minutes: 20,
    points: [
      { id: "H", name: "Hypothetical origin", row: 0, column: 0, science_minutes: 0 },
      { id: "A", name: "Illustrative target", row: 1, column: 1, science_minutes: 20 },
    ],
  };
}

test("scenario parser maps original source names without changing locations", () => {
  const result = parseScenario(fixture());
  assert.equal(result.targets[0].scienceMinutes, 20);
  assert.deepEqual(result.origin, { id: "H", name: "Hypothetical origin", row: 0, column: 0, scienceMinutes: 0 });
});

test("scenario rejects duplicate identifiers and missing origin", () => {
  const duplicate = fixture();
  duplicate.points[1].id = "H";
  assert.throws(() => parseScenario(duplicate));
  const missing = fixture();
  missing.points[0].id = "B";
  assert.throws(() => parseScenario(missing));
});

test("scenario rejects non-integer dimensions and out-of-grid points", () => {
  assert.throws(() => parseScenario({ ...fixture(), grid_width: 1.5 }));
  const invalid = fixture();
  invalid.points[1].row = 2;
  assert.throws(() => parseScenario(invalid));
});

test("scenario rejects invalid times and a reserved custom identifier", () => {
  assert.throws(() => parseScenario({ ...fixture(), reserve_minutes: -1 }));
  const invalid = fixture();
  invalid.points[1].id = "custom";
  assert.throws(() => parseScenario(invalid));
});
