from __future__ import annotations

import hashlib
import json
import threading
import urllib.request
from datetime import datetime, timezone
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pymupdf
from playwright.sync_api import Page, expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
DEPLOY = ROOT / "deploy"
EVIDENCE = ROOT / "evidence"
EDGE = Path(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe")
CONFIG = json.loads((ROOT / "config" / "application.json").read_text())
VERSION = CONFIG["applicationVersion"]
EXAMPLES = {item["id"]: item["plan"] for item in json.loads(
    (EVIDENCE / "planning-preset-examples.json").read_text())["examples"]}
FIELDS = {"budget": 120, "reserve": 20, "speed": 30, "slope-limit": 20, "uphill": 4, "downhill": 2}


class Handler(SimpleHTTPRequestHandler):
    def translate_path(self, path: str) -> str:
        return super().translate_path(path.removeprefix("/nested/homebound"))

    def log_message(self, format: str, *args: object) -> None:
        pass


def start(page: Page, url: str) -> None:
    page.goto(url, wait_until="load")
    expect(page.locator("#start")).to_be_enabled(timeout=30000)
    page.locator("#start").click()


def choose(page: Page, identifier: str) -> None:
    page.locator('[data-step="1"]').click()
    page.locator(f'input[name="destination"][value="{identifier}"]').check()
    page.locator("#to-activities").click()


def fields(page: Page, *, terrain: bool) -> None:
    for identifier, value in {**FIELDS, **({"budget": 180, "slope-limit": 30} if terrain else {})}.items():
        expect(page.locator(f"#{identifier}")).to_have_value(str(value))
    expect(page.locator("#planning-preset")).to_have_value("terrain_exploration" if terrain else "science_walkthrough")


def calculate(page: Page, status: str = "FEASIBLE") -> None:
    page.locator("#review-plan").click()
    expect(page.locator("#status")).to_have_attribute("data-status", status)


def saved_result(page: Page, case: str | None = None) -> dict:
    page.locator("#to-save").click()
    page.locator("#mission-brief img").evaluate_all("images => Promise.all(images.map(image => image.decode()))")
    result = json.loads(page.locator("#result-json").text_content())
    if case is not None:
        actual = {key: value for key, value in result["modelResult"].items() if key != "explanation"}
        expected = {key: value for key, value in EXAMPLES[case].items() if key != "explanation"}
        assert actual == expected, case
    return result


def cleared(page: Page) -> None:
    expect(page.locator("#download-text")).to_be_hidden()
    expect(page.locator("#download-json")).to_be_hidden()
    expect(page.locator("#mission-brief")).to_be_hidden()
    expect(page.locator("#result-json")).to_have_text("")
    expect(page.locator("#print")).to_be_disabled()
    expect(page.locator('[data-step="4"]')).to_be_disabled()
    expect(page.locator("#comparison-section")).to_be_hidden()
    assert page.locator("body").get_attribute("data-print-ready") == "false"


def exports(page: Page, result: dict, stem: str) -> dict:
    downloaded = {}
    for identifier in ["download-text", "download-json"]:
        with page.expect_download() as waiting:
            page.locator(f"#{identifier}").click()
        downloaded[identifier] = Path(waiting.value.path()).read_text(encoding="utf-8")
    assert json.loads(downloaded["download-json"]) == result
    label = "Planning preset: " + result["planningPreset"]["name"]
    assert label in downloaded["download-text"]
    assert f"Mission budget: {result['modelResult']['mission']['missionBudgetMinutes']:.2f} min" in downloaded["download-text"]
    expect(page.locator("#mission-brief")).to_contain_text(label)
    for suffix, identifier in [("txt", "download-text"), ("json", "download-json")]:
        (EVIDENCE / f"{stem}.{suffix}").write_text(downloaded[identifier], encoding="utf-8")
    pdf_path = EVIDENCE / f"{stem}.pdf"
    page.pdf(path=str(pdf_path), format="A4", print_background=True)
    with pymupdf.open(pdf_path) as document:
        text = "\n".join(item.get_text() for item in document)
        assert label in text and "Protected reserve" in text
        assert "Presets reset the budget" not in text
        assert "NASA Mars Trek" in text
        pages = len(document)
    return {"preset": result["planningPreset"], "pdfPages": pages, "nativeDownloadsMatch": True}


def main() -> None:
    checks = []
    errors = []
    external = []
    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(Handler, directory=str(DEPLOY)))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    url = f"http://127.0.0.1:{server.server_port}/"

    def check(identifier: str, description: str, evidence) -> None:
        checks.append({"id": identifier, "status": "PASS", "check": description, "evidence": evidence})

    def observed(context) -> Page:
        context.on("request", lambda request: external.append(request.url)
                   if request.url.startswith(("http://", "https://")) and not request.url.startswith(url) else None)
        page = context.new_page()
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
        return page

    try:
        with urllib.request.urlopen(url + "HOMEBOUND_BUILD.txt", timeout=10) as response:
            assert f"application {VERSION}" in response.read().decode()
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path=str(EDGE), headless=True)
            try:
                with browser.new_context(viewport={"width": 1280, "height": 1000}) as context:
                    page = observed(context)
                    start(page, url)
                    page.locator("#to-activities").click()
                    fields(page, terrain=False)
                    control = page.get_by_label("Planning preset", exact=True)
                    assert control.evaluate("element => element.tagName") == "SELECT"
                    assert control.bounding_box()["height"] >= 44
                    expect(control.locator("option")).to_have_text(["Science walkthrough", "Terrain exploration", "Custom settings"])
                    assert control.locator('[value="custom"]').is_disabled()
                    check("PB01", "Fresh startup keeps Science as a native, labeled, 44 px preset control with all six original inputs",
                          {"initialPreset": control.input_value(), "fields": FIELDS})

                    choose(page, "S")
                    fields(page, terrain=False)
                    calculate(page)
                    result = saved_result(page, "S-20")
                    science = [{"observation": 20, "margin": result["modelResult"]["time"]["marginMinutes"]}]
                    for extra, case, status in [(68, "S-88", "TIME_BUDGET_EXCEEDED"), (65, "S-85", "FEASIBLE")]:
                        page.locator('[data-step="3"]').click()
                        page.locator("#extra").fill(str(extra))
                        page.locator("#compare").click()
                        expect(page.locator("#status")).to_have_attribute("data-status", status)
                        result = saved_result(page, case)
                        assert result["planningPreset"]["id"] == "science_walkthrough"
                        assert result["originalPlan"]["mission"]["scienceMinutes"] == 20
                        science.append({"observation": 20 + extra, "margin": result["modelResult"]["time"]["marginMinutes"]})
                    check("PB02", "Real worker S 20/88/85 plans, routes and comparisons remain exact and retain Science identity", science)

                    page.locator('[data-step="2"]').click()
                    control.select_option("terrain_exploration")
                    fields(page, terrain=True)
                    expect(page.locator('input[name="destination"]:checked')).to_have_value("S")
                    expect(page.locator("#science")).to_have_value("20")
                    cleared(page)
                    expect(page.locator('[data-step="3"]')).to_be_disabled()
                    expect(page.locator("#status")).to_have_attribute("data-status", "STALE")
                    control.locator("..").screenshot(path=str(EVIDENCE / "planning-preset-controls.png"))
                    check("PB03", "An explicit preset change preserves destination/base observation and clears original, revised, comparison, downloads and print state",
                          {"destination": "S", "observation": 20, "previousComparison": "S-85", "staleExports": "cleared"})

                    terrain = []
                    for identifier in ["A", "B", "C"]:
                        choose(page, identifier)
                        fields(page, terrain=True)
                        calculate(page)
                        expect(page.locator("#review-preset")).to_have_text("Planning preset: Terrain exploration")
                        result = saved_result(page, f"terrain-{identifier}")
                        assert result["planningPreset"]["id"] == "terrain_exploration"
                        assert result["scienceContext"] is None
                        terrain.append({"destination": identifier, "margin": result["modelResult"]["time"]["marginMinutes"]})
                        if identifier == "B":
                            named_exports = exports(page, result, "planning-preset-terrain-brief")
                    check("PB04", "Changing destination never changes the preset; original A/B/C fit the real 180-minute Terrain calculation", terrain)
                    check("PB05", "Actual named-preset TXT/JSON downloads and native PDF record Terrain, numeric assumptions and NASA context", named_exports)

                    choose(page, "B")
                    page.locator("#budget").fill("181")
                    expect(control).to_have_value("custom")
                    calculate(page)
                    result = saved_result(page, "custom-B-181")
                    assert result["planningPreset"]["id"] is None
                    custom_exports = exports(page, result, "planning-preset-custom-brief")
                    check("PB06", "A manual budget change is Custom in the actual result, UI, native TXT/JSON and PDF rather than a stale preset label", custom_exports)

                    page.locator('[data-step="2"]').click()
                    page.locator("#advanced-assumptions").evaluate("element => element.open = true")
                    for identifier, value in {"budget": 119, "reserve": 15, "speed": 25, "slope-limit": 17, "uphill": 3, "downhill": 1, "science": 17}.items():
                        page.locator(f"#{identifier}").fill(str(value))
                    expect(control).to_have_value("custom")
                    control.focus()
                    page.keyboard.press("Home"); page.keyboard.press("Enter")
                    fields(page, terrain=False)
                    expect(page.locator("#science")).to_have_value("17")
                    expect(page.locator('input[name="destination"]:checked')).to_have_value("B")
                    cleared(page)
                    choose(page, "A")
                    fields(page, terrain=False)
                    calculate(page, "NO_MODELED_ROUTE")
                    no_route = saved_result(page)
                    assert no_route["modelResult"]["time"] is None
                    assert no_route["planningPreset"]["id"] == "science_walkthrough"
                    check("PB07", "Keyboard selection restores all six shared inputs without changing observation/destination; choosing A does not silently relax Science",
                          {"restored": FIELDS, "preservedObservation": 17, "preservedDestination": "B", "scienceA": "NO_MODELED_ROUTE"})

                    page.locator('[data-step="1"]').click()
                    page.locator("#custom-location summary").click()
                    page.locator('input[name="destination"][value="custom"]').check()
                    page.locator("#row").fill("113"); page.locator("#column").fill("119")
                    page.locator("#to-activities").click()
                    control.select_option("terrain_exploration")
                    expect(page.locator("#row")).to_have_value("113"); expect(page.locator("#column")).to_have_value("119")
                    calculate(page)
                    custom_point = saved_result(page, "terrain-A")
                    assert custom_point["destination"]["kind"] == "custom"
                    assert custom_point["scienceContext"] is None
                    assert custom_point["planningPreset"]["id"] == "terrain_exploration"
                    check("PB08", "Custom X retains explicitly entered coordinates and uses the selected preset without inheriting S science",
                          {"row": 113, "column": 119, "status": custom_point["modelResult"]["status"]})

                    page.locator('[data-step="2"]').click()
                    responsive = []
                    for width in [1280, 900, 390, 320]:
                        page.set_viewport_size({"width": width, "height": 1000})
                        measurement = page.evaluate("""() => {
                          const control = document.querySelector('#planning-preset').getBoundingClientRect();
                          const panel = document.querySelector('#step-2').getBoundingClientRect();
                          return {overflow: document.documentElement.scrollWidth > innerWidth + 1,
                            inside: control.left >= panel.left && control.right <= panel.right,
                            height: control.height};
                        }""")
                        assert not measurement["overflow"] and measurement["inside"] and measurement["height"] >= 44
                        responsive.append({"width": width, **measurement})
                        if width == 390:
                            page.locator("#step-2").screenshot(path=str(EVIDENCE / "planning-preset-mobile.png"))
                    nested = observed(context)
                    start(nested, url + "nested/homebound/")
                    choose(nested, "B")
                    nested.locator("#planning-preset").select_option("terrain_exploration")
                    calculate(nested)
                    saved_result(nested, "terrain-B")
                    check("PB09", "Preset control stays contained at desktop/tablet/390/320 px; a fresh subfolder loads and calculates the exact Terrain B plan",
                          {"responsive": responsive, "subfolder": "nested/homebound/"})
                    assert not errors, errors
                    assert not external, external

                with browser.new_context(viewport={"width": 1280, "height": 1000}) as context:
                    page = observed(context)

                    def delayed_worker(route) -> None:
                        body = route.fetch().text()
                        route.fulfill(content_type="text/javascript", body=(
                            "const sendImmediately = self.postMessage.bind(self);"
                            "self.postMessage = (...args) => setTimeout(() => {"
                            "sendImmediately(...args);"
                            "setTimeout(() => console.info('HOMEBOUND_TEST_DELAYED_REPLY'), 50);}, 500);\n" + body))

                    page.route("**/worker.js*", delayed_worker)
                    start(page, url)
                    choose(page, "S")
                    with page.expect_console_message(lambda message: message.text == "HOMEBOUND_TEST_DELAYED_REPLY"):
                        page.locator("#review-plan").click()
                        expect(page.locator("#status")).to_have_attribute("data-status", "COMPUTING")
                        page.locator('[data-step="2"]').click()
                        page.locator("#planning-preset").select_option("terrain_exploration")
                    expect(page.locator("#status")).to_have_attribute("data-status", "STALE")
                    cleared(page)
                    calculate(page)
                    result = saved_result(page)
                    assert result["planningPreset"]["id"] == "terrain_exploration"
                    assert result["modelResult"]["mission"]["missionBudgetMinutes"] == 180
                    check("PB10", "A real delayed worker reply cannot resurrect a Science plan after switching to Terrain; a fresh calculation succeeds",
                          {"developmentOnlyDelayMs": 500, "lateResult": "ignored", "newPreset": result["planningPreset"]["id"]})

                with browser.new_context() as context:
                    page = context.new_page()
                    invalid = {**CONFIG, "defaultPlanningPreset": "terrain_exploration"}
                    page.route("**/application.json*", lambda route: route.fulfill(
                        content_type="application/json", body=json.dumps(invalid)))
                    page.goto(url, wait_until="load")
                    expect(page.locator("#error")).to_be_visible(timeout=30000)
                    expect(page.locator("#start")).to_be_disabled()
                    startup_error = page.locator("#error-text").inner_text()
                    page.unroute("**/application.json*")
                    page.locator("#retry-data").click()
                    expect(page.locator("#start")).to_be_enabled(timeout=30000)
                    page.locator("#start").click(); page.locator("#to-activities").click()
                    page.locator("#budget").fill("")
                    expect(page.locator("#planning-preset")).to_have_value("custom")
                    page.locator("#review-plan").click()
                    expect(page.locator("#error")).to_be_visible()
                    expect(page.locator("#budget")).to_have_value("")
                    cleared(page)
                    input_error = page.locator("#error-text").inner_text()
                    check("PB11", "Invalid preset configuration blocks startup and recovers via Retry; an incomplete manual budget stays invalid with a visible error, never a fallback",
                          {"startupError": startup_error, "inputError": input_error, "retry": "PASS"})
                assert not errors, errors
                assert not external, external
                browser_version = browser.version
            finally:
                browser.close()
        hashes = {str(path.relative_to(DEPLOY)): hashlib.sha256(path.read_bytes()).hexdigest()
                  for path in sorted(DEPLOY.rglob("*")) if path.is_file()}
        report = {"applicationVersion": VERSION, "executedUtc": datetime.now(timezone.utc).isoformat(),
                  "method": "Fresh isolated Microsoft Edge, actual static build and worker, exact full-plan comparison, native dropdown/keyboard, real TXT/JSON downloads and native PDF, mobile/subfolder, delayed-worker and visible-error tests.",
                  "browserVersion": browser_version, "checks": checks, "deploymentSha256": hashes,
                  "normalPageErrors": errors, "externalRuntimeRequests": external}
        (EVIDENCE / "planning-preset-browser-checks.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({"applicationVersion": VERSION, "browserVersion": browser_version,
                          "checks": len(checks), "deploymentFiles": len(hashes),
                          "normalPageErrors": errors, "externalRuntimeRequests": external}, indent=2))
    finally:
        server.shutdown(); server.server_close(); thread.join(timeout=10)


if __name__ == "__main__":
    main()
