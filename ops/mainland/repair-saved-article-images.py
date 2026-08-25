#!/usr/bin/env python3
"""Localize external images stored inside synced saved articles."""

from __future__ import annotations

import argparse
import json
import urllib.request
from http.cookiejar import CookieJar
from pathlib import Path


def read_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        values[key.strip()] = value
    return values


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--env", required=True, type=Path)
    parser.add_argument("--base-url", required=True)
    args = parser.parse_args()

    password = read_env(args.env).get("ADMIN_PASSWORD", "")
    if not password:
        raise SystemExit("ADMIN_PASSWORD is missing")

    base_url = args.base_url.rstrip("/")
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(CookieJar()))
    login_request = urllib.request.Request(
        f"{base_url}/api/admin/login",
        data=json.dumps({"password": password}).encode("utf-8"),
        headers={"Content-Type": "application/json", "Origin": base_url},
        method="POST",
    )
    with opener.open(login_request, timeout=20) as response:
        if response.status != 200:
            raise SystemExit(f"admin login returned {response.status}")

    repair_request = urllib.request.Request(
        f"{base_url}/api/admin/saved-article-images",
        data=b"{}",
        headers={"Content-Type": "application/json", "Origin": base_url},
        method="PATCH",
    )
    with opener.open(repair_request, timeout=1800) as response:
        payload = json.loads(response.read().decode("utf-8"))
    result = payload.get("result", {})
    summary = {
        "scanned": result.get("scanned", 0),
        "eligible": result.get("eligible", 0),
        "updated": len(result.get("updated", [])),
        "localizedImages": sum(item.get("localizedImages", 0) for item in result.get("updated", [])),
        "skipped": result.get("skipped", 0),
        "failed": result.get("failed", []),
    }
    print(json.dumps(summary, ensure_ascii=False))
    if result.get("failed"):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
