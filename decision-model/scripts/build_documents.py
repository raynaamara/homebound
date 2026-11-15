from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import re
from pathlib import Path
from zipfile import ZipFile

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.worksheet.table import Table, TableStyleInfo

ROOT = Path(__file__).resolve().parents[1]
WORKSPACE = ROOT.parent
DOCS = WORKSPACE / "docs"
REPORT = DOCS / "HOMEBOUND_Decision_Model_Report_EN.docx"
WORKBOOK = DOCS / "HOMEBOUND_Decision_Model_Results_EN.xlsx"
NAVY = "17324D"
TEAL = "007C83"
GRAY = "526372"


def load(name: str):
    return json.loads((ROOT / "evidence" / name).read_text(encoding="utf-8"))


def text_value(value) -> str:
    if value is None:
        return "Not evaluable"
    if isinstance(value, (dict, list, tuple)):
        return json.dumps(value, ensure_ascii=True)
    if isinstance(value, bool):
        return "Yes" if value else "No"
    return str(value)


def p(document, text: str, *, style=None, bold=None, size=None, color=None):
    item = document.add_paragraph(style=style)
    run = item.add_run(text)
    run.bold = bold
    if size:
        run.font.size = Pt(size)
    if color:
        run.font.color.rgb = RGBColor.from_string(color)
    return item


def heading(document, text: str):
    return p(document, text, style="Heading 2")


def page(document, number: int, title: str):
    if number > 1:
        document.add_page_break()
    p(document, f"{number:02d} / DECISION MODEL IMPLEMENTATION RECORD", bold=True, size=9, color=TEAL)
    p(document, title, style="Heading 1")


def table(document, headers: list[str], rows: list, widths: list[float]):
    result = document.add_table(rows=1, cols=len(headers))
    result.autofit = False
    for column, width in zip(result.columns, widths):
        column.width = Inches(width)
    for index, value in enumerate(headers):
        result.rows[0].cells[index].text = value
    repeat = OxmlElement("w:tblHeader")
    result.rows[0]._tr.get_or_add_trPr().append(repeat)
    for values in rows:
        cells = result.add_row().cells
        for index, value in enumerate(values):
            cells[index].text = text_value(value)
    for row_index, row in enumerate(result.rows):
        node = OxmlElement("w:cantSplit")
        row._tr.get_or_add_trPr().append(node)
        for column_index, cell in enumerate(row.cells):
            cell.width = Inches(widths[column_index])
            properties = cell._tc.get_or_add_tcPr()
            shading = OxmlElement("w:shd")
            shading.set(qn("w:fill"), NAVY if row_index == 0 else ("F1F6F8" if row_index % 2 else "FFFFFF"))
            properties.append(shading)
            margins = OxmlElement("w:tcMar")
            for name, value in (("top", 65), ("left", 90), ("bottom", 65), ("right", 90)):
                edge = OxmlElement(f"w:{name}")
                edge.set(qn("w:w"), str(value))
                edge.set(qn("w:type"), "dxa")
                margins.append(edge)
            properties.append(margins)
            for item in cell.paragraphs:
                item.paragraph_format.space_after = Pt(2)
                item.paragraph_format.line_spacing = 1.02
                for run in item.runs:
                    run.font.size = Pt(9.2)
                    if row_index == 0:
                        run.bold = True
                        run.font.color.rgb = RGBColor(255, 255, 255)
    p(document, "", size=2).paragraph_format.space_after = Pt(0)
    return result


def code(document, text: str):
    item = p(document, text, size=8.5)
    item.paragraph_format.space_after = Pt(4)
    for run in item.runs:
        run.font.name = "Consolas"
    return item


