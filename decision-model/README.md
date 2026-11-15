# HOMEBOUND - Interactive Marswalk Planner

Application 1.1.12, using the unchanged decision model 1.0.0. An explainable, time-based Marswalk planning application.

For the public repository overview, license and publishing instructions, start with the [root README](../README.md). Current final media are in [docs/demo](../docs/demo/), with separate version/provenance records. The [evidence guide](evidence/README.md) explains current source checks versus retained historical records.

## Guided application

The interface now supports one four-step workflow:

1. **Destination:** begin at practice P, choose image-supported science candidate S, or inspect original A/B/C or custom X.
2. **Activities:** choose an explicit planning preset, then review the budget, observation time and protected reserve. Travel coefficients remain editable in advanced assumptions, with their current values summarized.
3. **Review:** inspect the human-readable decision, routes, time breakdown, and an original-versus-revised additional-observation comparison.
4. **Save brief:** print/save a research brief or export plain text and traceable JSON, including unavailable/no-route findings.

All seven activity/travel parameters have concise visible definitions linked through `aria-describedby`. Coefficients are explicitly unitless. Native expandable **How these assumptions affect the model** help explains the 10% uphill/coefficient 4 -> 1.40 and 10% downhill/coefficient 2 -> 1.20 examples; 10% grade is not 10 degrees. The additional-observation field explains that its value is added to the original duration.

Customer-facing copy now focuses on planning context, methods, sources and actionable decisions. Recurring operational/certification/eligibility boilerplate was removed from the interface and generated briefs. `decisionExplanation` and `displayedPlan` format user-facing prose without modifying raw engine results or technical provenance. Over-budget and unavailable-route outcomes remain explicit.

The approved guided practice uses the already tested row 70, column 37 witness. It is **not** presented as a validated science destination. Original H/A/B/C and the 20-degree nominal limit are unchanged.

Destination cards explicitly show **Location P/S/A/B/C/X**, matching the default-open map marker key. **H** is the fixed hypothetical origin and return point, not a destination choice. **X** means a custom point and appears on the map only when custom is selected. Some markers may be outside the current viewport; choose **Whole area** to locate them. Activities, captions and saved briefs retain the same codes; JSON retains the full marker key. These are locations in the same study area, not separate scenario maps.

Changing primary inputs invalidates the plan and all previous exports. Editing extra observation time preserves the original snapshot but disables saving until the comparison is calculated or the original is explicitly restored. Late worker responses cannot replace an edited plan.

### Explicit planning presets (1.1.12)

Use **Activities -> Planning preset**:

| Preset | Budget | Slope limit | Purpose |
|---|---:|---:|---|
| **Science walkthrough** - initial default | 120 min | 20 degrees | Preserve the P/S walkthrough, including S at 20/88/85 observation minutes. |
| **Terrain exploration** | 180 min | 30 degrees | Explore complete routes to original A, B and C without moving any waypoint. |

Both use a 20-minute reserve, 30 m/min reference speed, uphill coefficient 4 and downhill coefficient 2. Selecting a preset explicitly restores all six budget/reserve/travel inputs. It does not choose a destination or change the base observation duration. Changing destinations retains the selected assumptions; there is no automatic threshold relaxation. The 30-degree allowance is a model exploration assumption, not a validated walking limit.

With the original observation durations, Terrain exploration gives:

| Destination | Observation | Required, including reserve | Extra margin |
|---|---:|---:|---:|
| A | 20 min | 79.49 min | +100.51 min |
| B | 25 min | 169.76 min | +10.24 min |
| C | 30 min | 162.54 min | +17.46 min |

Editing any controlled input labels unmatched values **Custom settings**; observation-only edits do not change preset identity. Returning all six values to a named preset restores its label. Review, printed/TXT briefs and JSON record the preset/custom identity from the **calculated plan**, not the last menu selection; JSON adds `planningPreset` with `id: null` for custom assumptions. Numeric assumptions remain explicit.

A preset change clears the original/revised comparison, pending results, downloads and print readiness until recalculation. Invalid configuration stops startup visibly; incomplete numeric input is not replaced with a preset value. Under Science, S still has margins +67.60 / -0.40 / +2.60 minutes for 20 / 88 / 85 observation minutes, retaining 20 minutes of reserve. Existing deck/video captures are unchanged and remain reproducible.

The map uses the source Mars grid, supports destination/route focus and whole-area views, and keeps optical, elevation, slope, opportunity, and qualitative thermal layers available. Keyboard coordinate inputs are an alternative to explicitly enabled map picking.

