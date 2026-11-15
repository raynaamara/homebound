import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = file => readFileSync(new URL(file, import.meta.url), "utf8");
const html = read("../public/index.html");
const css = read("../public/styles.css");
const focus = html.match(/<section class="homebound-focus"[\s\S]*?<\/section>/)?.[0];

test("Why HOMEBOUND explains the three implemented workflow capabilities below the hero", () => {
  assert.ok(focus);
  assert.match(focus, /aria-labelledby="why-homebound-title"/);
  assert.match(focus, /<h2 id="why-homebound-title">Why HOMEBOUND\?<\/h2>/);
  assert.match(focus, /Turn a Mars map into a return-aware observation plan/);
  assert.equal((focus.match(/<article>/g) ?? []).length, 3);
  for (const title of ["Complete-trip planning", "Explainable what-if", "Science-to-brief workflow"]) {
    assert.ok(focus.includes(`<h3>${title}</h3>`));
  }
  assert.match(focus, /outbound travel, observation, the journey home and a protected reserve/);
  assert.match(focus, /Outbound and return travel are calculated separately/);
  assert.match(focus, /Compare the original plan with extra observation time/);
  assert.match(focus, /At science location S, connect an image-supported question/);
  assert.ok(html.indexOf('class="mars-scene"') < html.indexOf('class="homebound-focus"'));
  const version = JSON.parse(read("../config/application.json")).applicationVersion;
  assert.equal(JSON.parse(read("../package.json")).version, version);
  assert.ok(read("../src/workflow.ts").includes(`export const APPLICATION_VERSION = "${version}";`));
  assert.ok(html.includes(`Application ${version} &middot; Model 1.0.0`));
});

test("related tools use a closed native disclosure and acknowledge existing planning capabilities", () => {
  assert.ok(focus);
  assert.match(focus, /<details id="related-tools" class="related-tools">\s*<summary>Related tools and our focus<\/summary>/);
  for (const [url, label] of [
    ["https://trek.nasa.gov/mars/jpl/config/textAbout.html", "NASA/JPL Mars Trek"],
    ["https://jmars.mars.asu.edu/getting-started", "ASU JMARS"],
  ]) {
    assert.ok(focus.includes(`href="${url}" target="_blank" rel="noopener noreferrer" aria-label="${label} (opens in a new tab)"`));
  }
  assert.match(focus, /terrain analysis and mission planning/);
  assert.match(focus, /planetary-data analysis and observation-planning workflows/);
  assert.match(focus, /HOMEBOUND complements these broader tools/);
  assert.doesNotMatch(focus, /first-ever|world.first|only (?:tool|application)|better than|NASA.approved/i);
});

test("focus cards and disclosure retain readable dark styling and native keyboard targets", () => {
  assert.match(css, /\.intro > div, \.intro > section \{[^}]*position: relative;[^}]*z-index: 1/);
  assert.match(css, /\.problem-story h3 \{[^}]*font-size: 1rem/);
  assert.match(css, /\.related-tools > summary \{[^}]*min-height: 44px/);
  assert.match(css, /\.intro summary:focus-visible \{ outline-color: var\(--focus-dark\)/);
  assert.match(css, /\.related-tools a \{ color: var\(--ice\)/);
  assert.match(css, /@media \(max-width: 900px\) \{[^}]*\}[\s\S]*?\.problem-story \{ grid-template-columns: 1fr; \}/);
});

test("positioning is informational, separate from mission controls and omitted from printed briefs", () => {
  assert.ok(focus);
  assert.doesNotMatch(focus, /<(?:button|input|select|script|iframe)\b/);
  assert.ok(html.indexOf(focus) < html.indexOf('id="workspace"'));
  const print = css.slice(css.indexOf("@media print"));
  assert.match(print, /\.site-header, \.intro[^}]*display: none !important/);
});
