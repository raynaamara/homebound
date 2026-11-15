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
from playwright.sync_api import Browser, Page, expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
DEPLOY = ROOT / "deploy"
EVIDENCE = ROOT / "evidence"
EDGE = Path(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe")
VERSION = json.loads((ROOT / "config" / "application.json").read_text())["applicationVersion"]
BASELINE = json.loads((EVIDENCE / "regional-context-preservation.json").read_text())


class Handler(SimpleHTTPRequestHandler):
    def translate_path(self, path: str) -> str:
        return super().translate_path(path.removeprefix("/nested/homebound"))

    def log_message(self, format: str, *args: object) -> None:
        pass


def start(page: Page, url: str) -> None:
    page.goto(url, wait_until="load")
    expect(page.locator("#start")).to_be_enabled(timeout=30000)
    page.locator("#start").click()


def saved_result(page: Page) -> dict:
    page.locator("#to-save").click()
    page.locator("#mission-brief img").evaluate_all(
        "images => Promise.all(images.map(image => image.decode()))")
    return json.loads(page.locator("#result-json").text_content())


def choose_plan(page: Page, identifier: str) -> None:
    page.locator('[data-step="1"]').click()
    page.locator(f'input[name="destination"][value="{identifier}"]').check()
    page.locator("#to-activities").click()
    page.locator("#review-plan").click()
    expected = "NO_MODELED_ROUTE" if identifier == "A" else "FEASIBLE"
    expect(page.locator("#status")).to_have_attribute("data-status", expected)


def compare_baseline(result: dict, identifier: str) -> None:
    expected = next(item["plan"] for item in BASELINE["referencePlans"] if item["id"] == identifier)
    # Worker requests retain cell coordinates, not the direct-call destination's narrative metadata.
    expected = {**expected, "destination": {key: expected["destination"][key] for key in ["row", "column"]}}
    actual = result["modelResult"]
    differences = {key: {"actual": actual.get(key), "expected": expected.get(key)}
                   for key in actual.keys() | expected.keys()
                   if key != "explanation" and actual.get(key) != expected.get(key)}
    assert not differences, json.dumps({"case": identifier, "differences": differences}, indent=2)


def check_faults(browser: Browser, url: str) -> list[dict]:
    records = []
    for asset in ["regional-context.json", "regional-context.svg"]:
        with browser.new_context() as context:
            page = context.new_page()
            pattern = f"**/{asset}*"
            page.route(pattern, lambda route: route.fulfill(status=503, content_type="text/plain", body="Development-only regional asset failure"))
            page.goto(url, wait_until="load")
            expect(page.locator("#error")).to_be_visible(timeout=30000)
            expect(page.locator("#start")).to_be_disabled()
            message = page.locator("#error-text").inner_text()
            assert message.strip()
            page.unroute(pattern)
            page.locator("#retry-data").click()
            expect(page.locator("#start")).to_be_enabled(timeout=30000)
            expect(page.locator("#error")).to_be_hidden()
            records.append({"asset": asset, "visibleError": message, "retry": "PASS", "substituteData": False})
    return records


def main() -> None:
    checks = []
    errors = []
    external_requests = []
    responsive = []
    results = []
    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(Handler, directory=str(DEPLOY)))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    url = f"http://127.0.0.1:{server.server_port}/"
    try:
        with urllib.request.urlopen(url + "HOMEBOUND_BUILD.txt", timeout=10) as response:
            assert f"application {VERSION}" in response.read().decode()
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path=str(EDGE), headless=True)
            try:
                with browser.new_context(viewport={"width": 1280, "height": 1000}) as context:
                    context.on("request", lambda request: external_requests.append(request.url)
                               if request.url.startswith(("http://", "https://")) and not request.url.startswith(url) else None)
                    page = context.new_page()
                    page.on("pageerror", lambda error: errors.append(str(error)))
                    page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
                    start(page, url)
                    disclosure = page.locator("#regional-context")
                    assert disclosure.get_attribute("open") is None
                    summary = disclosure.locator("summary")
                    summary.focus(); page.keyboard.press("Enter")
                    assert disclosure.get_attribute("open") is not None
                    page.keyboard.press("Space")
                    assert disclosure.get_attribute("open") is None
                    summary.click()
                    image = disclosure.locator("img")
                    assert image.evaluate("image => image.complete && image.naturalWidth === 720 && image.naturalHeight === 850")
                    assert image.get_attribute("src").startswith(url + "data/regional-context.svg?v=")
                    assert "NASA Mars Trek" in disclosure.inner_text() and "463 m" in disclosure.inner_text()
                    assert summary.bounding_box()["height"] >= 44
                    source_map = context.new_page()
                    source_map.goto(url + "data/regional-context.svg", wait_until="load")
                    source_map.locator("svg").screenshot(path=str(EVIDENCE / "regional-context-map.png"))
                    source_map.close()
                    disclosure.screenshot(path=str(EVIDENCE / "regional-context-card.png"))
                    checks.append({"id": "RB01", "status": "PASS", "check": "Native disclosure, keyboard/pointer, credited actual local map and 44 px target",
                                   "evidence": "Closed initially; Enter/Space/pointer toggle; decoded 720 by 850 source-backed SVG; accessible regional role and spacing."})

                    for width in [1280, 900, 390, 320]:
                        page.set_viewport_size({"width": width, "height": 1000})
                        measurement = page.evaluate("""() => {
                          const image = document.querySelector('#regional-context img').getBoundingClientRect();
                          const panel = document.querySelector('#regional-context').getBoundingClientRect();
                          return {overflow: document.documentElement.scrollWidth > innerWidth + 1,
                            imageInside: image.left >= panel.left - 1 && image.right <= panel.right + 1,
                            summaryHeight: document.querySelector('#regional-context summary').getBoundingClientRect().height};
                        }""")
                        assert not measurement["overflow"] and measurement["imageInside"] and measurement["summaryHeight"] >= 44
                        responsive.append({"width": width, **measurement})
                        if width == 390:
                            disclosure.screenshot(path=str(EVIDENCE / "regional-context-mobile.png"))
                    checks.append({"id": "RB02", "status": "PASS", "check": "Regional card remains contained and readable at desktop/tablet/390/320 px widths",
                                   "evidence": responsive})
                    page.set_viewport_size({"width": 1280, "height": 1000})
                    choose_plan(page, "S")
                    result = saved_result(page); compare_baseline(result, "S-20")
                    assert len(result["scienceContext"]["references"]) == 3
                    results.append({"case": "S-20", "margin": result["modelResult"]["time"]["marginMinutes"]})
                    for extra, identifier, status in [(68, "S-88", "TIME_BUDGET_EXCEEDED"), (65, "S-85", "FEASIBLE")]:
                        page.locator('[data-step="3"]').click()
                        page.locator("#extra").fill(str(extra))
                        expect(page.locator("#download-json")).to_be_hidden()
                        page.locator("#compare").click()
                        expect(page.locator("#status")).to_have_attribute("data-status", status)
                        result = saved_result(page); compare_baseline(result, identifier)
                        assert result["originalPlan"]["mission"]["scienceMinutes"] == 20
                        assert result["modelResult"]["mission"]["reserveMinutes"] == 20
                        results.append({"case": identifier, "margin": result["modelResult"]["time"]["marginMinutes"]})
                    checks.append({"id": "RB03", "status": "PASS", "check": "Real worker/UI S 20/88/85-minute plans, exact route cells and reserve match the prior release",
                                   "evidence": results.copy()})

                    regional = result["regionalContext"]
                    assert regional["usedForRouting"] is False and len(regional["tiles"]) == 4
                    assert regional["source"]["id"] == "mars_trek_mola_context"
                    assert len(result["sources"]) == 4
                    downloads = {}
                    for identifier in ["download-text", "download-json"]:
                        with page.expect_download() as pending_download:
                            page.locator(f"#{identifier}").click()
                        downloads[identifier] = Path(pending_download.value.path()).read_text(encoding="utf-8")
                    text = downloads["download-text"]
                    assert json.loads(downloads["download-json"]) == result
                    for expected in [regional["source"]["productId"], regional["imageSha256"], regional["scope"],
                                     *[tile["sha256"] for tile in regional["tiles"]]]:
                        assert expected in text
                    assert page.locator("#mission-brief .regional-figure img").evaluate("image => image.complete && image.naturalWidth > 0")
                    page.pdf(path=str(EVIDENCE / "regional-context-brief.pdf"), format="A4", print_background=True)
                    with pymupdf.open(EVIDENCE / "regional-context-brief.pdf") as pdf:
                        pdf_text = "\n".join(item.get_text() for item in pdf)
                        assert "Regional setting" in pdf_text and "NASA Mars Trek" in pdf_text and "463 m" in pdf_text
                        assert "Where is this Marswalk?" not in pdf_text
                        pages = len(pdf)
                    checks.append({"id": "RB04", "status": "PASS", "check": "Actual TXT/JSON and native browser PDF retain the regional image role and all tile references",
                                   "evidence": {"jsonSources": 4, "regionalTileReferences": 4, "pdfPages": pages, "sourceImage": regional["imageSha256"]}})

                    for destination, identifier in [("P", "P-20"), ("A", "A-20")]:
                        choose_plan(page, destination)
                        clean = saved_result(page); compare_baseline(clean, identifier)
                        assert clean["scienceContext"] is None
                        assert clean["regionalContext"] == regional
                    checks.append({"id": "RB05", "status": "PASS", "check": "Practice and no-route findings keep regional orientation without inheriting S science",
                                   "evidence": "P remains feasible; original A remains no-route/null timing; both export the same study-area context and scienceContext:null."})

                    nested = context.new_page()
                    nested.on("pageerror", lambda error: errors.append(str(error)))
                    start(nested, url + "nested/homebound/")
                    nested.locator("#to-activities").click(); nested.locator("#review-plan").click()
                    expect(nested.locator("#status")).to_have_attribute("data-status", "FEASIBLE")
                    subfolder = saved_result(nested); compare_baseline(subfolder, "P-20")
                    assert subfolder["regionalContext"] == regional
                    checks.append({"id": "RB06", "status": "PASS", "check": "Fresh subfolder startup, decoded local context image and actual P result",
                                   "evidence": "nested/homebound/ uses relative assets and the same exact P plan/context."})
                    assert not errors, errors
                    assert not external_requests, external_requests
                faults = check_faults(browser, url)
                checks.append({"id": "RB07", "status": "PASS", "check": "Missing regional metadata/image fail visibly, block startup and recover through Retry without substituted data",
                               "evidence": faults})
                version = browser.version
            finally:
                browser.close()
        deployment_hashes = {str(path.relative_to(DEPLOY)): hashlib.sha256(path.read_bytes()).hexdigest()
                             for path in sorted(DEPLOY.rglob("*")) if path.is_file()}
        report = {"applicationVersion": VERSION, "executedUtc": datetime.now(timezone.utc).isoformat(),
                  "method": "Fresh isolated headless Microsoft Edge; real static deployment and worker; actual Blob TXT/JSON, native PDF, responsive/keyboard, root/subfolder and development-only fault checks.",
                  "browserVersion": version, "checks": checks, "deploymentSha256": deployment_hashes,
                  "normalPageErrors": errors, "externalRuntimeRequests": external_requests}
        (EVIDENCE / "regional-context-browser-checks.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({"applicationVersion": VERSION, "browserVersion": version, "checks": len(checks),
                          "deploymentFiles": len(deployment_hashes), "referenceResults": results,
                          "normalPageErrors": errors, "externalRuntimeRequests": external_requests}, indent=2))
    finally:
        server.shutdown(); server.server_close(); thread.join(timeout=10)


if __name__ == "__main__":
    main()
