#!/usr/bin/env python3
"""Verify the recovery Admin surface without printing credentials."""

from __future__ import annotations

import argparse
import json
import urllib.error
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
    parser.add_argument(
        "--test-recommendation-email",
        action="store_true",
        help="Send one recommendation email test through the authenticated Admin API.",
    )
    args = parser.parse_args()

    password = read_env(args.env).get("ADMIN_PASSWORD", "")
    if not password:
        raise SystemExit("ADMIN_PASSWORD is missing")

    base_url = args.base_url.rstrip("/")
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(CookieJar()))

    payload = json.dumps({"password": password}).encode("utf-8")
    login_request = urllib.request.Request(
        f"{base_url}/api/admin/login",
        data=payload,
        headers={"Content-Type": "application/json", "Origin": base_url},
        method="POST",
    )
    with opener.open(login_request, timeout=15) as response:
        if response.status != 200:
            raise SystemExit(f"admin login returned {response.status}")

    checks = [
        ("session", "/api/admin/session"),
        ("accounts", "/api/admin/accounts"),
        ("public_articles", "/api/admin/public-articles"),
        ("recommendation_automation", "/api/admin/article-crawler"),
    ]
    results: dict[str, int] = {}
    recommendation_payload: dict[str, object] | None = None
    for name, route in checks:
        request = urllib.request.Request(f"{base_url}{route}")
        try:
            with opener.open(request, timeout=20) as response:
                results[name] = response.status
                if name == "recommendation_automation":
                    recommendation_payload = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            results[name] = error.code

    if any(status != 200 for status in results.values()):
        raise SystemExit(json.dumps({"status": "failed", "checks": results}))

    automation = (recommendation_payload or {}).get("automation")
    if not isinstance(automation, dict):
        raise SystemExit("recommendation automation payload is missing")
    config = automation.get("config")
    if not isinstance(config, dict):
        raise SystemExit("recommendation automation config is missing")
    expected = {"enabled": True, "runTime": "03:00", "maxNewArticles": 2}
    for key, value in expected.items():
        if config.get(key) != value:
            raise SystemExit(
                json.dumps(
                    {
                        "status": "failed",
                        "reason": "unexpected recommendation config",
                        "key": key,
                        "expected": value,
                        "actual": config.get(key),
                    }
                )
            )
    if automation.get("emailConfigured") is not True:
        raise SystemExit("recommendation notification email is not configured")

    if args.test_recommendation_email:
        email_request = urllib.request.Request(
            f"{base_url}/api/admin/article-crawler",
            data=json.dumps({"action": "test_email"}).encode("utf-8"),
            headers={"Content-Type": "application/json", "Origin": base_url},
            method="POST",
        )
        with opener.open(email_request, timeout=30) as response:
            email_payload = json.loads(response.read().decode("utf-8"))
            results["recommendation_email"] = response.status
        if results["recommendation_email"] != 200 or email_payload.get("emailStatus") != "sent":
            raise SystemExit(
                json.dumps(
                    {
                        "status": "failed",
                        "checks": results,
                        "emailStatus": email_payload.get("emailStatus"),
                    }
                )
            )
    print(json.dumps({"status": "passed", "checks": results}))


if __name__ == "__main__":
    main()