**Map view** is a full-width segmented control below Layer. **Destination / route** and **Whole area** are native buttons with mutually exclusive `aria-pressed` states. `MissionMap.viewMode` is read-only and follows `fit()` / `fitArea()`, so automatic focus from destination selection or Activities also updates the active segment. Tab, Enter and Space remain native keyboard actions; clicking an already active option repeats its original viewport action. Targets are at least 44 px high, with equal columns and a visible focus outline. Layer changes preserve the chosen extent; saved brief images follow it. Invalid custom coordinates are reported before a requested whole-area change can desynchronize the canvas and active option.

### Regional setting from NASA Mars Trek (1.1.11)

The native **Where is this Marswalk?** disclosure in Destination shows a static, local regional map of Gale Crater. It uses actual NASA Mars Trek WMTS tiles from **Mars_MGS_MOLA_ClrShade_merge_global_463m**, based on Mars Global Surveyor/MOLA. The study-area footprint is derived from the recorded HiRISE Mars projection and checked against all four previously prepared geographic corners. A larger locator ring makes that small footprint visible; it is not a walking route or destination marker.

MOLA's approximately 463 m source spacing provides regional orientation only. It does not replace the HiRISE elevation/slope grid, identify geological units, or change route costs. The five detailed map layers, all scenario coordinates, travel assumptions and 20/88/85-minute S examples remain unchanged. The new map is not an additional selectable routing layer.

`data\homebound\web\regional-context.json` records the study/map bounds, projection-source hash, processed SVG hash, service metadata and all four original tile URLs/hashes. `sources.json` preserves the first three product records and adds a separate MGS/MOLA entry whose URL/hash identify the tile containing the study area. The other three tiles are explicitly recorded in the regional metadata. Printed, TXT and JSON briefs retain the regional role and provenance, including for practice/custom/original destinations without inheriting S's science evidence.

The SVG embeds its original JPEG tiles, so there is no live Mars Trek/API/CDN dependency. Startup validates the metadata and decodes the local image; missing or invalid data produce the existing visible loading error/retry path rather than substituted imagery. Regional data and source catalog bytes participate in the build fingerprint.

To reproduce the context map, run `python scripts\prepare-regional-context.py` from this directory. The supplied hash-checked original tiles/receipts are reused; `--refresh` explicitly downloads new originals over verified HTTPS. The source handoff includes the small original spatial-reference metadata, but no large raw HiRISE files. Source terrain imagery is real NASA mission-derived relief.

### Why HOMEBOUND? (1.1.10)

The existing three landing cards now explain **Complete-trip planning**, **Explainable what-if**, and **Science-to-brief workflow** beneath a named **Why HOMEBOUND?** section. Science evidence is explicitly associated with S, not inherited by all destinations. The hero, start action and four-step planner are unchanged.

The initially closed native **Related tools and our focus** disclosure links the reviewed official Mars Trek and JMARS references, acknowledges their mapping/analysis and planning capabilities, and presents HOMEBOUND as a complementary focused workflow rather than an exclusive or superior routing invention. Those tool-comparison links remain references. Separately, release 1.1.11 uses actual Mars Trek MGS/MOLA tiles for the regional setting; JMARS remains a reference, and neither portal is a runtime dependency.

Cards stack at tablet/mobile widths; the disclosure has a 44 px minimum target, dark-surface focus styling and ice-blue links. The whole introduction remains outside printed mission briefs. No routing formula, NASA data, scenario coordinate or reserve calculation changed.

### Save and download options (1.1.9)

The Save brief export group uses one full-width column for PDF, TXT and JSON. Native button/anchor semantics and DOM order are unchanged; all three controls share 48 px minimum height, 14 px text and 12 px gaps. The primary/secondary color hierarchy remains, while technical JSON inspection and Review navigation stay outside the export group. Existing hidden/stale and print rules still apply.

### Image-supported science context (1.1.8)

**Location S**, row 84 / column 42, is a separate user-approved observation candidate. It asks how the visible transition between dark linear-patterned terrain and the brighter rough-textured patch relates to local relief. This is a question to investigate, not an asserted material composition or geological origin.

The native **Why this location?** disclosure presents the question, observation task, rationale, observed image features, interpretation and source links. Its optical crop always uses the same prepared HiRISE display: rows 54-113 / columns 12-71, covering about 303.5 m. The selected cell center is marked exactly in a 360 x 360 image; the view is a nearest-neighbor enlargement of the prepared contrast-stretched, lossy display, not added source detail.

