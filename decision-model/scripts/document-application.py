from __future__ import annotations

import argparse
import csv
import hashlib
import html
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from zipfile import ZipFile

from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt
from openpyxl import Workbook, load_workbook

import build_documents as formatters

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT.parent / "docs"
GUIDE = DOCS / "HOMEBOUND_Application_User_Guide_EN.docx"
QA_BOOK = DOCS / "HOMEBOUND_Application_QA_EN.xlsx"
APPLICATION_VERSION = json.loads((ROOT / "config" / "application.json").read_text())["applicationVersion"]


def load(name: str):
    return json.loads((ROOT / "evidence" / name).read_text(encoding="utf-8"))


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def unit_records() -> list[dict]:
    raw = (ROOT / "evidence" / "application-unit-tests.txt").read_bytes()
    text = raw.decode("utf-16" if raw.startswith((b"\xff\xfe", b"\xfe\xff")) else "utf-8-sig")
    text = re.sub(r"\x1b\[[0-9;]*m", "", text)
    records = []
    for line in text.splitlines():
        match = re.match(r"^\u2714 (.+?) \(([\d.]+)ms\)$", line.strip())
        if match:
            records.append({"id": f"T{len(records)+1:02d}", "name": match.group(1), "status": "PASS", "milliseconds": float(match.group(2))})
    reported = re.search(r"\btests (\d+)\b", text)
    if reported is None or len(records) != int(reported.group(1)) or len(records) < 61 or not re.search(r"\bfail 0\b", text):
        raise RuntimeError("The executed log does not prove that the complete recorded test suite passed.")
    return records


def page(document, number: int, title: str):
    if number > 1:
        document.add_page_break()
    formatters.p(document, f"{number:02d} / APPLICATION USER GUIDE & HANDOFF", bold=True, size=9, color=formatters.TEAL)
    formatters.p(document, title, style="Heading 1")


def crop_workspace() -> Path:
    import pymupdf

    original = ROOT / "evidence" / "application-workspace.png"
    output = ROOT / "evidence" / "application-workspace-excerpt.png"
    size = pymupdf.Pixmap(original)
    with pymupdf.open(original) as image:
        with pymupdf.open("pdf", image.convert_to_pdf()) as pdf:
            page = pdf[0]
            scale = size.width / page.rect.width
            clip = pymupdf.Rect(0, 0, page.rect.width, page.rect.height * min(size.height, 900) / size.height)
            page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), clip=clip, alpha=False).save(output)
    return output


def parameter_rows():
    source = (ROOT / "public" / "index.html").read_text(encoding="utf-8")
    rows = []
    for label, unit, identifier in [
        ("Mission time budget", "minutes", "budget-help"),
        ("Observation time", "minutes", "science-help"),
        ("Protected reserve", "minutes", "reserve-help"),
        ("Reference speed", "m/min", "speed-help"),
        ("Slope limit", "degrees", "slope-help"),
        ("Uphill coefficient", "unitless", "uphill-help"),
        ("Downhill coefficient", "unitless", "downhill-help"),
    ]:
        found = re.search(rf'<p[^>]*id="{identifier}"[^>]*>(.*?)</p>', source, re.DOTALL)
        if found is None:
            raise RuntimeError(f"Visible parameter definition is missing: {identifier}")
        rows.append((label, unit, html.unescape(re.sub(r"<[^>]*>", "", found.group(1)))))
    return rows