def setup():
    document = Document()
    section = document.sections[0]
    section.page_width = Inches(8.27)
    section.page_height = Inches(11.69)
    section.top_margin = Inches(0.65)
    section.bottom_margin = Inches(0.62)
    section.left_margin = Inches(0.68)
    section.right_margin = Inches(0.68)
    section.header_distance = Inches(0.25)
    section.footer_distance = Inches(0.25)
    style = document.styles["Normal"]
    style.font.name = "Calibri"
    style.font.size = Pt(10.5)
    style.font.color.rgb = RGBColor.from_string(NAVY)
    style.paragraph_format.line_spacing = 1.04
    style.paragraph_format.space_after = Pt(5)
    language = OxmlElement("w:lang")
    language.set(qn("w:val"), "en-US")
    style.element.get_or_add_rPr().append(language)
    for name, size in (("Heading 1", 22), ("Heading 2", 12)):
        current = document.styles[name]
        current.font.name = "Calibri"
        current.font.size = Pt(size)
        current.font.bold = True
        current.font.color.rgb = RGBColor.from_string(NAVY)
        current.paragraph_format.keep_with_next = True
        current.paragraph_format.space_before = Pt(0 if name == "Heading 1" else 7)
        current.paragraph_format.space_after = Pt(8 if name == "Heading 1" else 4)
    document.styles["List Bullet"].paragraph_format.space_after = Pt(3)
    header = section.header.paragraphs[0]
    header.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    run = header.add_run("HOMEBOUND  |  DECISION MODEL & STATIC DEPLOYMENT")
    run.font.size = Pt(8)
    run.font.color.rgb = RGBColor.from_string(GRAY)
    footer = section.footer.paragraphs[0]
    footer.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    run = footer.add_run("Research prototype  |  No physical safety validation  |  Page ")
    run.font.size = Pt(8)
    field = OxmlElement("w:fldSimple")
    field.set(qn("w:instr"), "PAGE")
    footer._p.append(field)
    document.core_properties.title = "HOMEBOUND Decision Model: Implementation, Validation, and Hosting"
    document.core_properties.author = ""
    return document


def decision_excerpt() -> Path:
    import pymupdf

    original = ROOT / "evidence" / "browser-decision.png"
    output = ROOT / "evidence" / "browser-decision-excerpt.png"
    with pymupdf.open(original) as image:
        width = image[0].rect.width
        image_width = pymupdf.Pixmap(original).width
        content_width = min(image_width, 592)
        with pymupdf.open("pdf", image.convert_to_pdf()) as pdf:
            page = pdf[0]
            scale = image_width / page.rect.width
            clip = pymupdf.Rect(0, 0, page.rect.width * content_width / image_width, page.rect.height)
            page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), clip=clip, alpha=False).save(output)
    if width <= 0:
        raise RuntimeError("The browser evidence image has no valid extent.")
    return output