The acquisition page dates ESP_012195_1750 to **3 March 2009**. The DTM/ortho provider page and original product identities/hashes are retained. The crop has 3,600 known terrain cells, with model elevations from -2701.418 to -2665.249 m. THEMIS remains regional qualitative context at native 100 m spacing and is not a route cost.

The unchanged nominal preset produces an S round trip with **67.59608929948027 min** margin. Adding 68 observation minutes produces -0.40391070051973 min, with the reserve intact. Changing the slope limit to 10 degrees removes the modeled route without changing the scientific question. Science interest and route/time feasibility are separate.

Review, printed/text briefs and JSON retain the same context and evidence coordinates. Source types, crop bounds, marker identity and calculated destination are checked; P, A/B/C and custom X do not inherit S evidence. P remains the default guided practice, and all original coordinates/preset values remain unchanged. `evidence\science-selection-evidence.json` records the reproducible input, crop geometry, terrain facts and nominal plan.

### Visual theme (1.1.7)

**Martian Dawn** uses deep-space framing, a dedicated decorative Mars scene, burnt-orange actions and an opaque light workspace. The three focus cards sit below the hero instead of covering the planet. A separate mini-Mars stays in the workspace heading during planning.

| Role | Color |
|---|---|
| Space frame | `#0B1120` |
| Dark story surfaces | `#132238` |
| Workspace / cards | `#F3F6FB` / `#FFFFFF` |
| Body / helper text | `#17324D` / `#526372` |
| Primary actions / hover | `#B94F2E` / `#9F3F25` with white text |
| Selected surfaces / orbital details | `#FBEADF` / `#B7D7FF` |
| Light copper text / workspace links | `#EFB39A` / `#4059B8` |

The local 5,051-byte SVG is illustrative artwork, not calibrated imagery or terrain data. It has static stars, sunlit/shadowed surface details and an orbital arc. Desktop planet diameters were measured at 295-319 px; mobile retains a separate 141 px planet with the primary action visible within an 844 px viewport. Both uses of the asset receive the release content-version query key, and SVG bytes participate in the build fingerprint.

Action/selection colors share CSS tokens across buttons, destination cards/radios, the stepper and map-view controls. White/action contrast is 4.98:1 and white/hover is 6.54:1. Scientific/status palettes remain separate. Decoration is noninteractive, adds no controls or external dependencies, and is omitted from the printed brief. These checks cover representative palette pairs and keyboard paths, not a full accessibility audit.

Prepared scientific inputs, display color functions and the routing engine are unchanged. The new S marker intentionally changes annotated map images; earlier exact five-canvas hashes retain their historical scope. For the new evidence crop, 128,391 pixels outside the marker annotation matched an independently drawn crop with zero differences. No filters or opacity changes tint the map. Print CSS retains the scientific crop on white while hiding decorative mini-Mars.

### Map-layer interpretation (1.1.1)

- **Time-margin overlay:** a visible notice explains when no current calculation exists, when it is calculating, or when edits require recalculation. The optical base is explicitly named rather than silently presented as a completed overlay.
- **Elevation:** colors are calculated from unchanged numeric elevations, stretched over the visible map extent with a meter legend. Focus/fit changes the display scale, not scientific values or route costs. Equal elevations use one color; unknown data do not become zero.
- **Thermal:** coarse grayscale blocks remain honest to native 100 m information spacing. A relative 0-255 DN legend and view-width explanation explicitly reject temperature/physical-calibration claims.
- Map interpretation and legend ranges are retained in print/text/JSON briefs.
- Build-content query keys version JavaScript modules, CSS and JSON requests so a refreshed deployment does not mix old cached modules/configuration with new HTML.

The earlier "Decision Model Lab" label described the technical validation interface. It is not a second application and is no longer the product heading. This application remains a research prototype; a human usability study and scientific validation have **not** been performed.

## What is implemented

- Strict runtime parsing of the prepared 300 x 300 Mars grid.
- Eight-neighbor terrain graph with slope, edge-grade, unknown-data, explicit exclusion, and conservative diagonal constraints.
- Positive directional travel costs; separate outbound and return Dijkstra searches.
- Complete-excursion time accounting, reserve preservation, science allowance, latest modeled return-departure time, and explicit unavailable results.
- Science-opportunity fields and inspectable JSON outputs.
- A static English guided application using a Web Worker; no runtime backend or third-party CDN.

The original Science walkthrough assumptions are illustrative: 30 m/min, 20-degree slope limit, uphill coefficient 4, downhill coefficient 2. Terrain exploration changes the budget and slope limit explicitly as described above. These are not NASA standards or calibrated astronaut performance.