def guide(unit_count: int, browser_count: int, static_count: int, layer_count: int, destination_count: int, parameter_count: int, copy_count: int, map_view_count: int, theme_count: int, dawn_count: int, science_count: int):
    document = formatters.setup()
    header = document.sections[0].header.paragraphs[0]
    header.runs[0].text = "HOMEBOUND  |  APPLICATION USER GUIDE & HANDOFF"
    footer = document.sections[0].footer.paragraphs[0]
    footer.runs[0].text = "Planning workflow  |  Methods and data reference  |  Page "
    document.core_properties.title = f"HOMEBOUND {APPLICATION_VERSION}: Application User Guide and Implementation Handoff"
    document.core_properties.subject = "Four-step guided planning, traceable outputs, testing, and shared-hosting delivery"
    document.core_properties.author = ""

    page(document, 1, "HOMEBOUND Application Guide")
    formatters.p(document, f"Interactive Marswalk Planner | Application {APPLICATION_VERSION} | Model 1.0.0", bold=True, color=formatters.TEAL, size=11)
    formatters.p(document, "Documentation UTC: " + datetime.now(timezone.utc).isoformat(), size=9, color=formatters.GRAY)
    formatters.heading(document, "Problem, intended user, and objective")
    formatters.p(document, "A nearby observation point is not necessarily a simple round trip. Terrain "
      "changes travel costs, scientific work takes time, and the declared return-time reserve must "
      "remain visible. HOMEBOUND helps a future Marswalk planner inspect these trade-offs before "
      "departure. The current guided practice makes the assumptions understandable to a first-time visitor.")
    formatters.table(document, ["Question", "Application answer"], [
        ("What is the solution?", "A four-step planner joining a terrain-aware time model, observation choices, explanations, comparison, and a traceable mission brief."),
        ("What is the objective?", "Help users understand which modeled observations fit the stated budget and reserve, and why an extra activity changes the outcome."),
        ("What is the output?", "A model status, available routes, directional times, observation allowance, margin, latest modeled return-departure minute, and exportable research brief."),
        ("What already exists?", "The unchanged model engine and prepared Mars data are reused. The old technical lab has evolved into the product workflow, not a second application."),
    ], [1.75, 5.16])
    formatters.heading(document, "Planning context")
    formatters.p(document, "The application provides time-based, pre-departure planning using public "
      "Mars mission data, configurable scenario inputs and traceable calculations. Terrain elevation "
      "and slope drive routing; qualitative thermal context is presented separately.")
    formatters.p(document, "The user explicitly approved guided practice using the existing connected "
      "test waypoint. Original H/A/B/C and the nominal 20-degree limit were not moved or silently "
      "relaxed. Public release 1.1.11 was previously verified. This 1.1.12 package adds "
      "explicit planning presets, keeps Science as the initial default, and awaits the user's hosting update.", bold=True, size=9.5)

    page(document, 2, "Get started in four steps")
    document.add_picture(str(ROOT / "evidence" / "differentiation-intro.png"), width=Inches(6.7))
    formatters.p(document, "Martian Dawn combines burnt-orange actions, ice-blue orbital details "
      "and a dedicated decorative Mars illustration. Why HOMEBOUND? explains complete-trip planning, "
      "what-if comparison and the science-to-brief workflow. Related tools and our focus acknowledges "
      "existing Mars Trek/JMARS capabilities through official references.", size=9, color=formatters.GRAY)
    formatters.table(document, ["Step", "What to do / what you get"], [
        ("1. Destination", "Start with practice P, choose image-supported science candidate S, or inspect original A/B/C and custom X."),
        ("2. Activities", "Choose Science walkthrough or Terrain exploration, then review the budget, observation, reserve and travel assumptions. See page 12."),
        ("3. Review", "Read the decision and its reason. Compare an additional observation with the retained original plan."),
        ("4. Save brief", "Print/save a research brief or export text and JSON, including a no-route or unavailable-data finding."),
    ], [1.55, 5.36])
    formatters.p(document, "First-run example: 120-minute budget, 20-minute observation, 20-minute reserve, "
      "30 m/min reference speed, 20-degree limit, uphill coefficient 4, downhill coefficient 2. "
      "These are illustrative scenario assumptions, not operating standards.", size=9.4)

    page(document, 3, "Choose a point and declare assumptions")
    formatters.table(document, ["Destination type", "Meaning and use"], [
        ("H: origin, not a choice", "Hypothetical fixed starting/return point on the same Mars map."),
        ("Location P: practice", "Return-aware planning practice at row 70, column 37; not a validated science destination."),
        ("Location S: science candidate", "Image-supported texture-transition question at row 84, column 42; inspect Why this location? and the evidence reference on page 10."),
        ("Location A", "Illustrative layer-pattern observation; original coordinates and duration retained."),
        ("Location B", "Illustrative dissected-terrain observation; original coordinates and duration retained."),
        ("Location C", "Illustrative ridge-and-gully observation; original coordinates and duration retained."),
        ("Location X: custom", "Your optional grid/map-picked point. X appears only when custom is selected; H remains fixed."),
    ], [1.75, 5.16])
    formatters.p(document, "Each card explicitly names its Location code. The default-open map key "
      "matches H/P/S/A/B/C/X to the same names; some points can be outside the current view. "
      "These are different locations in one area, not separate planetary maps. Original A/B/C "
      "still have no modeled route at the nominal 20-degree setting. To explore A/B/C routes, "
      "explicitly choose Terrain exploration in Activities; see page 12.", size=9.4)
    formatters.heading(document, "Keep common tasks simple")
    formatters.p(document, "The main activity inputs are mission budget, observation duration, and protected "
      "reserve, all in minutes. Reference speed, slope limit, and uphill/downhill coefficients remain "
      "editable under advanced assumptions; their current values are summarized outside that section.")
    formatters.table(document, ["Input", "Interpretation"], [
        ("Mission budget", "The whole excursion, not only time at the site."),
        ("Protected reserve", "Time explicitly retained in the calculation. It is not the same as additional unused margin."),
        ("Observation duration", "Scenario time, not an experimentally validated procedure duration."),
        ("Travel assumptions", "A transparent heuristic, not measured astronaut performance. No value is changed automatically to make a plan pass."),
    ], [1.75, 5.16])
    formatters.heading(document, "Map and data")
    formatters.p(document, "Use optical context by default. Optional layers show elevation, maximum native "
      "slope, the current time-margin field, and qualitative thermal-derived context. Focus the selected "
      "point/routes or fit the full area. Keyboard coordinates remain an alternative to map clicking.")
    formatters.p(document, "HiRISE terrain supports the model; imagery is context. THEMIS remains qualitative "
      "at native 100 m spacing and never becomes a calibrated temperature, safety class, or route cost. "
      "Complete data do not establish physical walkability.", size=9.4, color=formatters.GRAY)
    formatters.p(document, "Layer guidance: time-margin colors require a current Review calculation. "
      "Elevation uses the numeric values in the visible view with a meter legend; focusing changes "
      "display contrast, not terrain values. Thermal blocks retain native resolution and use relative DN, not temperature.", size=9.4)

    page(document, 4, "Review decisions and compare activities")
    formatters.table(document, ["Readable decision", "Meaning / next action"], [
        ("Fits the current time model", "The complete modeled trip retains the stated reserve. Try a change or save the research plan; this is not a safety certification."),
        ("Time budget exceeded", "Routes exist but time does not fit. Reduce observation time or revise the plan; reserve is not silently removed."),
        ("No route under selected assumptions", "Inspect another location or the constraints. This does not prove that no physical path exists."),
        ("Not enough data", "Required input is unavailable. No route/time is invented. Choose another location or inspect coverage."),
    ], [2.50, 4.41])
    formatters.heading(document, "Worked example from the practice calculation")
    formatters.table(document, ["Component", "Original", "With +63 min"], [
        ("Observation", "20.00 min", "83.00 min"),
        ("Outbound / return", "8.77 / 9.31 min", "8.77 / 9.31 min"),
        ("Protected reserve", "20.00 min", "20.00 min"),
        ("Required total", "58.08 min", "121.08 min"),
        ("Budget / extra margin", "120.00 / +61.92 min", "120.00 / -1.08 min"),
    ], [2.25, 2.33, 2.33])
    formatters.p(document, "This is a modeled result on actual prepared terrain, not a measured astronaut "
      "journey. The maximum total observation time is about 81.92 minutes; adding the example activity "
      "exceeds it. Shortcut buttons set the extra amount rather than accumulating repeated clicks.")
    formatters.p(document, "The latest modeled departure from this practice point is mission minute "
      "90.69 after leaving the origin. It is a fixed-scenario planning value, not a live countdown. "
      "Restore original explicitly returns to the original snapshot.", size=9.4)

    page(document, 5, "Readable map layers and availability")
    pictures = document.add_paragraph()
    import pymupdf
    image_paths = [ROOT / "evidence" / "science-map-elevation.png", ROOT / "evidence" / "science-map-overlay-pending.png"]
    image_width = min(3.25, *(7.6 * pymupdf.Pixmap(path).width / pymupdf.Pixmap(path).height for path in image_paths))
    pictures.add_run().add_picture(str(image_paths[0]), width=Inches(image_width))
    pictures.add_run(" ")
    pictures.add_run().add_picture(str(image_paths[1]), width=Inches(image_width))
    formatters.p(document, "Actual patch screenshots. Left: numeric elevation with explicit visible-view "
      "contrast and meter legend. Right: an uncalculated time-margin selection names its optical base "
      "and tells the user to calculate first. Thermal context retains coarse 100 m information and "
      "a relative-DN legend. Use Map view below Layer: Destination / route focuses the current target "
      "and available routes; Whole area shows the full map. The orange option follows automatic focus. "
      "Both native buttons support Tab, Enter and Space, and the active focus button can be clicked "
      "again to refocus. Source credit: NASA/JPL-Caltech/University of Arizona.", size=9, color=formatters.GRAY)

    page(document, 6, "Save and interpret a mission brief")
    formatters.table(document, ["Output", "Contents / purpose"], [
        ("Print / save as PDF", "A human-readable page with destination classification, purpose, decision, time breakdown, assumptions, map, source references, and limitations."),
        ("Text brief", "Portable English summary retaining reserve, unavailable values, source URLs/hashes, and the non-operational claim boundary."),
        ("Technical JSON", "Application/model versions, destination metadata, current and original plan when compared, geometry, route indices, sources, and comparison deltas."),
    ], [1.75, 5.16])
    formatters.heading(document, "Current means current")
    formatters.p(document, "Changing a destination, primary activity input, custom coordinate, or travel "
      "assumption invalidates earlier calculations and export URLs. Editing additional observation time "
      "retains the original snapshot, but saving remains blocked until recalculation or explicit restoration. "
      "Late worker replies cannot overwrite edited inputs.")
    formatters.heading(document, "Unavailable findings are legitimate outputs")
    formatters.p(document, "A no-route or insufficient-data brief records what could not be established. "
      "Times and routes remain unavailable/null, never fabricated zero. It is a finding to inspect, "
      "not a plan to execute. The original cases remain useful for explaining model constraints.")
    formatters.heading(document, "Printing and downloads")
    formatters.p(document, "Save and download options form one full-width column: PDF first, then TXT "
      "and JSON. All controls share 48 px minimum targets, 14 px text and 12 px gaps. PDF is the primary "
      "action; technical JSON inspection and Review navigation remain separate.", size=9.4)
    formatters.p(document, "Print CSS hides application controls and prints the current brief. If a plan "
      "is stale, the previous brief is cleared and a print warning is shown. Generated text/JSON Blob "
      "contents and print CSS were checked; native operating-system save/PDF dialogs remain normal-browser "
      "post-upload acceptance checks.")
    formatters.heading(document, "Traceability and precision")
    formatters.p(document, "Route indices use the prepared zero-based row-major Mars grid, not Earth "
      "GeoJSON coordinates. Visible decimals are display rounding, not orbital-data accuracy. A complete-data "
      "mask is not a traversability guarantee; source and scenario assumptions remain distinct.")
    formatters.p(document, "Print, text and JSON outputs also retain the selected layer's interpretation "
      "and displayed legend. Elevation colors may differ between map extents; compare the meter values, "
      "not colors alone.", size=9.4)
    formatters.p(document, "The brief explicitly names origin/return H and the selected Location code. "
      "Technical JSON also retains the full marker key, including X for a custom point.", size=9.4)

    page(document, 7, "Verification and open validation work")
    formatters.table(document, ["Evidence category", "Executed result"], [
        ("Unit / regression", f"{unit_count} PASS: unchanged model tests plus workflow, comparison, provenance, and brief checks."),
        ("Real application integration", f"{len(load('application-model-checks.json')['checks'])} PASS checks using actual terrain, preserving original inputs and verifying the science candidate/evidence association."),
        ("Static deployment", f"{static_count} checks passed for compiled modules, relative paths, and unchanged prepared web inputs."),
        ("Baseline browser evidence", f"{browser_count} recorded 1.1.0 workflow checks are retained as historical evidence, not falsely reported as a full new browser rerun."),
        ("Layer patch checks", f"{layer_count} targeted 1.1.1 checks cover availability/staleness, data-derived colors and legends, thermal resolution, exports, print, mobile, subfolder and unchanged decisions."),
        ("Destination patch checks", f"{destination_count} targeted 1.1.2 checks cover card codes, H/P/A/B/C/X key, custom mapping, accessible names, mobile, exports and unchanged results."),
        ("Parameter-help checks", f"{parameter_count} targeted 1.1.3 checks cover seven definitions, accessible associations, native disclosure, units, examples, mobile and unchanged results."),
        ("Customer-copy checks", f"{copy_count} targeted 1.1.4 checks cover streamlined UI and briefs, preserved methods/source information, accurate outcomes and mobile layout."),
        ("Map-view control checks", f"{map_view_count} targeted 1.1.5 checks cover grouped toggles, synchronized focus, keyboard/pointer, mobile widths, brief images and preserved results."),
        ("Theme checks", f"{theme_count} targeted 1.1.6 checks cover readable light/dark surfaces, contrast, keyboard/mobile, print, static decoration and five unchanged scientific canvases."),
        ("Martian Dawn checks", f"{dawn_count} targeted 1.1.7 checks cover visible desktop/mobile Mars, orange controls, persistent workspace identity, versioned SVG delivery and unchanged scientific outputs."),
        ("Science-context checks", f"{science_count} targeted 1.1.8 checks cover source-backed S, exact marked crops, separate scientific/route reasoning, consistent exports and preserved original cases."),
        ("Positioning checks", f"{len(load('differentiation-checks.json')['checks'])} targeted 1.1.10 checks cover capability cards, fair related-tool context, native disclosure, keyboard/mobile layout, unchanged results and static delivery."),
    ], [2.0, 4.91])
    formatters.p(document, "Development-only fixtures model one unknown response cell, a delayed grid, "
      "and a one-time HTTP 503. They do not edit the source data and are not production features. "
      "Expected validation/fault messages are distinguished from unexplained failures.")
    formatters.heading(document, "Usability pilot: proposed, not performed")
    formatters.table(document, ["Pilot objective", "Proposed target / status"], [
        ("Understand problem and output", "At least 4 of 5 new testers explain them after a 30-second introduction. NOT RUN."),
        ("Complete a plan and comparison", "At least 4 of 5 finish without coaching within 180 seconds. NOT RUN."),
        ("Understand claim boundaries", "All 5 distinguish model fit from physical safety. NOT RUN."),
    ], [2.6, 4.31])
    formatters.p(document, "The workbook includes blank anonymous-code pilot rows and open review items. "
      "No feedback, participants, percentages, scientific sign-off, full accessibility conformance, "
      "or benefit to astronauts is fabricated. Expert review of travel assumptions and science "
      "relevance remains separate.", size=9.4, color=formatters.GRAY)

    page(document, 8, "Hosting and developer handoff")
    formatters.heading(document, "Shared hosting remains static")
    formatters.p(document, "TypeScript is compiled before upload; the browser executes JavaScript and "
      "a Web Worker. No hosting-side Node.js, Python, PHP, database, API key, or external CDN is needed. "
      "HTTP(S) is required; file:// launching is unsupported.")
    formatters.table(document, ["New release file", "Use"], [
        ("HOMEBOUND_Application_Rumahweb_Upload.zip", "Extract contents into an empty document root or isolated subfolder; index.html is directly at the archive root."),
        ("HOMEBOUND_Application_Source.zip", "Source, tests, documentation, evidence, and small prepared web inputs, preserving relative paths; not the hosting upload."),
        ("HOMEBOUND_Application_QA_EN.xlsx", "Feature acceptance, executed tests, fixture scope, preservation, and pending human/science work."),
        ("HOMEBOUND_Application_Deployment_EN.md", "Full upload, HTTPS, MIME type, troubleshooting, and post-upload functional checklist."),
    ], [3.65, 3.26])
    formatters.heading(document, "Local rebuild commands")
    for command in ["npm.cmd ci", "npm.cmd test", "npm.cmd run audit:app", "npm.cmd run build", "npm.cmd run check:delivery", "npm.cmd run preview"]:
        formatters.code(document, command)
    formatters.p(document, "Run from decision-model. The preview helper also has explicitly labeled "
      "development-only QA cases; do not use that helper as production hosting.")
    formatters.p(document, "Old data/model documents, ZIPs, integrity records, and the pre-application "
      "register were preserved as snapshots. The working UI and README intentionally evolved. "
      "The engine remains byte-identical to model 1.0.0. No actual Rumahweb credentials or account "
      "were accessed. Review event eligibility before submission.", size=9.3, color=formatters.GRAY)
    page(document, 9, "Parameter definitions and examples")
    formatters.p(document, "These definitions are taken from the actual application helper text, not a separate set of meanings. The four travel inputs remain in Advanced assumptions.")
    formatters.table(document, ["Parameter", "Units", "Visible definition"], parameter_rows(), [1.65, 0.75, 4.51])
    formatters.heading(document, "What the coefficients mean")
    formatters.p(document, "Coefficients are unitless. A value of 4 is not four minutes or a direct "
      "four-times multiplier. For each permitted step, grade is elevation rise divided by horizontal "
      "distance. The time multiplier is 1 + uphill coefficient x max(grade, 0) + downhill coefficient x max(-grade, 0).")
    formatters.table(document, ["Illustrative grade", "Coefficient", "Multiplier"], [
        ("10% uphill", "4", "1.40"),
        ("10% downhill", "2", "1.20"),
    ], [2.91, 2.0, 2.0])
    formatters.p(document, "This factor multiplies three-dimensional step distance divided by reference "
      "speed. A 10% grade is about 5.71 degrees, not 10 degrees. Larger slope limits permit more "
      "modeled terrain, not safer routes. More reserve leaves less room for observation.")
    formatters.p(document, "Technical detail opens through native details/summary controls. Keyboard and "
      "click paths were checked at a mobile viewport; a real touch-device and full screen-reader audit "
      "were not performed. Values remain adjustable scenario assumptions and the examples explain the existing model.", size=9.4, color=formatters.GRAY)
    page(document, 10, "Science context and Location S")
    record = load("science-selection-evidence.json")
    candidate = record["destination"]
    science = candidate["science"]
    formatters.p(document, science["question"], bold=True, color=formatters.TEAL)
    document.add_picture(str(ROOT / "evidence" / "science-location-s.png"), width=Inches(2.4))
    formatters.p(document, "Marked crop of the prepared HiRISE optical display. S is a separate image-supported candidate; P remains guided practice.", size=9, color=formatters.GRAY)
    formatters.table(document, ["Evidence / use", "Recorded context"], [
        ("Location and window", "S: row 84, column 42. Evidence: rows 54-113, columns 12-71. The 303.5 m-wide crop uses the prepared optical display at about 1.01 m/pixel."),
        ("Observed in imagery", science["observed"]),
        ("Why this location?", science["whyHere"]),
        ("NASA data roles", "MRO HiRISE optical: location-specific image evidence. HiRISE terrain: relief and routing. Mars Odyssey THEMIS: regional qualitative context at native 100 m spacing."),
        ("Nominal plan reference", f"120-minute budget, 20-minute observation and 20-minute reserve at the unchanged preset. S margin: {record['nominalPlan']['time']['marginMinutes']:.2f} min. Route feasibility is recalculated from user inputs."),
    ], [1.65, 5.26])
    formatters.p(document, "Interpretation to investigate: " + science["interpretation"], size=9.4)
    formatters.p(document, "Open Why this location? to inspect the question, task, marked image and references. Review and TXT/JSON/printed briefs retain the same context. Custom points and original examples do not inherit S evidence.", size=9.4)
    formatters.p(document, "Acquisition: " + science["opticalObservationDate"] + ". " + science["observationPageUrl"] +
      " | DTM/ortho reference: " + record["opticalDisplay"]["providerDtmPage"], size=8.5, color=formatters.GRAY)
    page(document, 11, "Regional setting from NASA Mars Trek")
    regional = json.loads((ROOT.parent / "data" / "homebound" / "web" / "regional-context.json").read_text(encoding="utf-8"))
    formatters.p(document, "Open Where is this Marswalk? in Destination to place the detailed study area within Gale Crater. This is a separate regional context map, not a sixth routing layer.")
    document.add_picture(str(ROOT / "evidence" / "regional-context-map.png"), width=Inches(3.0))
    formatters.p(document, "Actual NASA Mars Trek MGS/MOLA relief. The footprint follows the HiRISE study-area coordinates; the larger ring is a visibility aid, not a walking route.", size=9, color=formatters.GRAY)
    formatters.table(document, ["Source / role", "Use in HOMEBOUND"], [
        ("NASA Mars Trek / MGS-MOLA", "Four source tiles from Mars_MGS_MOLA_ClrShade_merge_global_463m. Approximate native product spacing: 463 m. Regional orientation only; no route costs or geological-unit identification."),
        ("Georeferencing and traceability", "The Mars inverse projection agrees with all four original AOI corners within 1e-10 degrees. regional-context.json records map/AOI bounds, original tile URLs/hashes, service metadata, image hash and the spatial-reference hash."),
        ("Offline/static delivery and briefs", "The prepared SVG embeds the NASA JPEG tiles. No live portal/API is required. Printed, TXT and JSON briefs retain the map's regional role and sources; practice/custom points do not inherit S science."),
        ("Unchanged planning examples", "S with 20 / 88 / 85 observation minutes retains +67.60 / -0.40 / +2.60 minute margins. Reserve remains 20 minutes. The deck and video were not changed."),
    ], [1.75, 5.16])
    formatters.p(document, regional["credit"] + " | https://trek.nasa.gov/mars/ | Original NASA mission-derived relief.", size=8.5, color=formatters.GRAY)
    formatters.p(document, f"Regional checks: {len(load('regional-context-data-checks.json')['checks'])} data/model checks rerun for {APPLICATION_VERSION}; "
      f"{len(load('regional-context-browser-checks.json')['checks'])} browser records captured on 1.1.11 retain that historical scope. Current preset checks are on page 12.", size=9)
    page(document, 12, "Choose Science or Terrain exploration")
    formatters.p(document, "In Activities, use Planning preset. Science walkthrough remains the initial default; "
      "choosing a destination never switches presets automatically.")
    document.add_picture(str(ROOT / "evidence" / "planning-preset-controls.png"), width=Inches(4.9))
    formatters.table(document, ["Preset", "Purpose and declared values"], [
        ("Science walkthrough", "120-minute budget / 20-degree slope limit. Retains the P/S examples: S with 20 / 88 / 85 observation minutes still has +67.60 / -0.40 / +2.60 minute margins."),
        ("Terrain exploration", "180-minute budget / 30-degree slope limit. Gives original A/B/C complete modeled routes with their original observation durations. No waypoint is moved."),
    ], [1.75, 5.16])
    formatters.p(document, "Shared values: reserve 20 minutes; reference speed 30 m/min; uphill coefficient 4; "
      "downhill coefficient 2. The 30-degree allowance is a model exploration assumption, not a validated walking limit.", size=9.4)
    examples = {item["id"]: item["plan"] for item in load("planning-preset-examples.json")["examples"]}
    formatters.table(document, ["Destination", "Observation", "Required incl. reserve", "Extra margin"], [
        (identifier, f"{examples['terrain-' + identifier]['mission']['scienceMinutes']:.0f} min",
         f"{examples['terrain-' + identifier]['time']['requiredMinutes']:.2f} min",
         f"+{examples['terrain-' + identifier]['time']['marginMinutes']:.2f} min")
        for identifier in ["A", "B", "C"]
    ], [1.1, 1.3, 2.4, 2.11])
    formatters.p(document, "A preset restores all six budget/reserve/travel inputs but preserves the destination and base "
      "observation duration. Editing those six inputs shows Custom settings unless all values match a named preset; "
      "observation-only edits keep the name. An empty/invalid input stays invalid.", size=9.4)
    formatters.p(document, "Preset changes clear original/revised results, pending replies, downloads and print readiness. "
      "Review again before saving. Review, TXT/printed briefs and JSON identify the preset/custom state from the calculated "
      "assumptions, with every numeric value still explicit.", size=9.4)
    formatters.p(document, f"Current-release preset evidence: {len(load('planning-preset-data-checks.json')['checks'])} data/model checks; "
      f"{len(load('planning-preset-browser-checks.json')['checks'])} fresh Edge checks covering full plans, keyboard/mobile/subfolder, "
      "actual TXT/JSON/PDF, stale replies and visible errors. The current deck, video and submission drafts were preserved.", size=9)
    document.save(GUIDE)


