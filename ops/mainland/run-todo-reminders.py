#!/usr/bin/env python3
"""Trigger the owner reminder tick. --check only inspects the backend and never sends."""
import argparse
import json
import pathlib
import urllib.error
import urllib.request


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--env", type=pathlib.Path, required=True)
    parser.add_argument("--base-url", default="https://context-reader.com")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    token = ""
    for line in args.env.read_text(encoding="utf-8").splitlines():
        name, sep, value = line.strip().partition("=")
        if sep and name == "CRON_SECRET":
            token = value.strip().strip("'\"")
            break
    if not token:
        raise SystemExit("CRON_SECRET is missing")
    endpoint = args.base_url.rstrip("/") + "/api/cron/todo-reminders"
    if args.check:
        endpoint += "?check=1"
    request = urllib.request.Request(endpoint, headers={"Authorization": "Bearer " + token})
    try:
        with urllib.request.urlopen(request, timeout=105) as response:
            result = json.load(response)
    except urllib.error.HTTPError as error:
        raise SystemExit("Reminder endpoint returned HTTP " + str(error.code)) from None
    if result.get("ok") is not True:
        raise SystemExit("Reminder endpoint failed")
    if args.check:
        print("workspace ready; SMTP configured:", bool(result.get("smtpConfigured")))
        if not result.get("smtpConfigured"):
            raise SystemExit("SMTP transport not configured")
    elif any(result.get(key) for key in ("sent", "retry", "uncertain")):
        print("Reminder deliveries:", {key: result.get(key, 0) for key in ("sent", "retry", "uncertain")})


if __name__ == "__main__":
    main()