def make_report(audit: dict, browser: dict, deployment: dict, units: list[dict]):
    document = setup()
    page(document, 1, "Decision Model Implementation Report")
    p(document, "HOMEBOUND | Model version 1.0.0 | English technical and handoff brief", bold=True, color=TEAL, size=11)
    p(document, "Real-terrain audit UTC: " + audit["executedUtc"], color=GRAY, size=9)
    heading(document, "What was built")
    p(document, "A deterministic, time-only decision engine in TypeScript, compiled to browser "
      "JavaScript. It combines a constrained terrain graph, directional travel-time heuristics, "
      "two Dijkstra searches, and explicit mission-budget rules. It is not machine learning and "
      "does not infer astronaut physiology from orbital imagery.")
    table(document, ["Component", "Delivered capability"], [
        ("Pure model library", "Validated grid and parameters; route costs; outbound/return paths; time accounting; science allowance; explicit unavailable states."),
        ("Static demonstration", "An English browser application with a Web Worker, inspectable inputs, map layers, route display, stale-result clearing, and JSON export."),
        ("Shared-hosting build", "HTML, CSS, compiled JavaScript, JSON, and images. No Node.js/Python/PHP backend, database, external CDN, or API key."),
        ("Executed evidence", f"{len(units)} unit tests; {len(audit['validations'])} real-data audit checks; "
         f"{len(audit['sensitivity'])} sensitivity records; {len(deployment['checks'])} static checks; "
         f"{len(browser['checks'])} recorded integrated-browser checks."),
    ], [1.65, 5.26])
    heading(document, "Important finding: do not hide disconnected targets")
    p(document, "At the unchanged user-approved nominal preset, original scenario targets A, B, and C "
      "have no modeled round trip from H. The engine reports this explicitly instead of inventing "
      "travel times, moving endpoints, or automatically loosening the slope limit.")
    heading(document, "Claim boundary")
    p(document, "Pre-event research/prototype only. No competition eligibility, NASA endorsement, "
      "physical walkability, validated scientific priority, astronaut speed, operational return "
      "safety, or real hosting-account deployment is asserted.")

    page(document, 2, "Graph rules and travel-time model")
    table(document, ["Illustrative parameter", "Nominal value / meaning"], [
        ("Flat reference speed", "30 m/min; an assumption, not calibrated astronaut performance."),
        ("Maximum slope", "20 degrees; applied to both maximum native slope per cell and absolute step grade."),
        ("Directional coefficients", "Uphill 4; downhill 2. Nonnegative coefficients are part of the stated heuristic."),
        ("Mission / reserve", "120 / 20 minutes in the source scenario; neither is a NASA operating requirement."),
    ], [2.05, 4.86])
    heading(document, "Permitted graph")
    p(document, "Each known grid cell is a node. Eight-neighbor steps are considered only when both "
      "endpoints satisfy the current data/slope/exclusion rules. A diagonal requires both "
      "orthogonal two-step corridors to be permitted, including edge-grade checks. Unknown or "
      "excluded cells cannot be bypassed by corner cutting.")
    heading(document, "Metric, directional edge cost")
    code(document, "grade = elevation_rise / horizontal_distance\n"
         "surface_distance = sqrt(horizontal_distance^2 + elevation_rise^2)\n"
         "edge_minutes = surface_distance / base_speed\n"
         "  * (1 + uphill_coefficient * max(grade, 0)\n"
         "       + downhill_coefficient * max(-grade, 0))")
    p(document, "Horizontal distance uses the prepared local Mars metric affine; it is not an Earth "
      "latitude/longitude calculation. Positive finite edge costs are required. The formula is a "
      "transparent surrogate, not validated biomechanics or a life-support consumption model.")
    heading(document, "Two searches, not a mirrored time assumption")
    p(document, "Dijkstra from H computes outbound times. A second search on the reversed directed "
      "graph computes times back to H, using the original neighbor-to-current cost. Outbound "
      "and return paths are reconstructed independently. Equal paths do not imply equal times.")
    p(document, "Mean elevation and maximum native slope are coarse-grid representations. "
      "The restrictive rules can exclude physically possible routes, and they cannot detect "
      "all sub-grid hazards. No safe slope standard is implied.", size=9.5, color=GRAY)

    page(document, 3, "Decision rules, inputs, and outputs")
    code(document, "required = outbound + science + return + reserve\n"
         "margin = mission_budget - required\n"
         "max_science = mission_budget - outbound - return - reserve\n"
         "latest_return_departure = mission_budget - return - reserve")
    p(document, "Latest return departure is minutes after the start of a pre-departure plan, "
      "not a live instruction to an astronaut. Reserve is never silently removed. A negative "
      "science allowance is retained rather than misleadingly clamped to zero.")
    table(document, ["Input", "Contract"], [
        ("Terrain grid", "Prepared schema 1.0; row-major arrays; metric, north-up unrotated Mars affine; elevation, maximum slope, known mask; original source data unchanged."),
        ("Location / travel", "Zero-based integer origin/destination; positive finite speed; slope >= 0 and < 90; finite nonnegative penalties. Optional explicitly blocked cells are supported by the library."),
        ("Mission", "Finite nonnegative budget, science duration, and reserve. Reserve may exceed budget and then produce an infeasible result, not an automatic cap."),
    ], [1.60, 5.31])
    table(document, ["Result / error", "Meaning"], [
        ("FEASIBLE", "A complete round trip fits this time model and retains reserve; never a safety certification."),
        ("TIME_BUDGET_EXCEEDED", "Routes exist, but required time exceeds budget."),
        ("INSUFFICIENT_DATA", "Origin or destination lacks required data; routes and time are null."),
        ("NO_MODELED_ROUTE", "Endpoint excluded or no known permitted complete round trip; routes/time null, not zero."),
        ("INVALID_INPUT / NUMERIC_RANGE", "The library throws an explicit ModelInputError; the worker returns an error envelope, not a successful plan."),
    ], [2.20, 4.71])
    p(document, "Outputs retain full route-cell indices, distance, ascent/descent, directional "
      "minutes, parameters, mission values, reason codes, explanation, margin, and claim boundary. "
      "Opportunity-field non-evaluable samples serialize as JSON null.", size=9.5)
    p(document, "A 1e-9-minute zero tolerance handles numerical boundary arithmetic only; raw margin "
      "is retained. A one-million-cell browser resource guard and support for unrotated grids "
      "are explicit implementation limits, not scientific thresholds.", size=9.2, color=GRAY)

    page(document, 4, "Actual nominal-data results")
    statistics = audit["nominalStatistics"]
    table(document, ["Actual metric", "Observed"], [
        ("Grid cells / known inputs", f"{statistics['totalCells']:,} / {statistics['knownCells']:,}"),
        ("Node-level permitted cells", f"{statistics['permittedCells']:,}; this is not physical traversability."),
        ("Origin-connected cells", f"{statistics['outboundReached']:,} outbound and {statistics['returnReached']:,} return."),
        ("Original A / B / C", "NO_MODELED_ROUTE / NO_MODELED_ROUTE / NO_MODELED_ROUTE at nominal 20 degrees."),
        ("Search / field runtime", f"{audit['nominalBuildMilliseconds']:.2f} / {audit['fieldUpdateMilliseconds']:.2f} ms on the recorded local Node runtime; no cross-device guarantee."),
    ], [2.20, 4.71])
    witness = audit["connectedCellWitness"]
    time = witness["result"]["time"]
    heading(document, "Separate connected-cell integration witness")
    p(document, f"Row {witness['cell']['row']}, column {witness['cell']['column']} was selected "
      "deterministically as the farthest grid-distance cell in the nominal connected component. "
      "It is a numerical test witness, not a new recommended science site. H/A/B/C were not moved.")
    table(document, ["Time component", "Observed model value"], [
        ("Outbound / return", f"{time['outboundMinutes']:.6f} / {time['returnMinutes']:.6f} min"),
        ("Science / reserve / budget", "20 / 20 / 120 min, all illustrative assumptions."),
        ("Required / extra margin", f"{time['requiredMinutes']:.6f} / {time['marginMinutes']:.6f} min"),
        ("Maximum science / latest departure", f"{time['maxScienceMinutes']:.6f} min / mission minute {time['latestReturnDepartureMinute']:.6f}"),
        ("Extra-task audit", "Set total science to maxScience + 1: required 121 min, margin -1 min, TIME_BUDGET_EXCEEDED."),
    ], [2.20, 4.71])
    p(document, "Browser demonstration: adding 63 extra minutes to the 20-minute activity gives "
      "approximately -1.083001 minutes margin. These values come from the implemented heuristic "
      "on actual prepared terrain, not measured astronaut journeys.", size=9.5, color=GRAY)

    page(document, 5, "Sensitivity, interpretation, and next decisions")
    sensitivity_rows = []
    for slope in (10, 15, 20, 25, 30, 40):
        records = [row for row in audit["sensitivity"] if row["experiment"] == "slope" and row["maximumSlopeDegrees"] == slope]
        cells = []
        for row in records:
            cells.append("No route" if row["marginMinutes"] is None else f"{row['marginMinutes']:+.3f} min")
        sensitivity_rows.append((f"{slope} degrees", f"{records[0]['reachedCells']:,}", *cells))
    table(document, ["Slope limit", "Connected", "A margin", "B margin", "C margin"], sensitivity_rows, [1.12, 1.00, 1.59, 1.60, 1.60])
    p(document, "A numeric margin means a route exists: positive fits the time model, negative "
      "exceeds the time budget. No route means no evaluated round trip at that setting. "
      "The original site durations remain A=20, B=25, C=30 minutes.", size=9.5)
    heading(document, "What this proves")
    p(document, "The model responds to parameter changes and exposes the consequences. At 25 degrees "
      "A becomes connected. At 30 degrees B/C also connect but exceed the budget. This does not "
      "validate 25, 30, or 40 degrees as acceptable EVA limits.")
    heading(document, "Other executed sensitivity dimensions")
    p(document, "The workbook records 36 target experiments: six slope limits x three targets, "
      "three speeds x three targets, and three reserves x three targets. Speed/reserve changes "
      "do not repair the nominal targets' topological disconnection. A connected-cell witness "
      "separately verifies speed monotonicity and additional-task failure.")
    heading(document, "Decisions still needed")
    for item in (
        "Obtain evidence or expert review for travel parameters and terrain rules.",
        "Independently decide whether a different AOI or revised hypothetical sites are needed for a meaningful nominal science demonstration.",
        "Assess uncertainty, coarse-grid effects, unresolved physical obstacles, and actual scientific relevance before making stronger claims.",
        "Do not loosen constraints merely to make a demonstration turn green.",
    ):
        p(document, item, style="List Bullet")

    page(document, 6, "Verification and browser behavior")
    table(document, ["Evidence", "Executed result"], [
        ("Unit / analytical tests", f"{len(units)} PASS: validation, missing data, corner rules, directionality, time boundaries, monotonicity, deterministic ties, and an independent Floyd-Warshall shortest-path oracle."),
        ("Real-terrain audit", f"{len(audit['validations'])} PASS checks: route re-summing where available, exact time boundaries, connected witness, and field/connectivity monotonicity."),
        ("Static / integrated browser", f"{len(deployment['checks'])} static checks; {len(browser['checks'])} recorded browser checks, including root/subfolder URLs, worker error responses, cache reuse, stale clearing, and 390-pixel mobile layout."),
    ], [1.85, 5.06])
    p(document, "The actual export Blob was read and its JSON/geometry/route contract verified. "
      "The integrated browser did not expose a native download event, so OS-level saving remains "
      "a normal-browser post-upload check. The production CSP was not weakened.", size=9.5)
    document.add_picture(str(decision_excerpt()), width=Inches(6.75))
    p(document, "Actual browser decision excerpt for the connected-cell integration witness. FEASIBLE means "
      "only that the declared time constraints are met. The expected invalid-input test logs an "
      "explicit worker error; it is not an unexplained application failure.", size=9, color=GRAY)

    page(document, 7, "Actual browser map demonstration")
    document.add_picture(str(ROOT / "evidence" / "browser-map.png"), width=Inches(6.45))
    p(document, "Actual prepared Mars imagery, opportunity overlay, original illustrative H/A/B/C "
      "markers, and a separately labeled user-inspected X point. Blue is outbound; orange dashed "
      "is return. Dark/gray classes distinguish model exclusion and disconnection, not certified "
      "physical hazards. Thermal imagery remains qualitative context.", size=9, color=GRAY)

    page(document, 8, "Rumahweb deployment and handoff")
    heading(document, "Why TypeScript remains appropriate")
    p(document, "TypeScript is compiled before upload; browsers execute the resulting JavaScript. "
      "The hosting account only serves static files. No server Node.js, Python, PHP, database, "
      "framework process, or development server is required.")
    heading(document, "Upload checklist")
    for item in (
        "Back up any existing site. Confirm the domain/subdomain document root in the hosting control panel.",
        "Extract HOMEBOUND_Rumahweb_Upload.zip into the intended empty document root or an isolated public_html/homebound folder.",
        "Ensure index.html, styles.css, js, and data are directly in that folder; preserve case and relative paths.",
        "Review the supplied .htaccess instead of replacing existing site rules. No SPA rewrite is required.",
        "Open the final HTTPS URL and repeat the nominal no-route and connected-cell witness checks from the deployment guide.",
    ):
        p(document, item, style="List Bullet")
    heading(document, "Rebuild and retest on the development computer")
    code(document, "npm.cmd ci\nnpm.cmd test\nnpm.cmd run audit:model\n"
         "npm.cmd run build\nnpm.cmd run check:delivery\nnpm.cmd run preview")
    p(document, "Run from decision-model. Local preview is a temporary development helper, not a "
      "production hosting process. file:// launches are unsupported. The source archive includes "
      "the small prepared web inputs at their required relative path.", size=9.5)
    heading(document, "Documentation and authority")
    p(document, "The English Excel workbook contains parameters, input hashes, nominal results, "
      "sensitivity, unit/audit/browser/deployment checks, and assumptions. README.md documents "
      "the library API, cache rules, and failure semantics. The separate English Rumahweb guide "
      "contains the full upload and troubleshooting checklist.")
    p(document, "Official hosting reference: https://www.rumahweb.com/journal/deploy-react-js-di-cpanel-hosting/ "
      "(local frontend build and upload principle; this demonstration does not require React). "
      "No actual hosting account or credentials were accessed.", size=9, color=GRAY)
    document.save(REPORT)


