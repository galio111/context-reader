#!/usr/bin/env python3
"""Run with python3 ops/mainland/test-retain-next-static.py (no Docker needed)."""

import importlib.util
import io
from pathlib import Path
import shutil
import tarfile
import tempfile
import unittest
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location("retain", Path(__file__).with_name("retain-next-static.py"))
retain = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(retain)
CHUNK_A = "chunks/6063-fc805f9af6d50219.js"
CHUNK_B = "chunks/6063-aaaaaaaaaaaaaaaa.js"


def archive(entries):
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode="w") as handle:
        for name, content, kind in entries:
            info = tarfile.TarInfo(name)
            info.type = kind
            info.size = len(content) if kind == tarfile.REGTYPE else 0
            if kind in {tarfile.SYMTYPE, tarfile.LNKTYPE}:
                info.linkname = "/etc/passwd"
            handle.addfile(info, io.BytesIO(content) if kind == tarfile.REGTYPE else None)
    stream.seek(0)
    return stream


def regular(files):
    return [(name, content, tarfile.REGTYPE) for name, content in files.items()]


class StaticRetentionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name).resolve()
        self.store = self.root / "next-static"
        self.store.mkdir()
        self.stage_index = 0

    def tearDown(self):
        self.temp.cleanup()

    def stage(self, entries):
        self.stage_index += 1
        staging = self.root / f"stage-{self.stage_index}"
        staging.mkdir()
        files = retain.stage_tar(archive(entries), staging, 0)
        return staging, files

    def publish(self, files, budget=1024 * 1024):
        staging, attributes = self.stage(regular(files))
        return retain.publish(staging, self.store, attributes, budget, 0)

    def test_old_reader_chunk_survives_multiple_releases_and_source_deletion(self):
        self.publish({CHUNK_A: b"old reader", "css/abcd1234.css": b"body{}"})
        self.publish({CHUNK_B: b"new reader", "css/abcd1234.css": b"body{}"})
        self.publish({"chunks/next-cccccccc.js": b"third reader"})
        # Docker images and extraction directories may disappear independently.
        for directory in self.root.glob("stage-*"):
            shutil.rmtree(directory)
        self.assertEqual((self.store / CHUNK_A).read_bytes(), b"old reader")
        self.assertEqual((self.store / CHUNK_B).read_bytes(), b"new reader")
        self.assertEqual(len(retain.inventory(self.store)), 4)

    def test_replay_deduplicates_exact_paths_without_replacing_the_file(self):
        self.publish({CHUNK_A: b"old reader"})
        previous = (self.store / CHUNK_A).stat()
        result = self.publish({CHUNK_A: b"old reader"})
        self.assertEqual(result["addedFiles"], 0)
        self.assertEqual((self.store / CHUNK_A).stat().st_mtime_ns, previous.st_mtime_ns)
        self.assertEqual(result["storeBytes"], len(b"old reader"))

    def test_collision_rejects_entire_source_before_adding_files(self):
        self.publish({CHUNK_A: b"old reader"})
        with self.assertRaisesRegex(retain.RetentionError, "immutable static asset collision"):
            self.publish({CHUNK_B: b"new reader", CHUNK_A: b"different reader"})
        self.assertFalse((self.store / CHUNK_B).exists())
        self.assertEqual((self.store / CHUNK_A).read_bytes(), b"old reader")

    def test_budget_pressure_preserves_old_assets_and_rejects_new_source(self):
        self.publish({CHUNK_A: b"old reader"})
        with self.assertRaisesRegex(retain.RetentionError, "budget exceeded"):
            self.publish({CHUNK_B: b"new reader"}, budget=15)
        self.assertEqual((self.store / CHUNK_A).read_bytes(), b"old reader")
        self.assertFalse((self.store / CHUNK_B).exists())

    def test_free_disk_floor_rejects_publish(self):
        staging, files = self.stage(regular({CHUNK_A: b"old reader"}))
        usage = shutil.disk_usage(self.root)._replace(free=9)
        with patch.object(retain.shutil, "disk_usage", return_value=usage):
            with self.assertRaisesRegex(retain.RetentionError, "free-space floor"):
                retain.publish(staging, self.store, files, 1000, 10)
        self.assertEqual(list(self.store.iterdir()), [])

    def test_free_disk_floor_rejects_staging_before_writing(self):
        usage = shutil.disk_usage(self.root)._replace(free=2)
        with patch.object(retain.shutil, "disk_usage", return_value=usage):
            with self.assertRaisesRegex(retain.RetentionError, "free-space floor"):
                self.stage(regular({CHUNK_A: b"old reader"}))
        self.assertEqual(list((self.root / "stage-1").rglob("*.js")), [])

    def test_archive_traversal_absolute_windows_and_noncanonical_paths_rejected(self):
        for name in ["../secret.js", "/chunks/secret.js", "chunks/../secret.js", "chunks//a.js", "C:/chunks/a.js", "chunks\\a.js", "chunks/%2e%2e/a.js"]:
            with self.subTest(name=name), self.assertRaises(retain.RetentionError):
                self.stage(regular({name: b"bad"}))

    def test_symlink_hardlink_device_and_fifo_archives_rejected(self):
        for kind in [tarfile.SYMTYPE, tarfile.LNKTYPE, tarfile.CHRTYPE, tarfile.BLKTYPE, tarfile.FIFOTYPE]:
            with self.subTest(kind=kind), self.assertRaisesRegex(retain.RetentionError, "non-regular"):
                self.stage([(CHUNK_A, b"", kind)])

    def test_duplicate_archive_path_rejected(self):
        with self.assertRaisesRegex(retain.RetentionError, "duplicate"):
            self.stage(regular({CHUNK_A: b"a"}) + regular({CHUNK_A: b"b"}))

    def test_secrets_source_maps_and_unexpected_namespaces_rejected(self):
        for name in ["chunks/.env", "chunks/page.js.map", "server/app.js", "chunks/page.html", "package.json", "randombuild/server.js"]:
            with self.subTest(name=name), self.assertRaises(retain.RetentionError):
                self.stage(regular({CHUNK_A: b"good", name: b"private"}))

    def test_normal_next_assets_manifests_fonts_and_precompressed_sidecars(self):
        files = {CHUNK_A: b"reader", CHUNK_A + ".br": b"compressed reader",
                 "css/abcd1234.css": b"body{}", "media/font-1234.woff2": b"font",
                 "aBuildId_123/_buildManifest.js": b"manifest",
                 "aBuildId_123/_ssgManifest.js": b"manifest",
                 "chunks/app/(member)/[id]/page-abcdef12.js": b"page"}
        result = self.publish(files)
        self.assertEqual(result["files"], len(files))
        self.assertEqual((self.store / (CHUNK_A + ".br")).read_bytes(), b"compressed reader")

    def test_precompressed_sidecar_without_original_rejected(self):
        with self.assertRaisesRegex(retain.RetentionError, "has no original"):
            self.stage(regular({CHUNK_A: b"reader", CHUNK_B + ".gz": b"orphan"}))

    def test_empty_or_non_chunk_source_rejected(self):
        for files in [{}, {"css/abcd1234.css": b"body{}"}]:
            with self.subTest(files=files), self.assertRaisesRegex(retain.RetentionError, "no Next.js"):
                self.stage(regular(files))

    def test_source_size_limit_rejected(self):
        with patch.object(retain, "MAX_SOURCE_BYTES", 3):
            with self.assertRaisesRegex(retain.RetentionError, "extraction limit"):
                self.stage(regular({CHUNK_A: b"reader"}))

    def test_existing_symlink_cannot_escape_public_root(self):
        outside = self.root / "outside"
        outside.mkdir()
        try:
            (self.store / "chunks").symlink_to(outside, target_is_directory=True)
        except OSError as error:
            self.skipTest(f"host cannot create symlinks: {error}")
        with self.assertRaisesRegex(retain.RetentionError, "non-regular"):
            self.publish({CHUNK_A: b"reader"})
        self.assertEqual(list(outside.iterdir()), [])

    def test_symlink_store_root_rejected(self):
        linked = self.root / "linked"
        try:
            linked.symlink_to(self.store, target_is_directory=True)
        except OSError as error:
            self.skipTest(f"host cannot create symlinks: {error}")
        with self.assertRaisesRegex(retain.RetentionError, "unsafe directory"):
            retain.checked_directory(linked)


if __name__ == "__main__":
    unittest.main(verbosity=2)
