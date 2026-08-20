#!/usr/bin/env python3
"""Build a reviewed Context Reader release archive from a clean Git checkout."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile


RELEASE_ID_PATTERN = re.compile(r"[0-9]{8}T[0-9]{6}")
SOURCE_REVISION_PATTERN = re.compile(r"[0-9a-f]{40}")
IGNORED_EXACT = {
    "ops/mainland/.env",
    "ops/mainland/.env.runtime",
    "ops/mainland/release-manifest.json",
    "tsconfig.tsbuildinfo",
}
IGNORED_ROOTS = {
    ".codex",
    ".git",
    ".next",
    ".next-dev",
    ".npm-cache",
    "node_modules",
    "__pycache__",
}
REQUIRED_CONTRACTS = ["release-lineage-v1", "phonetic-current-form-v1"]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Create a release only when the source is a clean Git commit and its "
            "actual delta exactly matches the reviewed changed-file list."
        )
    )
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--parent", required=True, type=Path)
    parser.add_argument("--release-id", required=True)
    parser.add_argument("--parent-release-id", required=True)
    parser.add_argument("--source-revision", required=True)
    parser.add_argument("--changed-files", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    return parser.parse_args()


def normalized_relative(path: Path, root: Path) -> str:
    return path.relative_to(root).as_posix()


def ignored(relative: str) -> bool:
    return relative in IGNORED_EXACT or any(
        part in IGNORED_ROOTS for part in PurePosixPath(relative).parts
    )


def file_fingerprint(path: Path) -> str:
    if path.is_symlink():
        return "link:" + os.readlink(path)
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def inventory(root: Path) -> dict[str, str]:
    result: dict[str, str] = {}
    for dirpath, dirnames, filenames in os.walk(root):
        directory = Path(dirpath)
        relative_directory = directory.relative_to(root)
        dirnames[:] = [
            name
            for name in dirnames
            if not ignored((relative_directory / name).as_posix())
        ]
        for filename in filenames:
            path = directory / filename
            relative = normalized_relative(path, root)
            if ignored(relative):
                continue
            result[relative] = file_fingerprint(path)
    return result


def read_changed_files(path: Path) -> list[str]:
    with path.open(encoding="utf-8") as handle:
        raw = json.load(handle)
    if not isinstance(raw, list) or not raw:
        raise SystemExit("changed-files must be a non-empty JSON array")
    changed: list[str] = []
    for item in raw:
        if not isinstance(item, str) or not item:
            raise SystemExit("every changed-files entry must be a non-empty string")
        normalized = PurePosixPath(item)
        if normalized.is_absolute() or ".." in normalized.parts or item != normalized.as_posix():
            raise SystemExit(f"unsafe or non-normalized changed-files entry: {item}")
        if ignored(item):
            raise SystemExit(f"changed-files may not include generated or secret paths: {item}")
        changed.append(item)
    if len(changed) != len(set(changed)):
        raise SystemExit("changed-files contains duplicates")
    return sorted(changed)


def git_output(source: Path, *args: str) -> str:
    try:
        completed = subprocess.run(
            ["git", "-C", str(source), *args],
            check=True,
            capture_output=True,
            text=True,
        )
    except (FileNotFoundError, subprocess.CalledProcessError) as error:
        detail = getattr(error, "stderr", "") or str(error)
        raise SystemExit(f"source is not a usable Git checkout: {detail.strip()}") from error
    return completed.stdout.strip()


def verify_clean_revision(source: Path, revision: str) -> None:
    head = git_output(source, "rev-parse", "HEAD")
    if head != revision:
        raise SystemExit(f"source revision mismatch: expected {revision}, checkout is {head}")
    dirty = git_output(source, "status", "--porcelain", "--untracked-files=all")
    if dirty:
        preview = "\n".join(dirty.splitlines()[:20])
        raise SystemExit("release source is not clean; commit or remove every change:\n" + preview)


def copy_release_tree(source: Path, staging: Path) -> None:
    for dirpath, dirnames, filenames in os.walk(source):
        directory = Path(dirpath)
        relative_directory = directory.relative_to(source)
        dirnames[:] = [
            name
            for name in dirnames
            if not ignored((relative_directory / name).as_posix())
        ]
        target_directory = staging / relative_directory
        target_directory.mkdir(parents=True, exist_ok=True)
        for filename in filenames:
            source_path = directory / filename
            relative = normalized_relative(source_path, source)
            if ignored(relative):
                continue
            target_path = staging / relative
            target_path.parent.mkdir(parents=True, exist_ok=True)
            if source_path.is_symlink():
                target_path.symlink_to(os.readlink(source_path))
            else:
                shutil.copy2(source_path, target_path)


def main() -> None:
    args = parse_args()
    source = args.source.resolve(strict=True)
    parent = args.parent.resolve(strict=True)
    output = args.output.resolve()
    changed_files_path = args.changed_files.resolve(strict=True)

    if not source.is_dir() or not parent.is_dir():
        raise SystemExit("source and parent must both be directories")
    if not RELEASE_ID_PATTERN.fullmatch(args.release_id):
        raise SystemExit("release-id must use YYYYMMDDTHHMMSS")
    if not RELEASE_ID_PATTERN.fullmatch(args.parent_release_id):
        raise SystemExit("parent-release-id must use YYYYMMDDTHHMMSS")
    if args.release_id == args.parent_release_id:
        raise SystemExit("release-id must differ from parent-release-id")
    if not SOURCE_REVISION_PATTERN.fullmatch(args.source_revision):
        raise SystemExit("source-revision must be a full lowercase 40-character Git commit")
    if source == parent or source in output.parents:
        raise SystemExit("output must not be inside the source checkout")

    verify_clean_revision(source, args.source_revision)
    declared = read_changed_files(changed_files_path)
    parent_files = inventory(parent)
    source_files = inventory(source)
    actual = sorted(
        path
        for path in set(parent_files) | set(source_files)
        if parent_files.get(path) != source_files.get(path)
    )
    if actual != declared:
        missing = sorted(set(actual) - set(declared))
        extra = sorted(set(declared) - set(actual))
        if missing:
            print("unreviewed source changes: " + ", ".join(missing), file=sys.stderr)
        if extra:
            print("declared files without a source change: " + ", ".join(extra), file=sys.stderr)
        raise SystemExit(76)

    manifest = {
        "schemaVersion": 1,
        "releaseId": args.release_id,
        "parentReleaseId": args.parent_release_id,
        "sourceRevision": args.source_revision,
        "guardVersion": 1,
        "requiredContracts": REQUIRED_CONTRACTS,
        "changedFiles": declared,
    }

    output.parent.mkdir(parents=True, exist_ok=True)
    if output.exists():
        raise SystemExit(f"refusing to overwrite existing archive: {output}")
    with tempfile.TemporaryDirectory(prefix="context-reader-release-") as temporary:
        staging = Path(temporary) / "release"
        staging.mkdir()
        copy_release_tree(source, staging)
        manifest_path = staging / "ops/mainland/release-manifest.json"
        manifest_path.parent.mkdir(parents=True, exist_ok=True)
        manifest_path.write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        with tarfile.open(output, "w:gz", compresslevel=9) as archive:
            for path in sorted(staging.rglob("*")):
                archive.add(path, arcname="./" + path.relative_to(staging).as_posix(), recursive=False)

    print(f"created {output}")
    print(f"parent={args.parent_release_id} source={args.source_revision} files={len(declared)}")


if __name__ == "__main__":
    main()