def excel_sheet(book: Workbook, name: str, records: list[dict]):
    sheet = book.create_sheet(name)
    headers = list(records[0])
    sheet.append(headers)
    widths = {}
    for index, header in enumerate(headers, 1):
        width = 24
        if any(term in header.lower() for term in ("note", "observed", "detail", "description", "statement", "value", "name", "check", "sha256", "explanation")):
            width = 65
        widths[index] = width
        sheet.column_dimensions[sheet.cell(1, index).column_letter].width = width
    for record in records:
        sheet.append([text_value(record.get(key)) if isinstance(record.get(key), (dict, list, tuple)) or record.get(key) is None else record.get(key) for key in headers])
    for cell in sheet[1]:
        cell.fill = PatternFill("solid", fgColor=NAVY)
        cell.font = Font(name="Calibri", bold=True, color="FFFFFF", size=11)
        cell.alignment = Alignment(wrap_text=True, vertical="center")
    sheet.row_dimensions[1].height = 32
    for row in sheet.iter_rows(min_row=2):
        height = 28
        for index, cell in enumerate(row, 1):
            cell.font = Font(name="Calibri", size=10, color=NAVY)
            cell.alignment = Alignment(wrap_text=True, vertical="top")
            if isinstance(cell.value, str):
                lines = sum(max(1, math.ceil(len(part) / max(10, widths[index] - 3))) for part in cell.value.splitlines())
                height = max(height, min(300, lines * 15 + 8))
                if cell.value == "PASS":
                    cell.fill = PatternFill("solid", fgColor="E3F1E8")
        sheet.row_dimensions[row[0].row].height = height
    structured = Table(displayName="t" + name, ref=sheet.dimensions)
    structured.tableStyleInfo = TableStyleInfo(name="TableStyleMedium2", showRowStripes=True)
    sheet.add_table(structured)
    sheet.freeze_panes = "A2"
    sheet.sheet_view.zoomScale = 85


