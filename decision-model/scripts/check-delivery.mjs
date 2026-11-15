import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const deploy = path.join(root, "deploy");
const expected = [
  "index.html", "styles.css", "mars-illustration.svg", ".htaccess", "HOMEBOUND_BUILD.txt",
  "js/app.js", "js/worker.js", "js/engine.js", "js/protocol.js",
  "js/workflow.js", "js/map-view.js", "js/layer-display.js", "js/science-context.js", "data/application.json",
  "data/terrain_grid.json", "data/scenario.json", "data/preset.json",
  "data/sources.json", "data/optical.webp", "data/slope.png", "data/thermal_context.png",
  "data/regional-context.json", "data/regional-context.svg",
];
const checks = [];
for (const name of expected) {
  assert.ok((await stat(path.join(deploy, name))).isFile());
  checks.push({ id: `FILE-${name}`, status: "PASS" });
}
for (const name of await readdir(path.join(deploy, "js"))) {
  assert.ok(name.endsWith(".js"));
  const filename = path.join(deploy, "js", name);
  execFileSync(process.execPath, ["--check", filename]);
  const text = await readFile(filename, "utf8");
  assert.ok(!/(?:from\s*|import\s*\()["']node:/.test(text) && !text.includes("localhost") && !text.includes("C:\\"));
  for (const match of text.matchAll(/from\s+["'](\.[^"']+)["']/g)) {
    assert.ok((await stat(path.resolve(path.dirname(filename), match[1].split("?")[0]))).isFile());
  }
  checks.push({ id: `COMPILED-MODULE-${name}`, status: "PASS" });
}
const html = await readFile(path.join(deploy, "index.html"), "utf8");
assert.match(html, /src="\.\/js\/app\.js\?v=[\d.]+-[a-f0-9]{12}"/);
assert.ok(!html.includes("<base "));
assert.ok(!html.includes("https://cdn"));
assert.ok(html.includes("Interactive Marswalk Planner") && html.includes('id="step-4"'));
assert.ok(html.includes('id="layer-notice"') && html.includes('id="layer-scale"'));
assert.ok(html.includes('id="marker-key"') && html.includes('aria-describedby="layer-detail marker-key"'));
assert.match(html, /<label for="planning-preset">Planning preset<\/label>/);
assert.match(html, /<select id="planning-preset" aria-describedby="preset-help preset-summary" disabled>/);
assert.ok(html.includes('id="review-preset"') && html.includes("Terrain exploration preset in Activities"));
checks.push({ id: "PLANNING-PRESET-NATIVE-CONTROL-AND-GUIDANCE", status: "PASS" });
for (const id of ["budget-help", "science-help", "reserve-help", "speed-help", "slope-help", "uphill-help", "downhill-help", "parameter-explanation"]) {
  assert.ok(html.includes(`id="${id}"`), `Missing deployed parameter help: ${id}`);
}
assert.match(html, /<fieldset class="map-view-control">\s*<legend>Map view<\/legend>/);
assert.match(html, /id="focus-map" type="button" aria-pressed="true">Destination \/ route<\/button>/);
assert.match(html, /id="fit-map" type="button" aria-pressed="false">Whole area<\/button>/);
checks.push({ id: "MAP-VIEW-SEGMENTED-CONTROL", status: "PASS" });
const css = await readFile(path.join(deploy, "styles.css"), "utf8");
assert.ok(css.includes("--space: #0b1120") && css.includes("--workspace: #f3f6fb"));
assert.match(css, /\.workspace \{[^}]*background: var\(--workspace\)/);
assert.match(css, /\.workspace, \.card, #mission-brief \{[^}]*background: #fff/);
checks.push({ id: "HYBRID-SPACE-THEME-LIGHT-WORKSPACE", status: "PASS" });
const assetKey = html.match(/styles\.css\?v=([\d.]+-[a-f0-9]{12})/)?.[1];
assert.ok(assetKey);
const illustrations = [...html.matchAll(/src="\.\/mars-illustration\.svg\?v=([^"]+)"/g)];
assert.equal(illustrations.length, 2);
for (const image of illustrations) assert.equal(image[1], assetKey);
assert.deepEqual(await readFile(path.join(deploy, "mars-illustration.svg")), await readFile(path.join(root, "public", "mars-illustration.svg")));
checks.push({ id: "DAWN-ILLUSTRATION-VERSIONED-AND-UNCHANGED", status: "PASS" });
assert.match(html, /<details id="science-context"><summary>Why this location\?<\/summary>/);
assert.ok(html.includes('id="science-review"') && html.includes("H, P, S, A, B, C, X"));
checks.push({ id: "SCIENCE-CONTEXT-DISCLOSURE-AND-REVIEW", status: "PASS" });
assert.match(html, /<details id="regional-context"><summary>Where is this Marswalk\?<\/summary>/);
const regional = JSON.parse(await readFile(path.join(deploy, "data", "regional-context.json"), "utf8"));
const regionalImage = await readFile(path.join(deploy, "data", regional.imageAsset));
assert.equal(createHash("sha256").update(regionalImage).digest("hex"), regional.imageSha256);
assert.equal(regional.usedForRouting, false);
assert.equal(regional.tiles.length, 4);
assert.ok(!/https?:\/\//.test(regionalImage.toString("utf8").replace(/<metadata>[\s\S]*?<\/metadata>/, "").replace('xmlns="http://www.w3.org/2000/svg"', "")));
checks.push({ id: "REGIONAL-CONTEXT-LOCAL-IMAGE-AND-ROLE", status: "PASS" });
assert.ok(html.includes('role="group" aria-label="Save and download options"'));
assert.match(css, /\.export-actions \{ display: grid; grid-template-columns: minmax\(0, 1fr\);/);
checks.push({ id: "EXPORT-ACTIONS-FULL-WIDTH-COLUMN", status: "PASS" });
assert.match(html, /<section class="homebound-focus" aria-labelledby="why-homebound-title">/);
for (const title of ["Complete-trip planning", "Explainable what-if", "Science-to-brief workflow"]) {
  assert.ok(html.includes(`<h3>${title}</h3>`));
}
assert.ok(html.includes("At science location S, connect an image-supported question"));
const { applicationVersion } = JSON.parse(await readFile(path.join(root, "config", "application.json"), "utf8"));
assert.ok(html.includes(`Application ${applicationVersion} &middot; Model 1.0.0`));
checks.push({ id: "LANDING-FOCUS-AND-CAPABILITY-CARDS", status: "PASS" });
assert.match(html, /<details id="related-tools" class="related-tools">\s*<summary>Related tools and our focus<\/summary>/);
for (const url of ["https://trek.nasa.gov/mars/jpl/config/textAbout.html", "https://jmars.mars.asu.edu/getting-started"]) {
  assert.ok(html.includes(`href="${url}" target="_blank" rel="noopener noreferrer"`));
}
checks.push({ id: "RELATED-TOOLS-NATIVE-DISCLOSURE", status: "PASS" });
const hashes = JSON.parse(await readFile(path.join(root, "evidence", "application-deployment-inputs.json"), "utf8"));
for (const item of hashes) {
  const bytes = await readFile(path.join(deploy, "data", item.filename));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), item.sha256);
}
checks.push({ id: "RELATIVE-PATHS-NO-CDN", status: "PASS" });
checks.push({ id: "STAGED-DATA-MATCHES-SOURCE", status: "PASS" });
const result = { applicationVersion, executedUtc: new Date().toISOString(), checks, hostingClaim: "Static compatibility verified locally; no actual Rumahweb account deployment was performed." };
await writeFile(path.join(root, "evidence", "application-deployment-checks.json"), JSON.stringify(result, null, 2));
console.log("Static-delivery checks passed:", checks.length);
