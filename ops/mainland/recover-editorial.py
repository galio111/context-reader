#!/usr/bin/env python3
"""Bounded, authenticated editorial recovery; credentials remain on the server."""
import argparse
import json
import time
import urllib.request
from http.cookiejar import CookieJar
from pathlib import Path
from importlib.machinery import SourceFileLoader

parser=argparse.ArgumentParser()
parser.add_argument("--env",required=True,type=Path)
parser.add_argument("--base-url",default="https://context-reader.com")
parser.add_argument("--action",choices=["status","resume","day","backlog"],required=True)
args=parser.parse_args()
base=args.base_url.rstrip("/")
env=SourceFileLoader("editorial_admin",str(Path(__file__).with_name("acceptance-admin.py"))).load_module().read_env(args.env)
opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(CookieJar()))
def call(path,body=None,cron=False):
    headers={"Content-Type":"application/json","Origin":base}
    if cron:headers["Authorization"]="Bearer "+env["CRON_SECRET"]
    request=urllib.request.Request(base+path,data=json.dumps(body).encode() if body is not None else None,headers=headers,method="POST" if body is not None else "GET")
    with opener.open(request,timeout=880) as response:return json.load(response)
identity=call("/api/connectivity")
if identity.get("backendMode")!="mainland_internal":raise SystemExit("Wrong backend")
call("/api/admin/login",{"password":env["ADMIN_PASSWORD"]})
if args.action=="status":
    crawler=call("/api/admin/article-crawler")
    print(json.dumps({"release":identity.get("releaseId"),"automation":crawler.get("automation")},ensure_ascii=False),flush=True)
elif args.action=="resume":
    print(json.dumps(call("/api/admin/editorial",{"action":"resume_today"}),ensure_ascii=False),flush=True)
elif args.action=="day":
    for batch in range(240):
        result=call("/api/cron/recommendations",cron=True)
        state=result.get("status",{}).get("state",{})
        print(json.dumps({"batch":batch,"status":state.get("status"),"published":state.get("lastCreatedCount"),"attempts":state.get("lastAttemptedCount"),"email":state.get("lastEmailStatus"),"error":state.get("lastError"),"skipped":result.get("skipped")},ensure_ascii=False),flush=True)
        if result.get("skipped") or state.get("status")!="running":break
        time.sleep(2)
    else:raise SystemExit("Recovery batch bound reached")
elif args.action=="backlog":
    rows=call("/api/admin/article-candidates")["articles"]
    approved=[a for a in rows if a.get("recommendation",{}).get("editorialReview",{}).get("status")=="passed"]
    approved.sort(key=lambda a:a.get("createdAt",""),reverse=True)
    counts={"published":0,"duplicate":0,"kept":0}
    print(json.dumps({"approved":len(approved)},ensure_ascii=False),flush=True)
    for i in range(0,len(approved),3):
        result=call("/api/admin/editorial",{"action":"publish_approved","ids":[a["id"] for a in approved[i:i+3]]})
        for outcome in result["outcomes"]:counts[outcome["status"]]=counts.get(outcome["status"],0)+1
        print(json.dumps({"batch":i//3,"counts":counts,"outcomes":result["outcomes"]},ensure_ascii=False),flush=True)
