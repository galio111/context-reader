#!/usr/bin/env python3
"""Trigger the mainland recommendation crawler without exposing CRON_SECRET."""

from __future__ import annotations

import argparse
import json
import urllib.error
import urllib.request
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
    parser.add_argument("--check-config", action="store_true")
    args = parser.parse_args()

    secret = read_env(args.env).get("CRON_SECRET", "")
    if not secret:
        raise SystemExit("CRON_SECRET is missing")
    if args.check_config:
        print("recommendation schedule configuration passed")
        return

    base_url = args.base_url.rstrip("/")
    request = urllib.request.Request(
        f"{base_url}/api/cron/recommendations",
        headers={"Authorization": f"Bearer {secret}"},
        method="GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=880) as response:
            payload = json.loads(response.read().decode("utf-8"))
            if response.status != 200 or not payload.get("ok"):
                raise SystemExit(f"recommendation crawler returned {response.status}")
    except urllib.error.HTTPError as error:
        raise SystemExit(f"recommendation crawler returned {error.code}") from error

    if payload.get("skipped"):
        return
    result = payload.get("result", {})
    if result.get("targetAchieved") is False:
        raise SystemExit(
            f"recommendation crawler exhausted candidates with shortfall={result.get('shortfall', 0)}"
        )
    print(
        json.dumps(
            {
                "status": "passed",
                "topic": result.get("topic"),
                "created": len(result.get("created", [])),
                "inventory_after": result.get("inventoryAfter"),
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
