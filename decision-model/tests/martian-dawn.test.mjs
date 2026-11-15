import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = file => readFileSync(new URL(file, import.meta.url), "utf8");
const css = read("../public/styles.css");
const html = read("../public/index.html");
const svg = read("../public/mars-illustration.svg");
const stage = read("../scripts/stage.mjs");

test("Martian Dawn replaces teal branding with orange, ice blue and sand tokens", () => {
  for (const token of ["--action: #b94f2e", "--action-hover: #9f3f25", "--selected: #fbeadf", "--ice: #b7d7ff", "--link: #4059b8"]) assert.ok(css.includes(token));
  assert.doesNotMatch(css, /#(?:006e6a|005b58|00716a|006763|006f72|71c6bb)\b/i);
});
test("primary actions, selected destinations and map controls share the action token", () => {
  for (const selector of ["\\.primary", "\\.destination:has\\(input:checked\\)", "\\.map-view-options button\\[aria-pressed=\"true\"\\]"]) {
    assert.match(css, new RegExp(`${selector} \\{[^}]*var\\(--action\\)`));
  }
  assert.match(css, /\.destination input \{[^}]*accent-color: var\(--action\)/);
  assert.match(css, /\.stepper \[aria-current="step"\] \{[^}]*background: var\(--selected\)/);
  assert.match(css, /\.brand-orbit::after \{[^}]*var\(--ice\)/);
});
test("hero illustration has a dedicated noninteractive area with fixed aspect ratio", () => {
  assert.match(html, /<div class="hero-layout">/);
  assert.match(html, /<div class="mars-scene" aria-hidden="true">\s*<img src="\.\/mars-illustration\.svg" alt="" width="512" height="512">/);
  assert.match(css, /\.mars-scene \{[^}]*pointer-events: none/);
});
test("the three focus cards remain present below the hero illustration", () => {
  const story = html.match(/<div class="problem-story"[\s\S]*?<\/div>/)?.[0];
  assert.ok(story);
  assert.equal((story.match(/<article>/g) ?? []).length, 3);
  assert.ok(html.indexOf('class="mars-scene"') < html.indexOf('class="problem-story"'));
  assert.match(css, /\.problem-story \{[^}]*repeat\(3, minmax\(0, 1fr\)\)/);
});
test("mobile retains its own visible Mars area instead of hiding the illustration", () => {
  assert.match(css, /\.mars-scene \{[^}]*width: min\(100%, 430px\)/);
  assert.match(css, /\.mars-scene \{ grid-row: 1; width: 190px; \}/);
  assert.doesNotMatch(css, /\.mars-scene[^{]*\{[^}]*display: none/);
});
test("a separate decorative mini-Mars remains in the workspace heading", () => {
  assert.match(html, /<div class="workspace-identity"><img class="workspace-planet" src="\.\/mars-illustration\.svg" alt="" aria-hidden="true" width="88" height="88">/);
  assert.match(css, /\.workspace-planet \{ width: 64px; height: 64px; \}/);
});
test("the planet is a lightweight static local vector, not another scientific map", () => {
  assert.ok(Buffer.byteLength(svg, "utf8") <= 16384);
  assert.match(svg, /<title>Decorative illustration of Mars/);
  assert.match(svg, /viewBox="0 0 512 512"/);
  assert.match(svg, /<circle cx="256" cy="256" r="190"/);
  assert.ok((svg.match(/<circle /g) ?? []).length >= 30);
  assert.doesNotMatch(svg, /<(?:script|foreignObject|image|animate|animateTransform)\b/i);
  assert.doesNotMatch(svg, /\b(?:href|src)="(?!#)/i);
});
test("the decorative asset participates in the build fingerprint and both image URLs", () => {
  assert.match(stage, /"public\/mars-illustration\.svg"/);
  assert.match(stage, /\.replaceAll\('src="\.\/mars-illustration\.svg"'/);
  assert.equal((html.match(/src="\.\/mars-illustration\.svg"/g) ?? []).length, 2);
});
