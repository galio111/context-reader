#!/usr/bin/env python3
"""Append validated Next.js public build assets; never overwrite or expire them."""

from __future__ import annotations

import argparse
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile


STATIC_ASSET_CONTRACT = "static-asset-retention-v1"
DEFAULT_STORE = Path("/opt/context-reader-shared/next-static")
DEFAULT_MAX_BYTES = 1024 * 1024 * 1024
DEFAULT_MIN_FREE_BYTES = 1024 * 1024 * 1024
MAX_SOURCE_BYTES = 256 * 1024 * 1024
MAX_FILES = 20000
IMAGE_PATTERN = re.compile(r"context-reader-app:(?:accepted|candidate)-[0-9]{8}T[0-9]{6}")
COMPONENT_PATTERN = re.compile(r"[A-Za-z0-9_@()+,\[\]-][A-Za-z0-9_@()+.,\[\]-]*")
PUBLIC_EXTENSIONS = {".js", ".css", ".woff", ".woff2", ".ttf", ".otf", ".eot", ".svg", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".ico", ".wasm"}
COMPRESSED_EXTENSIONS = {".gz", ".br", ".zst"}


class RetentionError(RuntimeError):
    pass


def checked_directory(path: Path) -> None:
    """The public root and all its ancestors must be real directories."""
    if not path.is_absolute():
        raise RetentionError(f"directory must be absolute: {path}")
    for parent in reversed((path, *path.parents)):
        if parent.is_symlink() or (parent.exists() and not parent.is_dir()):
            raise RetentionError(f"unsafe directory: {parent}")
    path.mkdir(parents=True, exist_ok=True, mode=0o755)


def asset_path(raw: str, directory: bool = False) -> str:
    name = raw[2:] if raw.startswith("./") else raw
    if directory:
        name = name.rstrip("/")
        if name in {"", "."}:
            return ""
    path = PurePosixPath(name)
    if (not name or path.is_absolute() or ".." in path.parts
            or name != path.as_posix() or len(name) > 1024
            or any(not COMPONENT_PATTERN.fullmatch(part) for part in path.parts)):
        raise RetentionError(f"unsafe static asset path: {raw}")
    if directory:
        return name
    if len(path.parts) < 2:
        raise RetentionError(f"asset outside a public build directory: {raw}")
    base = path.with_suffix("") if path.suffix in COMPRESSED_EXTENSIONS else path
    if base.suffix not in PUBLIC_EXTENSIONS:
        raise RetentionError(f"non-public static asset extension: {raw}")
    if path.parts[0] not in {"chunks", "css", "media"}:
        if (len(path.parts) != 2 or not re.fullmatch(r"[A-Za-z0-9_-]{8,}", path.parts[0])
                or base.name not in {"_buildManifest.js", "_ssgManifest.js"}):
            raise RetentionError(f"asset outside allowed Next.js build paths: {raw}")
    return name


