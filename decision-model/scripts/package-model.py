from __future__ import annotations

import argparse
import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parents[1]
WORKSPACE = ROOT.parent
DOCS = WORKSPACE / "docs"
UPLOAD = DOCS / "HOMEBOUND_Rumahweb_Upload.zip"
SOURCE = DOCS / "HOMEBOUND_Decision_Model_Source.zip"


def sha256(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def archive(destination: Path, members: list[tuple[Path, str]]) -> dict:
    temporary = destination.with_name(destination.name + ".part")
    hashes = {name: sha256(path) for path, name in members}
    if len(hashes) != len(members):
        raise RuntimeError("Archive paths collide.")
    with ZipFile(temporary, "w", compression=ZIP_DEFLATED, compresslevel=6) as output:
        for path, name in members:
            output.write(path, name)
    with ZipFile(temporary) as output:
        if len(output.infolist()) != len(hashes):
            raise RuntimeError("Archive member count differs from the intended manifest.")
        for item in output.infolist():
            value = hashlib.sha256()
            with output.open(item) as stream:
                for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                    value.update(chunk)
            if value.hexdigest() != hashes[item.filename]:
                raise RuntimeError(f"Archive member mismatch: {item.filename}")
    os.replace(temporary, destination)
    return {
        "filename": destination.name,
        "bytes": destination.stat().st_size,
        "sha256": sha256(destination),
        "verified_members": len(members),
        "validation": "Every ZIP member read to EOF (CRC checked) and its SHA-256 compared with the source file.",
    }


def package(*, replace=False):
    if not replace and (UPLOAD.exists() or SOURCE.exists()):
        raise FileExistsError("Model delivery archives already exist; use --replace for deliberate regeneration.")
    deployment = json.loads((ROOT / "evidence" / "deployment-checks.json").read_text())
    audit = json.loads((ROOT / "evidence" / "model-audit.json").read_text())
    browser = json.loads((ROOT / "evidence" / "browser-checks.json").read_text())
    if any(check["status"] != "PASS" for check in deployment["checks"] + audit["validations"] + browser["checks"]):
        raise RuntimeError("A required delivery check did not pass.")
    upload_members = [
        (path, path.relative_to(ROOT / "deploy").as_posix())
        for path in sorted((ROOT / "deploy").rglob("*")) if path.is_file()
    ]
    if not any(name == "index.html" for _, name in upload_members):
        raise RuntimeError("Upload archive must have index.html directly at its root.")
    source_members = []
    for path in sorted(ROOT.rglob("*")):
        relative = path.relative_to(ROOT)
        if not path.is_file() or any(part in {"node_modules", "__pycache__", "deploy"} for part in relative.parts) or path.suffix == ".part":
            continue
        source_members.append((path, path.relative_to(WORKSPACE).as_posix()))
    for path in sorted((WORKSPACE / "data" / "homebound" / "web").iterdir()):
        if path.is_file():
            source_members.append((path, path.relative_to(WORKSPACE).as_posix()))
    documents = [
        DOCS / "HOMEBOUND_Decision_Model_Report_EN.docx",
        DOCS / "HOMEBOUND_Decision_Model_Results_EN.xlsx",
        DOCS / "HOMEBOUND_Rumahweb_Deployment_Guide_EN.md",
    ]
    for path in documents:
        if not path.is_file():
            raise FileNotFoundError(f"Required model documentation missing: {path}")
        source_members.append((path, path.relative_to(WORKSPACE).as_posix()))
    uploaded = archive(UPLOAD, upload_members)
    sourced = archive(SOURCE, source_members)
    integrity = {
        "recorded_utc": datetime.now(timezone.utc).isoformat(),
        "model_version": "1.0.0",
        "purpose": "PRE_EVENT_RESEARCH_PROTOTYPE",
        "actual_rumahweb_deployment_performed": False,
        "operational_safety_certification": False,
        "archives": [uploaded, sourced],
        "documents": [{"filename": path.name, "bytes": path.stat().st_size, "sha256": sha256(path)} for path in documents],
        "nominal_target_statuses": {result["targetId"]: result["status"] for result in audit["nominalResults"]},
        "counts": {"unit_tests": 41, "real_data_audit_checks": len(audit["validations"]), "sensitivity_records": len(audit["sensitivity"]), "browser_checks": len(browser["checks"]), "static_checks": len(deployment["checks"])},
        "note": "The upload ZIP contains only static production files. The source ZIP contains TypeScript, tests, executed evidence, English documents, and the small prepared web inputs, not the 600+ MB original terrain downloads or node_modules. This integrity record does not hash itself.",
    }
    (DOCS / "HOMEBOUND_Decision_Model_Delivery_Integrity.json").write_text(json.dumps(integrity, indent=2), encoding="utf-8")
    print(f"Upload ZIP: {UPLOAD} | {uploaded['bytes'] / 1048576:.2f} MiB | {uploaded['verified_members']} verified members")
    print(f"Source ZIP: {SOURCE} | {sourced['bytes'] / 1048576:.2f} MiB | {sourced['verified_members']} verified members")
    print("Final model delivery integrity record written.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Package the verified static upload and complete model source handoff.")
    parser.add_argument("--replace", action="store_true")
    args = parser.parse_args()
    package(replace=args.replace)
