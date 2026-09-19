#!/usr/bin/env python3
"""Authenticated editorial acceptance; credentials stay in the server environment file."""
import argparse
import json
import urllib.request
from http.cookiejar import CookieJar
from pathlib import Path
from importlib.machinery import SourceFileLoader

parser = argparse.ArgumentParser()
parser.add_argument("--env", required=True)
parser.add_argument("--base-url", default="https://context-reader.com")
parser.add_argument("--action", choices=["inspect", "verify", "save", "activate", "batch"], default="inspect")
parser.add_argument("--site")
parser.add_argument("--file")
a = parser.parse_args()
base = a.base_url.rstrip("/")
identity = json.load(urllib.request.urlopen(base + "/api/connectivity", timeout=20))
if identity.get("backendMode") != "mainland_internal":
    raise SystemExit("Not the mainland backend")
env = SourceFileLoader("admin_acceptance", str(Path(__file__).with_name("acceptance-admin.py"))).load_module().read_env(Path(a.env))
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(CookieJar()))
def call(path, body=None, method=None):
    request = urllib.request.Request(base + path, data=json.dumps(body).encode() if body is not None else None,
        headers={"Content-Type": "application/json", "Origin": base}, method=method or ("POST" if body is not None else "GET"))
    with opener.open(request, timeout=880) as response:
        return json.load(response)
call("/api/admin/login", {"password": env["ADMIN_PASSWORD"]})
if a.action == "inspect":
    sites = call("/api/admin/discovery-sources")
    print(json.dumps({"release": identity.get("releaseId"), "sites": [{"id": s["id"], "name": s["name"], "enabled": s["enabled"], "level": s["levelHint"], "verified": s.get("verification", {}).get("ok")} for s in sites["sites"]]}, ensure_ascii=False))
    print(json.dumps(call("/api/admin/article-crawler"), ensure_ascii=False))
    print(json.dumps(call("/api/admin/editorial"), ensure_ascii=False))
elif a.action == "verify":
    print(json.dumps(call("/api/admin/discovery-sources", {"action": "verify", "id": a.site}), ensure_ascii=False))
elif a.action == "save":
    print(json.dumps(call("/api/admin/discovery-sources", {"action": "save", "site": json.loads(Path(a.file).read_text())}), ensure_ascii=False))
elif a.action == "activate":
    print(json.dumps(call("/api/admin/editorial", {"enabled": True, "provider": "deepseek", "jevMonthlyBudgetUsd": 4, "dailyReviewLimit": 90}, "PATCH"), ensure_ascii=False))
elif a.action == "batch":
    result = call("/api/admin/discovery-sources", {"action": "run"})
    print(json.dumps(result, ensure_ascii=False))
