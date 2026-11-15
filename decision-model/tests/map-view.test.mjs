import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { MissionMap } from "../dist/map-view.js";
import { parseLayerMetadata } from "../dist/layer-display.js";

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");
const metadata = parseLayerMetadata(JSON.parse(readFileSync(new URL("../../data/homebound/web/manifest.json", import.meta.url), "utf8")));

function mapFixture() {
  const canvas = {
    getContext: () => ({}),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 300, height: 300 }),
  };
  return new MissionMap(canvas, 300, 300, 5.058400441812499, metadata);
}
const points = [{ row: 105, column: 43 }, { row: 70, column: 37 }];

test("initial viewport mode describes the complete grid", () => {
  const map = mapFixture();
  assert.equal(map.viewMode, "area");
  assert.deepEqual(map.pick(0, 0), { row: 0, column: 0 });
  assert.deepEqual(map.pick(299, 299), { row: 299, column: 299 });
});
test("automatic point fitting selects focus without altering existing viewport geometry", () => {
  const map = mapFixture();
  map.fit(points);
  assert.equal(map.viewMode, "focus");
  assert.deepEqual(map.pick(0, 0), { row: 50, column: 2 });
  assert.deepEqual(map.pick(150, 150), { row: 87, column: 40 });
});
test("whole-area selection restores the full grid after focus", () => {
  const map = mapFixture();
  map.fit(points);
  map.fitArea();
  assert.equal(map.viewMode, "area");
  assert.deepEqual(map.pick(150, 150), { row: 150, column: 150 });
});
test("refocusing follows new points after whole-area selection", () => {
  const map = mapFixture();
  map.fit(points);
  map.fitArea();
  map.fit([{ row: 180, column: 180 }, { row: 250, column: 260 }]);
  assert.equal(map.viewMode, "focus");
  assert.deepEqual(map.pick(150, 150), { row: 215, column: 220 });
});
test("failed focus operations leave both mode and viewport unchanged", () => {
  const map = mapFixture();
  for (const mode of ["area", "focus"]) {
    if (mode === "focus") map.fit(points);
    const before = map.pick(150, 150);
    assert.throws(() => map.fit([]), /At least one point/);
    assert.equal(map.viewMode, mode);
    assert.deepEqual(map.pick(150, 150), before);
  }
});
test("a full-size focus retains the requested destination-fit mode", () => {
  const map = mapFixture();
  map.fit([{ row: 0, column: 0 }, { row: 299, column: 299 }]);
  assert.equal(map.viewMode, "focus");
  assert.deepEqual(map.pick(150, 150), { row: 150, column: 150 });
});
test("viewport mode cannot be changed independently of viewport operations", () => {
  const map = mapFixture();
  assert.throws(() => { map.viewMode = "focus"; }, TypeError);
  assert.equal(map.viewMode, "area");
});
test("map-view controls are named native toggle buttons grouped below Layer", () => {
  const group = html.match(/<fieldset class="map-view-control">([\s\S]*?)<\/fieldset>/)?.[1];
  assert.ok(group);
  assert.match(group, /<legend>Map view<\/legend>/);
  assert.match(group, /id="focus-map" type="button" aria-pressed="true">Destination \/ route<\/button>/);
  assert.match(group, /id="fit-map" type="button" aria-pressed="false">Whole area<\/button>/);
  assert.equal((group.match(/<button /g) ?? []).length, 2);
  assert.ok(html.indexOf('id="map-layer"') < html.indexOf('<fieldset class="map-view-control">'));
  assert.ok(!html.includes("Fit whole area"));
});
test("segmented styling uses equal columns, visible active state and 44px targets", () => {
  assert.match(css, /\.map-tools \{ display: grid;/);
  assert.match(css, /\.map-view-options \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.map-view-options button \{[^}]*min-height: 44px/);
  assert.match(css, /\.map-view-options button\[aria-pressed="true"\] \{[^}]*background: var\(--action\)/);
});
