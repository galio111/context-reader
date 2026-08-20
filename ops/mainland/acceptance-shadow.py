#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import secrets
import sys
import time
import urllib.error
import urllib.request


BASE_URL = "http://127.0.0.1:8080"


def request(path: str, *, method: str = "GET", body=None, cookie: str = ""):
    data = None if body is None else json.dumps(body).encode("utf-8")
    headers = {"Accept": "application/json"}
    if data is not None:
        headers["Content-Type"] = "application/json"
    if cookie:
        headers["Cookie"] = cookie
    req = urllib.request.Request(BASE_URL + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            payload = json.loads(response.read().decode("utf-8"))
            cookies = response.headers.get_all("Set-Cookie") or []
            return response.status, payload, cookies
    except urllib.error.HTTPError as error:
        raw = error.read().decode("utf-8")
        raise RuntimeError(f"{method} {path} failed with {error.code}: {raw[:500]}") from error


def cookie_header(set_cookie_values: list[str]) -> str:
    return "; ".join(value.split(";", 1)[0] for value in set_cookie_values)


parser = argparse.ArgumentParser()
parser.add_argument("--base-url", default=BASE_URL)
args = parser.parse_args()
BASE_URL = args.base_url.rstrip("/")

suffix = str(int(time.time()))[-8:]
phone = "199" + suffix
pin = f"{secrets.randbelow(1_000_000):06d}"

status, registered, set_cookies = request(
    "/api/auth/phone-register",
    method="POST",
    body={"phone": phone, "nickname": "迁移验收账号", "pin": pin},
)
cookie = cookie_header(set_cookies)
account_id = registered.get("account", {}).get("profile", {}).get("userId")
if status != 200 or not cookie or not account_id:
    raise RuntimeError("registration did not return a working session")

status, session, _ = request("/api/auth/session", cookie=cookie)
if status != 200 or session.get("account", {}).get("profile", {}).get("userId") != account_id:
    raise RuntimeError("registered session was not readable")

now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
status, sync_write, _ = request(
    "/api/account/sync",
    method="POST",
    cookie=cookie,
    body={
        "objects": [
            {
                "kind": "preferences",
                "objectKey": "migration-acceptance",
                "payload": {"passed": True},
                "clientUpdatedAt": now,
                "serverVersion": 0,
            }
        ]
    },
)
if status != 200 or not sync_write.get("objects") or not sync_write["objects"][0].get("accepted"):
    raise RuntimeError("sync write was not accepted")

status, sync_read, _ = request("/api/account/sync?protocol=2", cookie=cookie)
if status != 200 or not any(item.get("objectKey") == "migration-acceptance" for item in sync_read.get("objects", [])):
    raise RuntimeError("sync change feed did not return the test object")

status, logged_in, login_cookies = request(
    "/api/auth/phone-login",
    method="POST",
    body={"phone": phone, "pin": pin},
)
if status != 200 or logged_in.get("account", {}).get("profile", {}).get("userId") != account_id:
    raise RuntimeError("phone login did not return the registered account")
if not cookie_header(login_cookies):
    raise RuntimeError("phone login did not issue a session cookie")

print(json.dumps({"status": "passed", "testAccountId": account_id, "phone": phone}, ensure_ascii=False))