def fingerprint(path: Path) -> str:
    with path.open("rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()


def inventory(root: Path) -> dict[str, tuple[int, str]]:
    result = {}
    for directory, directories, files in os.walk(root, followlinks=False):
        for name in directories + files:
            path = Path(directory) / name
            mode = path.lstat().st_mode
            if not (stat.S_ISREG(mode) or stat.S_ISDIR(mode)):
                raise RetentionError(f"non-regular entry in static store: {path}")
        for name in files:
            path = Path(directory) / name
            relative = asset_path(path.relative_to(root).as_posix())
            result[relative] = (path.stat().st_size, fingerprint(path))
    return result


def stage_tar(stream, staging: Path, min_free_bytes: int) -> dict[str, tuple[int, str]]:
    """Read a Docker cp tar without tar extraction or trusting archive metadata."""
    files = {}
    total = 0
    entries = 0
    with tarfile.open(fileobj=stream, mode="r|*") as archive:
        for member in archive:
            entries += 1
            if entries > MAX_FILES:
                raise RetentionError("too many static asset archive entries")
            if not (member.isdir() or member.isfile()) or member.issparse():
                raise RetentionError(f"non-regular static asset archive entry: {member.name}")
            relative = asset_path(member.name, directory=member.isdir())
            if member.isdir():
                continue
            if relative in files:
                raise RetentionError(f"duplicate static asset archive entry: {relative}")
            total += member.size
            if member.size < 0 or total > MAX_SOURCE_BYTES:
                raise RetentionError("static asset source exceeds the 256 MiB extraction limit")
            if shutil.disk_usage(staging).free - member.size < min_free_bytes:
                raise RetentionError("static asset staging would breach the free-space floor; increase disk capacity")
            target = staging / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            source = archive.extractfile(member)
            if source is None:
                raise RetentionError(f"static asset contents unavailable: {relative}")
            with source, target.open("xb") as output:
                shutil.copyfileobj(source, output, length=1024 * 1024)
            if target.stat().st_size != member.size:
                raise RetentionError(f"truncated static asset: {relative}")
            files[relative] = (member.size, fingerprint(target))
    if not files or not any(name.startswith("chunks/") and name.endswith(".js") for name in files):
        raise RetentionError("source contains no Next.js JavaScript chunks")
    for relative in files:
        path = PurePosixPath(relative)
        if path.suffix in COMPRESSED_EXTENSIONS and path.with_suffix("").as_posix() not in files:
            raise RetentionError(f"compressed asset has no original file: {relative}")
    return files


def publish(staging: Path, store: Path, files: dict[str, tuple[int, str]],
            max_bytes: int, min_free_bytes: int) -> dict[str, int]:
    checked_directory(store)
    existing = inventory(store)
    for relative, attributes in files.items():
        if relative in existing and existing[relative] != attributes:
            raise RetentionError(f"immutable static asset collision: {relative}; current bytes were preserved")
        # Also reject file/directory conflicts before adding any asset.
        target = store / relative
        for parent in target.parents:
            if parent == store:
                break
            if parent.exists() and not parent.is_dir():
                raise RetentionError(f"static asset directory collision: {parent}")
        if target.exists() and not target.is_file():
            raise RetentionError(f"static asset file collision: {relative}")
    additions = {name: attributes for name, attributes in files.items() if name not in existing}
    total = sum(item[0] for item in existing.values()) + sum(item[0] for item in additions.values())
    if total > max_bytes:
        raise RetentionError(f"static asset retention budget exceeded: {total} > {max_bytes} bytes; expand capacity, never prune open-tab assets")
    if shutil.disk_usage(store).free < min_free_bytes:
        raise RetentionError("static asset retention free-space floor breached; deployment must not cut over")
    for relative in sorted(additions):
        target = store / relative
        target.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
        source = staging / relative
        source.chmod(0o644)
        # Staging is on this filesystem. link() is atomic and cannot overwrite.
        os.link(source, target)
    return {"files": len(files), "addedFiles": len(additions), "storeBytes": total}


def retain_image(image: str, store: Path, max_bytes: int, min_free_bytes: int) -> dict:
    if not IMAGE_PATTERN.fullmatch(image):
        raise RetentionError(f"expected a versioned accepted/candidate application image: {image}")
    image_id = subprocess.check_output(["docker", "image", "inspect", "--format", "{{.Id}}", image], text=True).strip()
    # Creating does not execute the image or mount any production data/secrets.
    container = subprocess.check_output(["docker", "create", "--network", "none", "--entrypoint", "/bin/true", image_id], text=True).strip()
    try:
        with tempfile.TemporaryDirectory(prefix=".next-static-stage-", dir=store.parent) as directory:
            staging = Path(directory)
            process = subprocess.Popen(["docker", "cp", f"{container}:/app/.next/static/.", "-"], stdout=subprocess.PIPE)
            try:
                files = stage_tar(process.stdout, staging, min_free_bytes)
                process.stdout.close()
                if process.wait() != 0:
                    raise RetentionError(f"could not read public static assets from {image}")
            finally:
                if process.poll() is None:
                    process.kill()
                    process.wait()
                process.stdout.close()
            result = publish(staging, store, files, max_bytes, min_free_bytes)
            metadata = store.parent / "next-static-manifests"
            checked_directory(metadata)
            manifest = {"contract": STATIC_ASSET_CONTRACT, "image": image, "imageId": image_id,
                        "files": {name: {"bytes": size, "sha256": digest} for name, (size, digest) in sorted(files.items())}}
            with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=metadata, delete=False) as output:
                json.dump(manifest, output, sort_keys=True)
                output.write("\n")
                manifest_temp = Path(output.name)
            os.replace(manifest_temp, metadata / (image.split(":", 1)[1] + ".json"))
            return {"image": image, "imageId": image_id, **result}
    finally:
        subprocess.run(["docker", "rm", container], check=True, stdout=subprocess.DEVNULL)


@contextmanager
def exclusive_store_lock():
    # Separate from the outer deploy lock, so manual reviewed seeding is safe too.
    import fcntl
    with open("/var/lock/context-reader-next-static.lock", "a") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        yield


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", action="append", required=True)
    parser.add_argument("--store", type=Path, default=DEFAULT_STORE)
    parser.add_argument("--max-bytes", type=int, default=DEFAULT_MAX_BYTES)
    parser.add_argument("--min-free-bytes", type=int, default=DEFAULT_MIN_FREE_BYTES)
    args = parser.parse_args()
    if args.max_bytes <= 0 or args.min_free_bytes < 0:
        parser.error("retention budget must be positive and free-space floor cannot be negative")
    with exclusive_store_lock():
        checked_directory(args.store)
        for image in args.image:
            print(json.dumps(retain_image(image, args.store, args.max_bytes, args.min_free_bytes)), flush=True)


if __name__ == "__main__":
    try:
        main()
    except (RetentionError, OSError, tarfile.TarError, subprocess.CalledProcessError) as error:
        print(f"static asset retention failed: {error}", file=sys.stderr)
        raise SystemExit(1)