def unit_records() -> list[dict]:
    content = (ROOT / "evidence" / "unit-tests.txt").read_bytes()
    text = content.decode("utf-16" if content.startswith((b"\xff\xfe", b"\xfe\xff")) else "utf-8-sig")
    text = re.sub(r"\x1b\[[0-9;]*m", "", text)
    records = []
    for line in text.splitlines():
        match = re.match(r"^\u2714 (.+?) \(([\d.]+)ms\)$", line.strip())
        if match:
            records.append({"id": f"U{len(records)+1:02d}", "name": match.group(1), "status": "PASS", "milliseconds": float(match.group(2))})
    if len(records) != 41 or not re.search(r"\bfail 0\b", text):
        raise RuntimeError("The executed test log does not prove all 41 expected tests passed.")
    return records


def build(*, replace=False):
    if not replace and (REPORT.exists() or WORKBOOK.exists()):
        raise FileExistsError("Model documents already exist; use --replace for deliberate regeneration.")
    audit = load("model-audit.json")
    browser = load("browser-checks.json")
    deployment = load("deployment-checks.json")
    units = unit_records()
    for row in audit["inputs"]:
        actual = hashlib.sha256((WORKSPACE / "data" / "homebound" / "web" / row["filename"]).read_bytes()).hexdigest()
        if actual != row["sha256"]:
            raise RuntimeError("Prepared input changed after the model audit.")
    if any(row["status"] != "PASS" for row in audit["validations"] + deployment["checks"] + browser["checks"]):
        raise RuntimeError("A required model, browser, or deployment validation did not pass.")
    parameter_rows = [
        {"parameter": key, "nominal": value, "statement": "User-approved illustrative assumption; not a NASA standard or physical calibration."}
        for key, value in audit["nominalParameters"].items()
    ]
    nominal = []
    for result in audit["nominalResults"]:
        nominal.append({
            "target": result["targetId"], "row": result["destination"]["row"], "column": result["destination"]["column"],
            "status": result["status"], "reasonCode": result["reasonCode"],
            "outboundMinutes": result["time"]["outboundMinutes"] if result["time"] else None,
            "returnMinutes": result["time"]["returnMinutes"] if result["time"] else None,
            "marginMinutes": result["time"]["marginMinutes"] if result["time"] else None,
            "explanation": result["explanation"],
        })
    witness = audit["connectedCellWitness"]
    witness_rows = [
        {"case": "Connected-cell integration witness, not a science recommendation", "status": witness["result"]["status"], **witness["result"]["time"]},
        {"case": "Connected witness with total science = allowance + 1", "status": witness["extraTaskResult"]["status"], **witness["extraTaskResult"]["time"]},
    ]
    assumptions = [
        {"topic": "Purpose", "statement": "Pre-event research/prototype; no competition eligibility or operational safety assertion."},
        {"topic": "Directional costs", "statement": "Transparent heuristic, not validated physiology. All distances use the local metric Mars grid."},
        {"topic": "Terrain policy", "statement": "Maximum native cell slope, edge grade, and conservative diagonal checks can be restrictive; no safe-walking standard is implied."},
        {"topic": "Original scenario", "statement": "H/A/B/C remain unchanged. No threshold is relaxed automatically."},
        {"topic": "Connected witness", "statement": "Numerical integration test only, not a suggested observation point or safe habitat."},
        {"topic": "Thermal", "statement": "Qualitative visual context only; excluded from route costs and time decisions."},
        {"topic": "Time reserve", "statement": "Reserve retained in full; negative allowances retained; no success-shaped defaults."},
        {"topic": "Numerical precision", "statement": "1e-9 minute zero tolerance is computational only, not a safety buffer or a physical-accuracy claim."},
        {"topic": "Browser download", "statement": "Actual generated Blob validated. Native download event unavailable in integrated browser; OS-level saving not claimed as tested."},
        {"topic": "Hosting", "statement": "Static root/subfolder compatibility verified locally; actual Rumahweb deployment not performed."},
    ]
    book = Workbook()
    book.remove(book.active)
    excel_sheet(book, "ReadMe", [
        {"item": "Model", "value": "HOMEBOUND deterministic time-only decision engine, version 1.0.0"},
        {"item": "Actual nominal finding", "value": "A/B/C: NO_MODELED_ROUTE at 20 degrees; original endpoints preserved."},
        {"item": "Runtime", "value": audit["runtime"]},
        {"item": "Local model build / field ms", "value": [audit["nominalBuildMilliseconds"], audit["fieldUpdateMilliseconds"]]},
        {"item": "Validation", "value": f"{len(units)} unit, {len(audit['validations'])} real audit, {len(browser['checks'])} browser, {len(deployment['checks'])} static checks"},
        {"item": "Meaning of Not evaluable", "value": "Underlying numeric result is null, not zero; no complete modeled route exists or data are unavailable."},
    ])
    excel_sheet(book, "Parameters", parameter_rows)
    excel_sheet(book, "InputHashes", audit["inputs"])
    excel_sheet(book, "NominalTargets", nominal)
    excel_sheet(book, "ConnectedWitness", witness_rows)
    excel_sheet(book, "Sensitivity", audit["sensitivity"])
    excel_sheet(book, "AuditChecks", audit["validations"])
    excel_sheet(book, "UnitTests", units)
    excel_sheet(book, "BrowserChecks", browser["checks"])
    excel_sheet(book, "StaticChecks", deployment["checks"])
    excel_sheet(book, "Assumptions", assumptions)
    DOCS.mkdir(exist_ok=True)
    book.properties.title = "HOMEBOUND Decision Model: Executed Results and Sensitivity"
    book.properties.creator = ""
    book.save(WORKBOOK)
    make_report(audit, browser, deployment, units)
    with ZipFile(REPORT) as archive:
        if archive.testzip() is not None:
            raise RuntimeError("Word document package failed integrity validation.")
    reopened = load_workbook(WORKBOOK, read_only=False, data_only=False)
    if len(reopened.sheetnames) != 11 or reopened["Sensitivity"].max_row != 37 or reopened["UnitTests"].max_row != 42:
        raise RuntimeError("Excel worksheet counts do not match executed evidence.")
    if any(cell.data_type == "f" for sheet in reopened for row in sheet for cell in row):
        raise RuntimeError("Unexpected formula in an evidence workbook.")
    reopened.close()
    with (ROOT / "evidence" / "unit-tests-catalog.csv").open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(units[0]))
        writer.writeheader()
        writer.writerows(units)
    examples = ROOT / "examples"
    examples.mkdir(exist_ok=True)
    for label, result in (
        ("nominal-target-A", audit["nominalResults"][0]),
        ("connected-cell-witness", audit["connectedCellWitness"]["result"]),
        ("connected-cell-extra-task", audit["connectedCellWitness"]["extraTaskResult"]),
    ):
        request = {key: result[key] for key in ("origin", "destination", "parameters", "mission")}
        response = {key: value for key, value in result.items() if key != "targetId"}
        (examples / f"{label}-request.json").write_text(json.dumps(request, indent=2), encoding="utf-8")
        (examples / f"{label}-result.json").write_text(json.dumps(response, indent=2), encoding="utf-8")
    (examples / "analytical-time-references.json").write_text(
        json.dumps(audit["analyticalReferences"], indent=2), encoding="utf-8"
    )
    print(f"Created Word report: {REPORT}")
    print(f"Created Excel workbook: {WORKBOOK} (11 sheets)")


