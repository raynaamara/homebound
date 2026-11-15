# HOMEBOUND 1.1.12 - Application Deployment Guide

## Deploy the application, not the historical model lab

Use **HOMEBOUND_Application_Rumahweb_Upload.zip**. Its root contains `index.html`, `styles.css`, `.htaccess`, `HOMEBOUND_BUILD.txt`, `js`, and `data`. This is a static application; the browser executes compiled JavaScript and a Web Worker.

No hosting-side Node.js, Python, PHP, database, account system, API key, or external CDN is required. Node.js is used only to rebuild on the development computer. The old model/data ZIPs remain historical releases and were not replaced.

## Upload safely

1. Back up the current website and hosting configuration.
2. In the control panel, confirm the intended domain/subdomain document root. Do not assume every domain uses the main `public_html` directory.
3. Prefer an isolated folder such as `public_html\homebound` when another site already exists.
4. Upload the application ZIP and extract its **contents** directly into that folder. Avoid an unintended extra `deploy` parent directory.
5. Review the supplied `.htaccess` rather than overwriting an existing site's file. The application does not need an SPA rewrite.
6. Preserve file/folder names and case, enable HTTPS using the hosting account's supported workflow, and open the final URL with a trailing slash.
7. Remove the publicly uploaded ZIP after successful extraction if it is no longer needed there.

The `data` directory includes `application.json`, the approved research preset, original scenario, prepared terrain grid, source metadata, and display images. The `js` directory includes the app, worker, engine, protocol, workflow, and map-view modules.

## Post-upload functional checks

1. The introduction should explain terrain, observation time, and a protected return reserve. The heading is **HOMEBOUND - Interactive Marswalk Planner**, not Decision Model Lab.
2. Click **Start a guided plan**. The first selected destination must be explicitly labeled hypothetical guided practice P, not a NASA-approved science target.
3. Continue to **Activities**. **Science walkthrough** must be the initial Planning preset. Keep its illustrative 120-minute budget, 20-minute observation, 20-minute reserve, and 30 m/min / 20-degree / uphill 4 / downhill 2 travel assumptions.
4. Review the plan. Expected extra margin is approximately **61.92 minutes**, outbound **8.77 minutes**, return **9.31 minutes**, and maximum total observation **81.92 minutes**.
5. Set extra observation to **63 minutes** and calculate the comparison. Expected revised extra margin is approximately **-1.08 minutes**, with the original 20-minute reserve retained.
6. Restore the original and confirm that it returns to the original result. Changing a duration should reuse the route search.
7. Save a mission brief. Test the human-readable print layout, text export, and technical JSON in a normal browser.
8. Edit a primary input. Previous plans, briefs, download URLs, and print readiness must be invalidated until a fresh calculation exists.
9. Inspect original target A under the 20-degree preset. It must report **No route under the selected assumptions** with unavailable times, without relocating H/A/B/C or relaxing the limit. The finding can still be saved.
10. Test the custom-point keyboard controls, explicitly enabled map picking, map layers, route focus/whole-area view, mobile layout, and source references.
11. Before calculation, selecting time-margin overlay must visibly explain that a calculation is required and that the optical base is shown. Editing a calculated plan must explicitly mark the overlay unavailable until recalculation.
12. Elevation must show a readable color palette and a meter legend that follows the visible map extent. This is display contrast only; source values and decision-model inputs remain unchanged.
13. Thermal context retains coarse 100 m information and a relative DN legend, not temperature units or invented fine detail.
14. Map layer interpretation and legend limits must be present in print/text/JSON briefs. Refresh after deployment; compiled modules, CSS and JSON requests carry build-content version keys to avoid mixed cached releases.
15. Destination cards must visibly show Location P/S/A/B/C/X. The default-open marker key maps the same names and codes, explains fixed origin H, and identifies X as custom-only. Activities, selected caption and saved brief must retain the selected code.
16. Each of the seven activity/travel parameters must have a visible definition and accessible description. Advanced coefficients are unitless; the separate native disclosure explains 1.40/1.20 examples and the difference between percent grade and degrees. Confirm keyboard, pointer, mobile, and normal-device touch behavior without interpreting illustrative values as operating standards.
17. Customer-facing pages, print/text briefs and JSON explanation text use concise planning/method copy without the removed recurring boilerplate. Source credits, qualitative DN context, assumptions and actual over-budget/no-route results remain visible.
18. Map view must appear below Layer as two equal-width toggle buttons: Destination / route and Whole area. Exactly one is pressed; destination/Activities auto-focus updates it. Check keyboard Tab/Enter/Space, repeated active clicks, 390/320 px layouts, layer changes, and saved-brief images without changing the numerical result.
19. Martian Dawn must show a visible decorative planet beside the desktop hero, three focus cards below it, orange actions and opaque light work surfaces. Mobile retains its own planet area; the workspace retains a mini-Mars. Check keyboard focus, 390/320 px overflow and white print output. Scientific maps/status colors keep their original meaning.
20. The upload includes mars-illustration.svg at its root. Both illustration URLs must share the CSS/application content-version key, and the image must decode without external dependencies. Confirm a 280-360 px desktop planet and a 120-160 px mobile planet without overlapping copy or hiding the primary action.
21. Location S must remain separate from practice P and original A/B/C. Why this location? must show the exact S crop, question, observation/interpretation distinction and NASA sources. Check the same context in Review, TXT/JSON and print. Crop pixels must stay optical when the main map changes layer; switching to P or custom X must clear S context. Reference S margin is 67.60 min at the unchanged default; +68 minutes exceeds the budget without spending reserve.
22. Save brief export controls must form one full-width column, with equal 48 px targets, 14 px text and 12 px vertical gaps at narrow desktop and mobile widths. Check PDF/TXT/JSON order, original file names/handlers, keyboard focus, stale-state hiding and exclusion from print. Inspect technical JSON and Review remain separate.
23. Why HOMEBOUND? must present the three complete-trip, what-if and science-to-brief cards beneath the hero. Related tools and our focus starts closed, opens with Enter/Space, and provides clearly styled official Mars Trek/JMARS links in new tabs. Check a 44 px summary target, desktop/tablet/mobile layouts and unchanged P/S decisions. The text acknowledges existing planning capabilities; it does not claim exclusive features or comparative superiority.
24. In Destination, open **Where is this Marswalk?** with keyboard or pointer. The local Gale Crater relief map must show the georeferenced study-area footprint and larger locator ring, credit NASA Mars Trek / MGS-MOLA, and explain its regional-only role and approximately 463 m source spacing. This is separate from the five detailed map layers. Check the same regional setting in print/TXT/JSON briefs, four tile references, narrow-screen layout, and root/subfolder loading without any runtime request to NASA.
25. The upload includes `data\regional-context.json` and `data\regional-context.svg`. Test a clean refresh and confirm Application 1.1.12. Under Science walkthrough, S must still give +67.60 minutes with 20 observation minutes, -0.40 with 88, and +2.60 with 85; reserve stays 20. The deck and demonstration video retain those unchanged examples.
26. Select original A, B or C, continue to Activities, and explicitly choose **Terrain exploration**. It sets budget 180 minutes and slope limit 30 degrees, retaining reserve 20, speed 30, uphill 4 and downhill 2. With the original observations 20/25/30 minutes, A/B/C must fit with margins +100.51 / +10.24 / +17.46 minutes. The higher slope is a model exploration assumption, not a validated walking limit.
27. Preset selection must not move any destination or change base observation duration. Destination changes must retain the current assumptions, not select Terrain automatically. Test the native preset menu by keyboard and at 390/320 px widths. Explicitly entered X coordinates must also remain unchanged.
28. Manually change any of the six budget/reserve/travel inputs: unmatched values must show **Custom settings** without replacing the input. Observation-only changes keep the named preset. Selecting a preset again restores all six declared values. Incomplete values must remain invalid and produce a visible calculation error, not a fallback.
29. Applying a preset to an existing original/revised comparison must clear both plans, pending replies, brief/downloads and print readiness. Recalculate before saving. Printed/TXT briefs must name the actual preset/custom state; JSON adds `planningPreset` derived from the calculated assumptions (`id: null` for Custom settings). Check the complete numeric assumptions too, not the label alone.