def build(*, replace=False):
    if not replace and (GUIDE.exists() or QA_BOOK.exists()):
        raise FileExistsError("Application documentation exists; use --replace for deliberate regeneration.")
    browser = load("application-browser-checks.json")
    integration = load("application-model-checks.json")
    static = load("application-deployment-checks.json")
    layers = load("layer-ux-checks.json")
    destination_checks = load("destination-ux-checks.json")
    parameter_checks = load("parameter-help-checks.json")
    copy_checks = load("copy-refresh-checks.json")
    map_view_checks = load("map-view-checks.json")
    theme_checks = load("theme-checks.json")
    dawn_checks = load("martian-dawn-checks.json")
    science_checks = load("science-context-checks.json")
    export_checks = load("export-layout-checks.json")
    positioning_checks = load("differentiation-checks.json")
    regional_data = load("regional-context-data-checks.json")
    regional_browser = load("regional-context-browser-checks.json")
    regional_preserved = load("regional-context-preservation.json")
    preset_data = load("planning-preset-data-checks.json")
    preset_browser = load("planning-preset-browser-checks.json")
    preset_preserved = load("planning-preset-preservation.json")
    if any(proof["applicationVersion"] != APPLICATION_VERSION for proof in (integration, static, regional_data, preset_data, preset_browser)):
        raise RuntimeError("Current release evidence does not match the application version; older browser records retain historical scope.")
    preserved = load("application-preserved-inputs.json")
    units = unit_records()
    for group in (browser["checks"], integration["checks"], static["checks"], layers["checks"], destination_checks["checks"], parameter_checks["checks"], copy_checks["checks"], map_view_checks["checks"], theme_checks["checks"], dawn_checks["checks"], science_checks["checks"], export_checks["checks"], positioning_checks["checks"], regional_data["checks"], regional_browser["checks"], preset_data["checks"], preset_browser["checks"]):
        if any(record["status"] != "PASS" for record in group):
            raise RuntimeError("A required application check has not passed.")
    preservation = []
    for relative, expected in preserved.items():
        path = ROOT.parent / relative
        if path.name.startswith("~$"):
            preservation.append({"relativePath": relative, "sha256": "NOT_CHECKED", "status": "TRANSIENT_OFFICE_LOCK_NOT_CHECKED"})
            continue
        if not path.exists() and relative.startswith(("docs\\", "docs/")):
            preservation.append({"relativePath": relative, "sha256": "NOT_CHECKED", "status": "NOT_PRESENT"})
            continue
        actual = digest(path)
        if actual != expected:
            raise RuntimeError(f"A protected release or input changed: {relative}")
        preservation.append({"relativePath": relative, "sha256": actual, "status": "UNCHANGED"})
    for relative, expected in {**regional_preserved["protectedFiles"], **preset_preserved["protectedFiles"]}.items():
        actual = digest(ROOT.parent / relative)
        if actual != expected:
            raise RuntimeError(f"A protected model or prepared input changed: {relative}")
        if not any(item["relativePath"] == relative for item in preservation):
            preservation.append({"relativePath": relative, "sha256": actual, "status": "UNCHANGED"})
    features = [
        {"id": "F01", "feature": "Problem-led introduction", "technicalEvidence": "A01", "implementationStatus": "IMPLEMENTED", "humanValidation": "PENDING"},
        {"id": "F02", "feature": "Four-step guided workflow", "technicalEvidence": "A02/A03/A25", "implementationStatus": "IMPLEMENTED", "humanValidation": "PENDING"},
        {"id": "F03", "feature": "Transparent hypothetical and original scenarios", "technicalEvidence": "A02/A11; integration audit", "implementationStatus": "IMPLEMENTED", "humanValidation": "SCIENCE_REVIEW_PENDING"},
        {"id": "F04", "feature": "Advanced travel assumptions remain visible/editable", "technicalEvidence": "A19", "implementationStatus": "IMPLEMENTED", "humanValidation": "PARAMETER_CALIBRATION_PENDING"},
        {"id": "F05", "feature": "Original/revised comparison and restoration", "technicalEvidence": "A05/A06/A07", "implementationStatus": "IMPLEMENTED", "humanValidation": "PENDING"},
        {"id": "F06", "feature": "Unavailable data/route results without fabricated times", "technicalEvidence": "A11/A12/A13", "implementationStatus": "IMPLEMENTED", "humanValidation": "PENDING"},
        {"id": "F07", "feature": "Text/JSON brief and print layout", "technicalEvidence": "A22/A23", "implementationStatus": "IMPLEMENTED", "humanValidation": "NATIVE_SAVE_DIALOG_CHECK_PENDING"},
        {"id": "F08", "feature": "Five map layers and framing", "technicalEvidence": "A16", "implementationStatus": "IMPLEMENTED", "humanValidation": "PENDING"},
        {"id": "F09", "feature": "Stale and late-response protection", "technicalEvidence": "A08/A09/A10", "implementationStatus": "IMPLEMENTED", "humanValidation": "PENDING"},
        {"id": "F10", "feature": "Keyboard and mobile paths", "technicalEvidence": "A17/A20/A21/A25", "implementationStatus": "IMPLEMENTED", "humanValidation": "FULL_ACCESSIBILITY_AUDIT_PENDING"},
        {"id": "F11", "feature": "Static root/subfolder deployment", "technicalEvidence": "A24; static checks", "implementationStatus": "IMPLEMENTED", "humanValidation": "ACTUAL_HOSTING_CHECK_PENDING"},
        {"id": "F12", "feature": "Traceable data and assumptions", "technicalEvidence": "A15/A22", "implementationStatus": "IMPLEMENTED", "humanValidation": "SCIENCE_REVIEW_PENDING"},
        {"id": "F13", "feature": "Explicit picking and coordinate alternative", "technicalEvidence": "A17/A18", "implementationStatus": "IMPLEMENTED", "humanValidation": "PENDING"},
        {"id": "F14", "feature": "Initial loading error and retry", "technicalEvidence": "A26", "implementationStatus": "IMPLEMENTED", "humanValidation": "PENDING"},
        {"id": "F15", "feature": "Previous release and engine preservation", "technicalEvidence": "Preservation sheet; required inputs always verified; absent historical snapshots are not checked", "implementationStatus": "VERIFIED" if all(item["status"] == "UNCHANGED" for item in preservation) else "HISTORICAL_SNAPSHOTS_PARTLY_ABSENT", "humanValidation": "NOT_A_SAFETY_APPROVAL"},
        {"id": "F16", "feature": "Explicit pending/stale overlay messages", "technicalEvidence": "L01/L02/L03", "implementationStatus": "IMPLEMENTED", "humanValidation": "PENDING"},
        {"id": "F17", "feature": "Numeric elevation colors and visible-view meter legend", "technicalEvidence": "L05/L06/L07", "implementationStatus": "IMPLEMENTED", "humanValidation": "PENDING"},
        {"id": "F18", "feature": "Thermal DN legend and native-resolution explanation", "technicalEvidence": "L08", "implementationStatus": "IMPLEMENTED", "humanValidation": "THERMAL_CALIBRATION_NOT_ASSERTED"},
        {"id": "F19", "feature": "Explicit destination codes and matching map key", "technicalEvidence": "D01/D02/D03", "implementationStatus": "IMPLEMENTED", "humanValidation": "PENDING"},
        {"id": "F20", "feature": "Origin H and custom X clearly distinguished", "technicalEvidence": "D04/D08/D09", "implementationStatus": "IMPLEMENTED", "humanValidation": "PENDING"},
        {"id": "F21", "feature": "Visible accessible definitions for seven parameters", "technicalEvidence": "P01/P02/P03", "implementationStatus": "IMPLEMENTED", "humanValidation": "FULL_ASSISTIVE_TECHNOLOGY_AUDIT_PENDING"},
        {"id": "F22", "feature": "Expandable unitless-coefficient examples", "technicalEvidence": "P04/P05/P06/P07", "implementationStatus": "IMPLEMENTED", "humanValidation": "REAL_TOUCH_DEVICE_CHECK_PENDING"},
        {"id": "F23", "feature": "Positive method-focused UI and mission briefs", "technicalEvidence": "C01-C08", "implementationStatus": "IMPLEMENTED", "humanValidation": "PENDING"},
        {"id": "F24", "feature": "Synchronized segmented map-view controls", "technicalEvidence": "V01-V10; viewport unit tests", "implementationStatus": "IMPLEMENTED", "humanValidation": "FULL_ASSISTIVE_TECHNOLOGY_AUDIT_PENDING"},
        {"id": "F25", "feature": "Readable hybrid space theme with preserved scientific colors", "technicalEvidence": "S01-S12; theme unit tests; recorded canvas hashes", "implementationStatus": "IMPLEMENTED", "humanValidation": "FULL_ACCESSIBILITY_AUDIT_PENDING"},
        {"id": "F26", "feature": "Visible Mars illustration and consistent Martian Dawn controls", "technicalEvidence": "MD01-MD12; design/asset unit tests", "implementationStatus": "IMPLEMENTED", "humanValidation": "FULL_ACCESSIBILITY_AUDIT_PENDING"},
        {"id": "F27", "feature": "Image-supported science candidate S and question", "technicalEvidence": "SC01-SC09; science-selection-evidence.json", "implementationStatus": "IMPLEMENTED", "humanValidation": "EXPERT_INTERPRETATION_PENDING"},
        {"id": "F28", "feature": "Exact evidence crop and cross-output science provenance", "technicalEvidence": "SC03/SC04/SC10-SC14; science-context unit tests", "implementationStatus": "IMPLEMENTED", "humanValidation": "FULL_ACCESSIBILITY_AUDIT_PENDING"},
        {"id": "F29", "feature": "Aligned full-width export controls", "technicalEvidence": "EX01-EX06; export-layout unit tests", "implementationStatus": "IMPLEMENTED", "humanValidation": "NATIVE_SAVE_DIALOG_CHECK_PENDING"},
        {"id": "F30", "feature": "Focused capability positioning and fair related-tool context", "technicalEvidence": "POS01-POS07; differentiation unit tests", "implementationStatus": "IMPLEMENTED", "humanValidation": "PENDING"},
        {"id": "F31", "feature": "Georeferenced Gale Crater regional setting from NASA Mars Trek", "technicalEvidence": "RegionalContext sheet; original WMTS tiles/receipts; exact baseline plan comparison", "implementationStatus": "IMPLEMENTED", "humanValidation": "REGIONAL_ORIENTATION_ONLY"},
        {"id": "F32", "feature": "Explicit Science/Terrain presets, Custom matching and calculated-plan export identity", "technicalEvidence": "PlanningPresets sheet; PD01-PD08/PB01-PB11; actual S/A/B/C plans, native exports and delayed replies", "implementationStatus": "IMPLEMENTED", "humanValidation": "TRAVEL_ASSUMPTIONS_NOT_CALIBRATED"},
    ]
    pilot = [
        {"anonymousTesterCode": f"U{number:02d}", "studyStatus": "NOT_RUN",
         "problemAndOutputUnderstood": "", "planAndComparisonCompleted": "", "completionSeconds": "",
         "reserveVsMarginExplained": "", "modelFitNotSafetyUnderstood": "", "anonymousNotes": ""}
        for number in range(1, 6)
    ]
    open_items = [
        {"item": "Human usability pilot", "status": "NOT_PERFORMED", "neededEvidence": "Actual anonymous observations; targets are proposals, not achieved percentages."},
        {"item": "Scientific interpretation and site value", "status": "IMAGE_SUPPORTED_EXPERT_REVIEW_PENDING", "neededEvidence": "S now has a source-backed question, exact marked crop and measured terrain context; geological origin/composition and field value remain to investigate. P and A/B/C retain their separate roles."},
        {"item": "Astronaut travel assumptions", "status": "NOT_CALIBRATED", "neededEvidence": "Relevant empirical or expert justification for speed, slope and coefficients."},
        {"item": "Physical/operational safety", "status": "NOT_CERTIFIED", "neededEvidence": "Outside the prototype's time-only claim."},
        {"item": "Accessibility conformance", "status": "FULL_AUDIT_NOT_PERFORMED", "neededEvidence": "Keyboard/mobile paths checked; formal assistive-technology and contrast audit separate."},
        {"item": "Native PDF/download dialogs", "status": "POST_UPLOAD_CHECK", "neededEvidence": "Normal browser save behavior; Blob payload and print CSS already verified."},
        {"item": "Current-release Rumahweb hosting", "status": "RELEASE_UPLOAD_PENDING", "neededEvidence": "Public 1.1.11 was previously verified. Upload 1.1.12 and check initial Science, explicit Terrain A/B/C, Custom/export/stale behavior, unchanged S examples and regional sources."},
        {"item": "Competition eligibility and final submission", "status": "NOT_ASSERTED", "neededEvidence": "Organizer confirmation for pre-event work and current submission requirements."},
    ]
    book = Workbook()
    book.remove(book.active)
    formatters.excel_sheet(book, "ReadMe", [
        {"item": "Application/model", "value": f"{APPLICATION_VERSION} / unchanged 1.0.0"},
        {"item": "Scenario policy", "value": "Science 20 degrees/120 min remains initial default. Terrain 30 degrees/180 min is explicit, never destination-triggered. Original H/P/S/A/B/C coordinates, observation defaults and protected reserve are unchanged."},
        {"item": "Technical counts", "value": f"{len(units)} unit; {len(integration['checks'])} integration; {len(static['checks'])} static; {len(layers['checks'])} layer-patch checks; {len(browser['checks'])} historical browser checks from 1.1.0."},
        {"item": "Destination patch", "value": f"{len(destination_checks['checks'])} targeted 1.1.2 checks; 1.1.1 layer evidence remains explicitly historical."},
        {"item": "Parameter-help patch", "value": f"{len(parameter_checks['checks'])} targeted 1.1.3 checks; earlier browser/UX checks retain their original release scope."},
        {"item": "Customer-copy refresh", "value": f"{len(copy_checks['checks'])} targeted 1.1.4 checks; presentation changed while raw model/data and technical provenance are retained."},
        {"item": "Map-view refresh", "value": f"{len(map_view_checks['checks'])} targeted 1.1.5 checks; grouped native toggle buttons follow actual viewport operations without changing the model."},
        {"item": "Hybrid space theme", "value": f"{len(theme_checks['checks'])} targeted 1.1.6 checks; static CSS decoration, opaque light workspace and exact five-layer canvas preservation."},
        {"item": "Martian Dawn redesign", "value": f"{len(dawn_checks['checks'])} targeted 1.1.7 checks; orange actions, visible mobile/desktop illustration, persistent mini-Mars and versioned local SVG."},
        {"item": "Science context", "value": f"{len(science_checks['checks'])} targeted 1.1.8 checks; new S preserves original coordinates/preset, records optical evidence and separates science rationale from route feasibility."},
        {"item": "Export layout", "value": f"{len(export_checks['checks'])} targeted 1.1.9 checks; full-width controls, shared dimensions/typography, keyboard order, payloads, print and stale-state behavior."},
        {"item": "Workflow positioning", "value": f"{len(positioning_checks['checks'])} targeted 1.1.10 checks; three capability cards, fair official related-tool references, native disclosure and unchanged planning results. Comparative user-performance advantage was not measured."},
        {"item": "Regional setting", "value": f"{len(regional_data['checks'])} data/model checks rerun for {APPLICATION_VERSION}; {len(regional_browser['checks'])} historical browser checks from 1.1.11. Actual Mars Trek tiles, exact georeferenced AOI, local image, provenance and nine unchanged Science plans."},
        {"item": "Planning presets", "value": f"{len(preset_data['checks'])} data/model and {len(preset_browser['checks'])} fresh {APPLICATION_VERSION} Edge checks; unchanged S 20/88/85, Terrain A/B/C, all six inputs, Custom/X, actual TXT/JSON/PDF, keyboard/mobile/subfolder, stale replies and visible errors."},
        {"item": "Human usability", "value": "NOT PERFORMED. Pilot sheet is blank, anonymous, and explicitly NOT_RUN."},
        {"item": "Scientific/operational claims", "value": "No calibrated astronaut performance, verified site value, or certified safe route."},
        {"item": "Browser methods", "value": browser["method"]},
    ])
    formatters.excel_sheet(book, "Features", features)
    formatters.excel_sheet(book, "UnitTests", units)
    formatters.excel_sheet(book, "BrowserChecks", browser["checks"])
    formatters.excel_sheet(book, "LayerUX", layers["checks"])
    formatters.excel_sheet(book, "DestinationUX", destination_checks["checks"])
    formatters.excel_sheet(book, "ParameterHelp", parameter_checks["checks"])
    formatters.excel_sheet(book, "CopyUX", copy_checks["checks"])
    formatters.excel_sheet(book, "MapViewUX", map_view_checks["checks"])
    formatters.excel_sheet(book, "ThemeUX", theme_checks["checks"])
    formatters.excel_sheet(book, "MartianDawn", dawn_checks["checks"])
    formatters.excel_sheet(book, "ScienceContext", science_checks["checks"])
    formatters.excel_sheet(book, "ExportLayout", export_checks["checks"])
    formatters.excel_sheet(book, "PositioningUX", positioning_checks["checks"])
    formatters.excel_sheet(book, "RegionalContext",
        [{**item, "applicationVersion": proof["applicationVersion"]} for proof in [regional_data, regional_browser] for item in proof["checks"]])
    formatters.excel_sheet(book, "PlanningPresets", preset_data["checks"] + preset_browser["checks"])
    formatters.excel_sheet(book, "Integration", integration["checks"])
    formatters.excel_sheet(book, "StaticChecks", static["checks"])
    formatters.excel_sheet(book, "UsabilityPilot", pilot)
    formatters.excel_sheet(book, "OpenItems", open_items)
    formatters.excel_sheet(book, "Preservation", preservation)
    book.properties.title = f"HOMEBOUND {APPLICATION_VERSION}: Application Acceptance and QA"
    book.properties.creator = ""
    book.save(QA_BOOK)
    guide(len(units), len(browser["checks"]), len(static["checks"]), len(layers["checks"]), len(destination_checks["checks"]), len(parameter_checks["checks"]), len(copy_checks["checks"]), len(map_view_checks["checks"]), len(theme_checks["checks"]), len(dawn_checks["checks"]), len(science_checks["checks"]))
    with ZipFile(GUIDE) as archive:
        if archive.testzip() is not None:
            raise RuntimeError("Word document package failed integrity validation.")
    reopened = load_workbook(QA_BOOK, read_only=False, data_only=False)
    if len(reopened.sheetnames) != 21 or reopened["UnitTests"].max_row != len(units) + 1 or reopened["UsabilityPilot"].max_row != 6 or reopened["RegionalContext"].max_row != len(regional_data["checks"]) + len(regional_browser["checks"]) + 1 or reopened["PlanningPresets"].max_row != len(preset_data["checks"]) + len(preset_browser["checks"]) + 1:
        raise RuntimeError("Application workbook shape does not match executed evidence.")
    if any(cell.data_type == "f" for sheet in reopened for row in sheet for cell in row):
        raise RuntimeError("Unexpected formula in an evidence workbook.")
    reopened.close()
    with (ROOT / "evidence" / "application-unit-catalog.csv").open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(units[0]))
        writer.writeheader(); writer.writerows(units)
    print(f"Created: {GUIDE}")
    print(f"Created: {QA_BOOK} ({len(book.sheetnames)} sheets; {len(units)} unit and {len(preset_data['checks']) + len(preset_browser['checks'])} current preset records; older browser evidence retains historical scope)")