## Important actual finding

At the nominal preset, the source scenario's original targets A, B, and C have **no modeled round-trip route** from H. The origin-connected component contains 1,276 cells; 17,306 of 90,000 cells meet the node-level data/slope rules.

No endpoint is relocated and no threshold is automatically relaxed. A separately labeled integration witness at row 70, column 37 demonstrates the complete calculation without pretending to be a science recommendation.

The sensitivity experiment at 25 degrees connects A; at 30 degrees all three targets connect, but B and C exceed the scenario's 120-minute budget. The explicit Terrain exploration preset pairs 30 degrees with 180 minutes so all three fit their original observations and reserve. These remain model what-if assumptions, not recommended operating limits.

## Build and verify locally

Use Node.js 22.18 or newer; Node 26.13.0 and TypeScript 7.0.2 were used for this delivery. Node is needed on the development computer, **not on the Rumahweb hosting account**.

From this directory in Windows PowerShell:

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

Open the HTTP URL printed by the preview server. `file://` double-clicking is not supported because module workers and fetch require an HTTP(S) origin. Stop the local preview when finished.

The prepared data are read from `..\data\homebound\web`. The source archive includes that relative directory. Existing data-preparation files are not changed.

## API

```javascript
import { parseTerrainGrid, MarswalkPlanner } from "./dist/engine.js";

const grid = parseTerrainGrid(preparedGridJSON);
const planner = new MarswalkPlanner(
  grid,
  { row: 105, column: 43 },
  {
    baseSpeedMPerMin: 30,
    maximumSlopeDegrees: 20,
    uphillPenalty: 4,
    downhillPenalty: 2
  }
);
const decision = planner.plan(
  { row: 113, column: 119 },
  {
    missionBudgetMinutes: 120,
    scienceMinutes: 20,
    reserveMinutes: 20
  }
);
```

This library example deliberately returns `NO_MODELED_ROUTE` on nominal target A. The guided application's initial P waypoint is a different, explicitly hypothetical connected practice point.

### Input and output rules

- Parse source JSON with `parseTerrainGrid` before constructing a planner. Treat the parsed grid and arrays as immutable after construction.
- The engine accepts north-up, unrotated metric Mars grids, up to 1,000,000 cells as an explicit browser resource guard. It does not interpret Earth EPSG:4326 or Web Mercator.
- Grid values are means/maxima from the prepared source, not a new hazard survey. Unknown samples remain unknown.
- Destination/origin/blocked cells use zero-based integer row and column coordinates.
- `plan()` returns `FEASIBLE`, `TIME_BUDGET_EXCEEDED`, `INSUFFICIENT_DATA`, or `NO_MODELED_ROUTE`.
- Invalid input throws `ModelInputError`; the worker converts this to an explicit error envelope. No silent defaults are used.
- Unavailable plan times and routes are `null`, not zero. Route `cells` are zero-based row-major indices.
- `center(cell)` supplies projected metre coordinates; route cell index `i` maps to row `floor(i / width)` and column `i % width`.
- `scienceOpportunity()` returns typed arrays. Use `serializeOpportunityField()` for JSON so non-evaluable field samples become `null`, not non-standard NaN/Infinity.
- The worker caches a planner by origin and all four travel parameters. Changes in destination, budget, science, or reserve do not rebuild route searches.
- Build a new planner when the grid, excluded cells, origin, or travel parameters change. Do not mutate the existing grid and expect cached routes to update.
- The browser example has no blocked-cell editing UI. The library accepts explicit blocked cells as its optional fourth constructor argument.

## Equations and scope

For adjacent cells, horizontal distance comes from the metric affine spacing, elevation rise from the prepared block means, and grade is rise divided by horizontal distance.

```text
surface_distance = sqrt(horizontal_distance^2 + rise^2)
edge_time = surface_distance / base_speed
            * (1 + uphill_coefficient * max(grade, 0)
                 + downhill_coefficient * max(-grade, 0))

required = outbound + science + return + reserve
margin = budget - required
max_science = budget - outbound - return - reserve
latest_return_departure = budget - return - reserve
```

The final expression is minutes after mission start in a pre-departure plan, not an instruction based on live telemetry. The edge-time formula is an explicit heuristic, not validated physiology.

Node slope and absolute edge grade must each be within the chosen limit. A diagonal requires both orthogonal two-step corridors to be permitted. This restrictive policy intentionally prevents corner cutting; it does not prove physical walkability.

