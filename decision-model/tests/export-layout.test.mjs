import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");
const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

test("export actions form one full-width column with equal control typography and targets", () => {
  assert.match(css, /\.export-actions \{ display: grid; grid-template-columns: minmax\(0, 1fr\); gap: \.75rem;/);
  assert.match(css, /\.export-actions button, \.export-actions \.button \{[^}]*width: 100%;[^}]*min-height: 48px;[^}]*font-size: \.875rem;[^}]*line-height: 1\.35;[^}]*justify-content: center; text-align: center/);
  assert.doesNotMatch(css, /\.export-actions \{[^}]*flex-wrap/);
});
test("named export group retains its labels, file names and primary-secondary hierarchy", () => {
  const group = html.match(/<div class="export-actions" role="group" aria-label="Save and download options">([\s\S]*?)<\/div>/)?.[1];
  assert.ok(group);
  assert.match(group, /id="print" class="primary" type="button" disabled>Print \/ save as PDF/);
  assert.match(group, /id="download-text" class="button secondary" download="HOMEBOUND_Mission_Brief\.txt" hidden/);
  assert.match(group, /id="download-json" class="button secondary" download="HOMEBOUND_Mission_Plan\.json" hidden/);
  assert.ok(group.indexOf('id="print"') < group.indexOf('id="download-text"'));
  assert.ok(group.indexOf('id="download-text"') < group.indexOf('id="download-json"'));
  assert.ok(!group.includes("Inspect technical JSON") && !group.includes("Review</button>"));
});
test("export layout preserves hidden download states and is excluded from print", () => {
  assert.match(css, /\[hidden\] \{ display: none !important;/);
  const print = css.slice(css.indexOf("@media print"));
  assert.match(print, /\.export-actions[^}]*display: none !important/);
});