def render(directory: Path):
    import pythoncom
    import pymupdf
    from win32com.client import DispatchEx

    directory.mkdir(parents=True, exist_ok=True)
    output = directory / "HOMEBOUND_Application_Guide_layout.pdf"
    pythoncom.CoInitialize()
    word = None; current = None; owned_empty = False
    try:
        word = DispatchEx("Word.Application")
        if word.Documents.Count:
            raise RuntimeError("Existing user Word documents detected; stopping.")
        owned_empty = True; word.Visible = False; word.DisplayAlerts = 0
        current = word.Documents.Open(FileName=str(GUIDE), ConfirmConversions=False, ReadOnly=True, AddToRecentFiles=False, Visible=False)
        current.Repaginate()
        print(f"Word-rendered pages: {current.ComputeStatistics(2)}")
        current.ExportAsFixedFormat(str(output), 17)
    finally:
        if current is not None: current.Close(SaveChanges=0)
        if word is not None and owned_empty and word.Documents.Count == 0: word.Quit(SaveChanges=0)
        pythoncom.CoUninitialize()
    titles = ["HOMEBOUND Application Guide", "Get started in four steps", "Choose a point and declare assumptions",
              "Review decisions and compare activities", "Readable map layers and availability", "Save and interpret a mission brief",
              "Verification and open validation work", "Hosting and developer handoff", "Parameter definitions and examples", "Science context and Location S",
              "Regional setting from NASA Mars Trek", "Choose Science or Terrain exploration"]
    with pymupdf.open(output) as pdf:
        for index, item in enumerate(pdf):
            text = re.sub(r"\s+", " ", item.get_text())
            print(f"Page {index+1}: {len(text.split())} words | {text[:115]}")
            item.get_pixmap(matrix=pymupdf.Matrix(1.2, 1.2), alpha=False).save(directory / f"application_guide_{index+1}.png")
        if len(pdf) != 12:
            raise RuntimeError(f"Expected twelve application-guide pages; found {len(pdf)}.")
        for item, title in zip(pdf, titles):
            if title not in re.sub(r"\s+", " ", item.get_text()):
                raise RuntimeError(f"Section moved off intended page: {title}")
    print("Application Word rendering and section checks passed.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Build English application guidance and QA records without fabricating human studies.")
    parser.add_argument("--replace", action="store_true")
    parser.add_argument("--render-dir", type=Path)
    args = parser.parse_args()
    build(replace=args.replace)
    if args.render_dir is not None: render(args.render_dir)
