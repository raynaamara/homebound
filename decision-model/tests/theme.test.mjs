import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");
const palette = Object.fromEntries([...css.matchAll(/--([\w-]+):\s*(#[\da-f]{6})\s*;/gi)].map(match => [match[1], match[2]]));

function luminance(hex) {
  const values = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
}
function contrast(foreground, background) {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => a - b);
  return (values[1] + 0.05) / (values[0] + 0.05);
}

test("theme defines the agreed deep-space, light-workspace and Mars palette", () => {
  for (const [name, value] of Object.entries({ space: "#0b1120", workspace: "#f3f6fb", surface: "#ffffff", ink: "#17324d", mars: "#b94f2e" })) {
    assert.equal(palette[name], value);
  }
  assert.match(css, /\.workspace \{[^}]*background: var\(--workspace\)/);
  assert.match(css, /\.card \{[^}]*background: var\(--surface\)/);
});
test("primary button text retains at least 4.5 to 1 contrast", () => {
  assert.match(css, /\.primary \{[^}]*background: var\(--action\)/);
  assert.ok(contrast("#ffffff", palette.action) >= 4.5);
  assert.ok(contrast("#ffffff", palette["action-hover"]) >= 4.5);
});
test("dark-surface heading, secondary and accent text exceed 4.5 to 1", () => {
  for (const background of [palette.space, palette["space-panel"], "#142a43"]) {
    for (const foreground of [palette["space-text"], palette["space-muted"], palette["mars-light"], palette.ice]) {
      assert.ok(contrast(foreground, background) >= 4.5, `${foreground} on ${background}`);
    }
  }
});
test("light-surface primary and helper text exceed 4.5 to 1", () => {
  for (const background of [palette.workspace, palette.surface]) {
    for (const foreground of [palette.ink, palette.muted]) {
      assert.ok(contrast(foreground, background) >= 4.5);
    }
  }
});
test("control boundaries and context-specific focus rings exceed 3 to 1", () => {
  for (const background of [palette.workspace, palette.surface]) {
    assert.ok(contrast(palette["control-border"], background) >= 3);
    assert.ok(contrast("#9a570c", background) >= 3);
  }
  assert.ok(contrast(palette["focus-dark"], palette.space) >= 3);
  assert.match(css, /\.site-header a:focus-visible[^}]*outline-color: var\(--focus-dark\)/);
});
test("scientific map and status palettes remain distinct and unfiltered", () => {
  for (const value of ["#1c9e6f", "#ebb536", "#cc4337", "#182836", "#698194", "#a6aaaf", "#14658a", "#8b4e11"]) assert.ok(css.includes(value));
  assert.match(css, /data-status="FEASIBLE"\] \{ color: #125c40; background: #e2f1e7/);
  assert.match(css, /data-status="TIME_BUDGET_EXCEEDED"\] \{ color: #8d291b; background: #f9e9e3/);
  assert.doesNotMatch(css, /\b(?:backdrop-)?filter\s*:/);
});
test("space decoration is static, noninteractive and requires no external assets", () => {
  assert.match(css, /\.intro::before \{[^}]*pointer-events: none/);
  assert.match(css, /\.mars-scene \{[^}]*pointer-events: none/);
  assert.doesNotMatch(css, /@keyframes|@import|url\(/i);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /\.mars-scene \{ grid-row: 1; width: 190px; \}/);
});
test("print output resets the dark frame and workspace to white", () => {
  const print = css.slice(css.indexOf("@media print"));
  assert.match(print, /body \{ background: #fff; color: #111/);
  assert.match(print, /\.workspace, \.card, #mission-brief \{[^}]*box-shadow: none;[^}]*background: #fff/);
  assert.match(print, /\.site-header, \.intro[^}]*display: none !important/);
});
