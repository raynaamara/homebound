from __future__ import annotations

import argparse
import csv
import importlib.util
import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORKSPACE = ROOT.parent
DOCS = WORKSPACE / "docs"
UPLOAD = DOCS / "HOMEBOUND_Application_Rumahweb_Upload.zip"
SOURCE = DOCS / "HOMEBOUND_Application_Source.zip"
INTEGRITY = DOCS / "HOMEBOUND_Application_Delivery_Integrity.json"

specification = importlib.util.spec_from_file_location("homebound_archive_tools", ROOT / "scripts" / "package-model.py")
if specification is None or specification.loader is None:
    raise RuntimeError("The existing verified archive helper could not be loaded.")
archive_tools = importlib.util.module_from_spec(specification)
specification.loader.exec_module(archive_tools)


def load(name: str):
    return json.loads((ROOT / "evidence" / name).read_text(encoding="utf-8"))


def package(*, replace=False):
    if not replace and (UPLOAD.exists() or SOURCE.exists()):
        raise FileExistsError("Application archives already exist; use --replace for deliberate regeneration.")
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
    version = json.loads((ROOT / "config" / "application.json").read_text())["applicationVersion"]
    if any(proof["applicationVersion"] != version for proof in (integration, static, regional_data, preset_data, preset_browser)):
        raise RuntimeError("Current release evidence does not match the application; older browser records retain historical scope.")
    for proof in (regional_data, preset_data):
        for relative, expected in proof["verifiedFiles"].items():
            if archive_tools.sha256(WORKSPACE / relative) != expected:
                raise RuntimeError(f"A verified input changed after its check: {relative}")
    deployment_hashes = {str(path.relative_to(ROOT / "deploy")): archive_tools.sha256(path)
                         for path in sorted((ROOT / "deploy").rglob("*")) if path.is_file()}
    if deployment_hashes != preset_browser["deploymentSha256"]:
        raise RuntimeError("The exact deployment file set/bytes differ from the current preset browser check.")
    with (ROOT / "evidence" / "application-unit-catalog.csv").open(newline="", encoding="utf-8") as stream:
        unit_count = len(list(csv.DictReader(stream)))
    for group in (browser["checks"], integration["checks"], static["checks"], layers["checks"], destination_checks["checks"], parameter_checks["checks"], copy_checks["checks"], map_view_checks["checks"], theme_checks["checks"], dawn_checks["checks"], science_checks["checks"], export_checks["checks"], positioning_checks["checks"], regional_data["checks"], regional_browser["checks"], preset_data["checks"], preset_browser["checks"]):
        if any(item["status"] != "PASS" for item in group):
            raise RuntimeError("Cannot publish an application with failed required checks.")
    preserved = load("application-preserved-inputs.json")
    patch_preserved = load("layer-ux-preserved-inputs.json")
    for relative, expected in {**regional_preserved["protectedFiles"], **preset_preserved["protectedFiles"]}.items():
        if archive_tools.sha256(WORKSPACE / relative) != expected:
            raise RuntimeError(f"A protected model or prepared web file changed: {relative}")
    preset_archive = WORKSPACE / preset_preserved["historicalSnapshot"]
    preset_snapshot_status = "NOT_PRESENT"
    if preset_archive.exists():
        if archive_tools.sha256(preset_archive) != preset_preserved["snapshotSha256"]:
            raise RuntimeError("The previous application 1.1.11/register 1.29 snapshot changed.")
        preset_snapshot_status = "VERIFIED"
    preset_references = []
    for relative, expected in preset_preserved["unchangedDeliverables"].items():
        path = WORKSPACE / relative
        if not path.exists():
            if preset_snapshot_status == "VERIFIED":
                raise FileNotFoundError(f"A protected current media/reference file is missing: {relative}")
            preset_references.append({"path": relative, "status": "NOT_PRESENT"})
            continue
        if archive_tools.sha256(path) != expected:
            raise RuntimeError(f"A protected current media/reference file changed: {relative}")
        preset_references.append({"path": relative, "status": "UNCHANGED", "sha256": expected})
    prior_snapshot = WORKSPACE / patch_preserved["historicalSnapshot"]
    snapshot_status = "NOT_PRESENT"
    if prior_snapshot.exists():
        if archive_tools.sha256(prior_snapshot) != patch_preserved["snapshotSha256"]:
            raise RuntimeError("The archived previous application/register snapshot changed.")
        snapshot_status = "VERIFIED"
    destination_snapshot = load("destination-ux-preservation.json")
    destination_archive = WORKSPACE / destination_snapshot["historicalSnapshot"]
    destination_snapshot_status = "NOT_PRESENT"
    if destination_archive.exists():
        if archive_tools.sha256(destination_archive) != destination_snapshot["snapshotSha256"]:
            raise RuntimeError("The previous destination-patch release snapshot changed.")
        destination_snapshot_status = "VERIFIED"
    parameter_snapshot = load("parameter-help-preservation.json")
    parameter_archive = WORKSPACE / parameter_snapshot["historicalSnapshot"]
    parameter_snapshot_status = "NOT_PRESENT"
    if parameter_archive.exists():
        if archive_tools.sha256(parameter_archive) != parameter_snapshot["snapshotSha256"]:
            raise RuntimeError("The previous parameter-help release snapshot changed.")
        parameter_snapshot_status = "VERIFIED"
    copy_snapshot = load("copy-refresh-preservation.json")
    copy_archive = WORKSPACE / copy_snapshot["historicalSnapshot"]
    copy_snapshot_status = "NOT_PRESENT"
    if copy_archive.exists():
        if archive_tools.sha256(copy_archive) != copy_snapshot["snapshotSha256"]:
            raise RuntimeError("The previous copy-refresh release snapshot changed.")
        copy_snapshot_status = "VERIFIED"
    map_view_snapshot = load("map-view-preservation.json")
    map_view_archive = WORKSPACE / map_view_snapshot["historicalSnapshot"]
    map_view_snapshot_status = "NOT_PRESENT"
    if map_view_archive.exists():
        if archive_tools.sha256(map_view_archive) != map_view_snapshot["snapshotSha256"]:
            raise RuntimeError("The previous map-view release snapshot changed.")
        map_view_snapshot_status = "VERIFIED"
    theme_snapshot = load("theme-preservation.json")
    theme_archive = WORKSPACE / theme_snapshot["historicalSnapshot"]
    theme_snapshot_status = "NOT_PRESENT"
    if theme_archive.exists():
        if archive_tools.sha256(theme_archive) != theme_snapshot["snapshotSha256"]:
            raise RuntimeError("The previous theme-refresh release snapshot changed.")
        theme_snapshot_status = "VERIFIED"
    dawn_snapshot = load("dawn-preservation.json")
    dawn_archive = WORKSPACE / dawn_snapshot["historicalSnapshot"]
    dawn_snapshot_status = "NOT_PRESENT"
    if dawn_archive.exists():
        if archive_tools.sha256(dawn_archive) != dawn_snapshot["snapshotSha256"]:
            raise RuntimeError("The previous Martian Dawn release snapshot changed.")
        dawn_snapshot_status = "VERIFIED"
    science_snapshot = load("science-preservation.json")
    science_archive = WORKSPACE / science_snapshot["historicalSnapshot"]
    science_snapshot_status = "NOT_PRESENT"
    if science_archive.exists():
        if archive_tools.sha256(science_archive) != science_snapshot["snapshotSha256"]:
            raise RuntimeError("The previous science-context release snapshot changed.")
        science_snapshot_status = "VERIFIED"
    export_snapshot = load("export-layout-preservation.json")
    export_archive = WORKSPACE / export_snapshot["historicalSnapshot"]
    export_snapshot_status = "NOT_PRESENT"
    if export_archive.exists():
        if archive_tools.sha256(export_archive) != export_snapshot["snapshotSha256"]:
            raise RuntimeError("The previous export-layout release snapshot changed.")
        export_snapshot_status = "VERIFIED"
    positioning_snapshot = load("differentiation-preservation.json")
    positioning_archive = WORKSPACE / positioning_snapshot["historicalSnapshot"]
    positioning_snapshot_status = "NOT_PRESENT"
    if positioning_archive.exists():
        if archive_tools.sha256(positioning_archive) != positioning_snapshot["snapshotSha256"]:
            raise RuntimeError("The previous positioning release snapshot changed.")
        positioning_snapshot_status = "VERIFIED"
    historical = []
    for relative, expected in preserved.items():
        path = WORKSPACE / relative
        if path.name.startswith("~$"):
            historical.append({"path": relative, "status": "TRANSIENT_OFFICE_LOCK_NOT_CHECKED"})
            continue
        if not path.exists() and relative.startswith(("docs\\", "docs/")):
            historical.append({"path": relative, "status": "NOT_PRESENT"})
            continue
        if archive_tools.sha256(path) != expected:
            raise RuntimeError(f"A protected release or input changed: {relative}")
        historical.append({"path": relative, "status": "UNCHANGED"})
    upload_members = [
        (path, path.relative_to(ROOT / "deploy").as_posix())
        for path in sorted((ROOT / "deploy").rglob("*")) if path.is_file()
    ]
    if not any(name == "index.html" for _, name in upload_members):
        raise RuntimeError("The upload ZIP must have index.html directly at its root.")
    source_members = []
    for path in sorted(ROOT.rglob("*")):
        relative = path.relative_to(ROOT)
        if not path.is_file() or any(part in {"node_modules", "__pycache__", "deploy"} for part in relative.parts) or path.suffix == ".part":
            continue
        source_members.append((path, path.relative_to(WORKSPACE).as_posix()))
    for path in sorted((WORKSPACE / "data" / "homebound" / "web").iterdir()):
        if path.is_file():
            source_members.append((path, path.relative_to(WORKSPACE).as_posix()))
    spatial = WORKSPACE / "data" / "homebound" / "metadata" / "spatial_reference.json"
    source_members.append((spatial, spatial.relative_to(WORKSPACE).as_posix()))
    documents = [
        DOCS / "HOMEBOUND_Application_User_Guide_EN.docx",
        DOCS / "HOMEBOUND_Application_QA_EN.xlsx",
        DOCS / "HOMEBOUND_Application_Deployment_EN.md",
    ]
    for path in documents:
        if not path.is_file():
            raise FileNotFoundError(f"Application documentation is missing: {path}")
        source_members.append((path, path.relative_to(WORKSPACE).as_posix()))
    uploaded = archive_tools.archive(UPLOAD, upload_members)
    sourced = archive_tools.archive(SOURCE, source_members)
    result = {
        "recordedUtc": datetime.now(timezone.utc).isoformat(),
        "applicationVersion": version, "modelVersion": "1.0.0",
        "scenarioPolicy": "Science 20 degrees/120 min remains initial default; Terrain 30 degrees/180 min is explicit, never destination-triggered. Original H/P/S/A/B/C, observation defaults and protected reserve are unchanged.",
        "archives": [uploaded, sourced],
        "documents": [{"filename": path.name, "bytes": path.stat().st_size, "sha256": archive_tools.sha256(path)} for path in documents],
        "technicalCounts": {"unitTests": unit_count, "integrationChecks": len(integration["checks"]), "baselineBrowserChecks": len(browser["checks"]), "layerPatchChecks": len(layers["checks"]), "destinationPatchChecks": len(destination_checks["checks"]), "parameterHelpChecks": len(parameter_checks["checks"]), "customerCopyChecks": len(copy_checks["checks"]), "mapViewChecks": len(map_view_checks["checks"]), "themeChecks": len(theme_checks["checks"]), "martianDawnChecks": len(dawn_checks["checks"]), "scienceContextChecks": len(science_checks["checks"]), "exportLayoutChecks": len(export_checks["checks"]), "positioningChecks": len(positioning_checks["checks"]), "regionalDataChecks": len(regional_data["checks"]), "regionalBrowserChecks": len(regional_browser["checks"]), "planningPresetDataChecks": len(preset_data["checks"]), "planningPresetBrowserChecks": len(preset_browser["checks"]), "staticChecks": len(static["checks"])},
        "verificationScopes": {"currentRelease": version, "currentGroups": ["unitTests", "integrationChecks", "staticChecks", "regionalDataChecks", "planningPresetDataChecks", "planningPresetBrowserChecks"],
                               "historicalBrowserRecords": "Regional browser evidence was captured on 1.1.11; other previous UX/browser records retain their original release scope."},
        "humanUsabilityStudy": "NOT_PERFORMED",
        "scientificValidation": "NOT_PERFORMED",
        "operationalCertification": False,
        "actualRumahwebDeployment": False,
        "historicalPreservation": historical,
        "standaloneSourceRebuild": "Not yet recorded",
        "priorReleaseSnapshot": {**patch_preserved, "snapshotStatusInThisWorkspace": snapshot_status},
        "previousApplicationSnapshot": {**destination_snapshot, "snapshotStatusInThisWorkspace": destination_snapshot_status},
        "parameterHelpPreviousSnapshot": {**parameter_snapshot, "snapshotStatusInThisWorkspace": parameter_snapshot_status},
        "customerCopyPreviousSnapshot": {**copy_snapshot, "snapshotStatusInThisWorkspace": copy_snapshot_status},
        "mapViewPreviousSnapshot": {**map_view_snapshot, "snapshotStatusInThisWorkspace": map_view_snapshot_status},
        "themePreviousSnapshot": {**theme_snapshot, "snapshotStatusInThisWorkspace": theme_snapshot_status},
        "martianDawnPreviousSnapshot": {**dawn_snapshot, "snapshotStatusInThisWorkspace": dawn_snapshot_status},
        "scienceContextPreviousSnapshot": {**science_snapshot, "snapshotStatusInThisWorkspace": science_snapshot_status},
        "exportLayoutPreviousSnapshot": {**export_snapshot, "snapshotStatusInThisWorkspace": export_snapshot_status},
        "positioningPreviousSnapshot": {**positioning_snapshot, "snapshotStatusInThisWorkspace": positioning_snapshot_status},
        "regionalContextPreviousSnapshot": {key: regional_preserved[key] for key in ["previousApplicationVersion", "previousRegisterVersion", "historicalSnapshot", "snapshotSha256"]},
        "planningPresetsPreviousSnapshot": {**{key: preset_preserved[key] for key in ["previousApplicationVersion", "previousRegisterVersion", "historicalSnapshot", "snapshotSha256"]},
                                           "snapshotStatusInThisWorkspace": preset_snapshot_status},
        "unchangedModelAndWebFilesVerified": len(preset_preserved["protectedFiles"]),
        "unchangedCurrentMediaAndReferences": preset_references,
        "sourceCatalogChange": "Historical 1.1.11 addition, unchanged in 1.1.12: the original three records plus a fourth regional-only NASA Mars Trek MGS/MOLA source. All four tile URLs/hashes remain in regional-context.json.",
        "regionalContextVerification": {"data": regional_data, "browser": regional_browser, "browserScope": "Historical 1.1.11"},
        "planningPresetsVerification": {"data": preset_data, "browser": preset_browser},
        "sourceContents": "TypeScript, build/test scripts, evidence, English application documents, and small prepared web inputs. No node_modules, large original terrain files, or historical ZIPs. Missing historical snapshots are reported explicitly by audit:app.",
        "note": "Every ZIP member was CRC/SHA-256 checked. This integrity record does not hash itself.",
    }
    INTEGRITY.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(f"Application upload ZIP: {uploaded['bytes'] / 1048576:.2f} MiB; {uploaded['verified_members']} verified members")
    print(f"Application source ZIP: {sourced['bytes'] / 1048576:.2f} MiB; {sourced['verified_members']} verified members")
    print(f"Integrity: {INTEGRITY}")


def record_source_check(path: Path):
    proof = json.loads(path.read_text(encoding="utf-8"))
    current = json.loads(INTEGRITY.read_text(encoding="utf-8"))
    expected = next(item["sha256"] for item in current["archives"] if item["filename"] == SOURCE.name)
    if proof.get("status") != "PASS" or proof.get("sourceArchiveSha256") != expected or archive_tools.sha256(SOURCE) != expected:
        raise RuntimeError("The standalone-source proof does not match the delivered source archive.")
    current["standaloneSourceRebuild"] = proof
    INTEGRITY.write_text(json.dumps(current, indent=2), encoding="utf-8")
    print("Matching standalone-source rebuild evidence recorded without changing the archives.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Publish new application releases without overwriting historical release archives.")
    parser.add_argument("--replace", action="store_true")
    parser.add_argument("--record-source-check", type=Path)
    args = parser.parse_args()
    if args.record_source_check is not None:
        record_source_check(args.record_source_check)
    else:
        package(replace=args.replace)
