#!/usr/bin/env python3
"""Install site SMTP values from stdin without exposing them in process arguments."""

from __future__ import annotations

import argparse
import json
import os
import tempfile
from pathlib import Path


ALLOWED_KEYS = {
    "SITE_NOTIFICATION_EMAIL_TO",
    "SITE_SMTP_HOST",
    "SITE_SMTP_PORT",
    "SITE_SMTP_USER",
    "SITE_SMTP_PASSWORD",
    "SITE_SMTP_FROM",
}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--env", required=True, type=Path)
    args = parser.parse_args()

    payload = json.loads(os.sys.stdin.buffer.read().decode("utf-8-sig"))
    if not isinstance(payload, dict) or set(payload) != ALLOWED_KEYS:
        raise SystemExit("site email payload has unexpected keys")
    values = {key: str(payload[key]).strip() for key in ALLOWED_KEYS}
    if not all(values.values()) or values["SITE_SMTP_PORT"] != "465":
        raise SystemExit("site email payload is incomplete")
    if "\n" in "".join(values.values()) or "\r" in "".join(values.values()):
        raise SystemExit("site email payload contains a newline")

    original = args.env.read_text(encoding="utf-8").splitlines()
    retained = [line for line in original if line.split("=", 1)[0].strip() not in ALLOWED_KEYS]
    rendered = retained + [f"{key}={json.dumps(values[key], ensure_ascii=False)}" for key in sorted(ALLOWED_KEYS)]

    args.env.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix=".env.runtime.", dir=args.env.parent, text=True)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as handle:
            handle.write("\n".join(rendered).rstrip() + "\n")
        os.chmod(temporary_name, 0o600)
        os.replace(temporary_name, args.env)
    finally:
        if os.path.exists(temporary_name):
            os.unlink(temporary_name)

    print("site email configuration installed with mode 600")


if __name__ == "__main__":
    main()
