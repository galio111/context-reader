#!/usr/bin/env python3
"""Verify real Caddy delivery against retained public asset bytes, without credentials."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import urllib.error
import urllib.request


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--store", type=Path, default=Path("/opt/context-reader-shared/next-static"))
    parser.add_argument("--asset", action="append", required=True)
    args = parser.parse_args()
    results = []

    def request(path, method="GET", encoding="identity", extra=None):
        headers = {"Accept-Encoding": encoding, **(extra or {})}
        req = urllib.request.Request(args.base_url.rstrip("/") + "/_next/static/" + path,
                                     method=method, headers=headers)
        try:
            response = urllib.request.urlopen(req, timeout=20)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.status, response.headers, response.read()

    for asset in args.asset:
        source = (args.store / asset).resolve()
        assert source.is_relative_to(args.store.resolve()), "asset escaped store"
        expected = source.read_bytes()
        status, headers, body = request(asset)
        assert status == 200 and body == expected, (asset, status, "bytes differ")
        assert "immutable" in headers.get("Cache-Control", ""), dict(headers)
        expected_type = "javascript" if asset.endswith(".js") else "css"
        assert expected_type in headers.get("Content-Type", ""), dict(headers)
        assert headers.get("X-Content-Type-Options") == "nosniff"
        digest = hashlib.sha256(body).hexdigest()
        head_status, head_headers, head_body = request(asset, "HEAD")
        assert head_status == 200 and not head_body
        assert int(head_headers["Content-Length"]) == len(expected)
        conditional_status, conditional_headers, conditional_body = request(asset, extra={"If-None-Match": headers["ETag"]})
        assert conditional_status == 304 and not conditional_body
        assert "immutable" in conditional_headers.get("Cache-Control", "")
        compressed_status, compressed_headers, compressed_body = request(asset, encoding="gzip")
        assert compressed_status == 200 and compressed_headers.get("Content-Encoding") == "gzip"
        assert gzip.decompress(compressed_body) == expected
        assert expected_type in compressed_headers.get("Content-Type", "")
        assert "Content-Range" not in compressed_headers
        # Caddy 2.10.2 precompressed sidecars incorrectly generate 206 for full
        # responses. Until that gateway is upgraded, negotiate gzip/zstd or raw.
        br_status, br_headers, br_body = request(asset, encoding="br")
        assert br_status == 200 and not br_headers.get("Content-Encoding") and br_body == expected
        range_status, range_headers, range_body = request(asset, extra={"Range": "bytes=0-7"})
        assert range_status == 206 and range_body == expected[:8]
        assert range_headers["Content-Range"] == f"bytes 0-7/{len(expected)}"
        results.append({"asset": asset, "status": status, "sha256": digest, "bytes": len(body), "head": head_status, "conditional": conditional_status, "gzip": compressed_status, "brFallback": br_status, "range": range_status})

    for path, method, expected_status in [
        ("chunks/release-safety-definitely-missing.js", "GET", 404),
        ("chunks/", "GET", 404),
        (args.asset[0], "POST", 405),
    ]:
        status, headers, body = request(path, method)
        assert status == expected_status, (path, status)
        assert "immutable" not in headers.get("Cache-Control", ""), dict(headers)
        assert b"<!DOCTYPE html" not in body and b"__next" not in body
        results.append({"asset": path, "method": method, "status": status, "cacheControl": headers.get("Cache-Control", "")})
    print(json.dumps({"passed": True, "baseUrl": args.base_url, "checks": results}, indent=2))


if __name__ == "__main__":
    main()