Time values within `1e-9` minutes of zero are normalized only to handle floating-point boundary arithmetic; the raw margin is retained. This tolerance is not a safety reserve. No physical precision is implied by decimal output.

## Rumahweb shared hosting

Upload **the contents of `deploy`**, or extract the new `HOMEBOUND_Application_Rumahweb_Upload.zip`, into the chosen domain/subdomain document root or an isolated subfolder such as `public_html\homebound`.

- The hosting server serves HTML, CSS, JavaScript, JSON, and images.
- TypeScript is compiled before upload. Do not upload `node_modules` or run a development server on shared hosting.
- No PHP, Python, Node.js server runtime, database, API key, or external service is required.
- URLs are relative and tested at both `/` and `/nested/homebound/`.
- No SPA rewrite is required. Review the supplied `.htaccess` rather than overwriting an existing site's configuration.
- Test JavaScript module MIME types, data URLs, worker loading, invalid inputs, and a known scenario after upload.

See `docs\HOMEBOUND_Application_Deployment_EN.md` in the workspace/source package for the application-specific checklist. Actual access to the user's hosting account was not performed.

## Evidence and limitations

Executed 1.1.12 evidence includes 160 unit/regression tests, eight real-data application checks, 42 static-delivery checks, seven rerun regional data/model checks, eight preset data/model checks, and 11 fresh Edge preset-browser checks. All nine captured Science reference plans retain their route cells, times and reserve. The seven regional-browser checks were captured on 1.1.11; these and earlier UX/browser records retain their historical scope rather than being presented as complete new reruns.

Run `npm.cmd run audit:regional` for source/georeferencing and exact-plan checks, and `npm.cmd run audit:presets` for the approved preset cases and preservation. After `npm.cmd run build`, `python scripts\check-planning-presets-browser.py` uses installed Microsoft Edge and the pinned `requirements-docs.txt` tools to check native preset/keyboard behavior, unchanged S plans, A/B/C, custom settings/X, actual TXT/JSON downloads and native PDF, 1280/900/390/320 px layouts, subfolder startup, delayed replies and visible-error/retry behavior. Its owned localhost server/browser are closed on success or failure. The separate `check-regional-browser.py` remains reproducible; its retained 1.1.11 record is explicitly historical.

For reproducible development-only browser fault checks, the preview helper accepts:

```powershell
npm.cmd run preview -- --port 4181 --qa-case missing-practice
npm.cmd run preview -- --port 4182 --qa-case delayed-grid
npm.cmd run preview -- --port 4183 --qa-case config-failure
```

These are explicit QA fixtures: one missing in-memory response cell, a delayed grid response, or a one-time configuration HTTP 503. They do not edit source data, are not part of the static upload, and must not be used as production hosting.

Unknown-data and blocked-return behavior use analytical fixtures because the prepared AOI happens to have complete input coverage. They are not falsely presented as observed missing-data cases in the current AOI.

Thermal data are qualitative visual context and are never used as calibrated temperature, thermal inertia, or a route cost. No oxygen, battery, fatigue, dynamic environment, sensor uncertainty propagation, multi-stop optimization, or validated science ranking is modeled.

Actual named/custom-preset TXT/JSON downloads and native headless-browser PDF output were checked for 1.1.12. Normal-browser OS-level save dialogs, physical-device behavior and the actual hosting account remain post-upload checks.

The previous data/model releases and pre-application register remain unchanged. Earlier application/register snapshots are retained under `docs\history`, including application 1.1.11 with master register 1.29 before the preset addition. Use the active application documents/upload/source ZIPs for 1.1.12 and the master register's current status. The Student Starter Guide, submission drafts, user-edited deck and video remain separately distributed and unchanged.

The source-only handoff intentionally omits large historical release ZIPs. `audit:app` always requires the unchanged engine and two prepared input files; `audit:regional` verifies ten protected engine/web files, original source records, spatial metadata and cached NASA tiles. `audit:presets` verifies 15 engine/prepared-input files and compares current media/reference files with the 1.1.11 preservation snapshot. Public package 1.1 documents a non-rendered regional-map metadata revision and dependent image hash; the audit additionally checks unchanged map content and all other regional fields against their original hashes. Older regional media hashes retain their original release scope; they are not rewritten to pretend later media edits were unchanged. Historical releases/reference documents are verified when present; missing history is reported explicitly as `NOT_PRESENT`, never falsely counted as preserved. Transient Office `~$` lock files are session state, not deliverables, and are explicitly excluded without reading or changing them.

No claim is made that this model replaces Mars Trek, JMARS, SEXTANT, or validated EVA tools.