`FEASIBLE` only means the stated time model fits. Do not treat any result as operational safety, validated accessibility, or an approved science mission.

## Technical checks and troubleshooting

- JavaScript modules must be served with a JavaScript MIME type. Inspect `js\worker.js` and its relative imports if the model fails.
- JSON and image URLs must be publicly readable from the application directory. No login should be needed.
- Relative URLs work at a domain root or a subfolder. No hard-coded domain or Earth map projection is used.
- Launch over HTTP(S), not by double-clicking `index.html` through `file://`.
- A visible loading failure should offer **Retry loading data**; it must not substitute synthetic data.
- Existing parent-directory rewrites or hosting-wide CSP headers may need review. Do not disable protections or use world-writable `777` permissions as a shortcut.
- Native browser download/save-as-PDF dialogs and account-specific hosting behavior are post-upload acceptance checks, not claims of prior remote testing.

## Rebuild locally

From `decision-model` in Windows PowerShell, with a supported local Node installation:

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run audit:app
npm.cmd run audit:regional
npm.cmd run audit:presets
npm.cmd run build
npm.cmd run check:delivery
npm.cmd run preview
```

Use the application source ZIP to preserve the required relative location of the prepared web inputs. The developer-only `--qa-case` preview fixtures are for local testing and do not belong on the production server.

Rumahweb's official local-build/upload reference: https://www.rumahweb.com/journal/deploy-react-js-di-cpanel-hosting/ . The static principle applies here without requiring React or a server-side Node process.

No actual Rumahweb credentials or hosting account were accessed during development. Human usability studies, expert review of scientific relevance, and any competition-eligibility decision remain separate.

## Current release verification

The local 1.1.12 release passed 160 unit/regression tests, 8 application integration checks, 42 static checks, 7 rerun regional data/model checks, 8 preset data/model checks, and 11 fresh Edge preset-browser checks. The browser checks use the real worker and exact full plans, actual named/custom TXT/JSON downloads and native PDFs, keyboard/mobile/subfolder paths, invalid-input/configuration retry, and a deliberately delayed reply after a preset change. Older release-specific browser records, including 1.1.11 regional checks, retain their historical scope.

For the focused browser reproduction, install the pinned documentation/browser requirements in a local environment if they are missing, build the application, then run `python scripts\check-planning-presets-browser.py` from `decision-model`. The script closes only its own temporary server/browser. Local verification does not deploy this release to the public website.

## Regional-map source and reproduction

The new regional setting uses four actual MGS/MOLA color-shaded-relief tiles supplied by NASA Mars Trek, one of the challenge's listed resources. `sources.json` adds a distinct regional source; its URL/hash identify the tile containing the study area. All four source tile URLs/hashes, the WMTS capabilities receipt, map bounds, image hash and georeferencing are recorded in `data\regional-context.json`. The SVG embeds the source pixels, with crop/grid/locator annotations; it contains no external image requests.

The source ZIP also includes the small original spatial-reference metadata and cached source tiles/receipts. `python scripts\prepare-regional-context.py` reproduces the prepared SVG and metadata using Python's standard library. Use `--refresh` only to deliberately retrieve fresh originals. This processing does not modify any routing raster, scenario coordinate or travel parameter.