def render(render_directory: Path):
    import pythoncom
    import pymupdf
    from win32com.client import DispatchEx

    render_directory.mkdir(parents=True, exist_ok=True)
    pdf = render_directory / "HOMEBOUND_Model_Report_layout.pdf"
    pythoncom.CoInitialize()
    word = None
    document = None
    owned_empty = False
    try:
        word = DispatchEx("Word.Application")
        if word.Documents.Count:
            raise RuntimeError("Word automation returned an instance with user documents; stopping.")
        owned_empty = True
        word.Visible = False
        word.DisplayAlerts = 0
        document = word.Documents.Open(FileName=str(REPORT), ConfirmConversions=False, ReadOnly=True, AddToRecentFiles=False, Visible=False)
        document.Repaginate()
        print(f"Word-rendered pages: {document.ComputeStatistics(2)}")
        document.ExportAsFixedFormat(str(pdf), 17)
    finally:
        if document is not None:
            document.Close(SaveChanges=0)
        if word is not None and owned_empty and word.Documents.Count == 0:
            word.Quit(SaveChanges=0)
        pythoncom.CoUninitialize()
    titles = [
        "Decision Model Implementation Report", "Graph rules and travel-time model",
        "Decision rules, inputs, and outputs", "Actual nominal-data results",
        "Sensitivity, interpretation, and next decisions", "Verification and browser behavior",
        "Actual browser map demonstration", "Rumahweb deployment and handoff",
    ]
    with pymupdf.open(pdf) as rendered:
        for index, item in enumerate(rendered):
            text = re.sub(r"\s+", " ", item.get_text())
            print(f"Page {index+1}: {len(text.split())} words | {text[:125]}")
            item.get_pixmap(matrix=pymupdf.Matrix(1.2, 1.2), alpha=False).save(render_directory / f"model_page_{index+1}.png")
        if len(rendered) != len(titles):
            raise RuntimeError(f"Expected eight report pages; found {len(rendered)}.")
        for item, title in zip(rendered, titles):
            if title not in re.sub(r"\s+", " ", item.get_text()):
                raise RuntimeError(f"Section moved off its intended page: {title}")
    print("Word rendering, eight-page pagination, and section checks passed.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate English model documentation from executed evidence.")
    parser.add_argument("--replace", action="store_true")
    parser.add_argument("--render-dir", type=Path)
    arguments = parser.parse_args()
    build(replace=arguments.replace)
    if arguments.render_dir is not None:
        render(arguments.render_dir)
