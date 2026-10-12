"""Rebuild a read-only source inventory; never interprets it as runtime coverage."""
from pathlib import Path
import hashlib
import json
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent
BASELINE = "4d0d91106087951d8d4271b46a328c0908f869d3"
AUDITED_SCOPES = ["app", "components", "lib", "types", "tests", "data", "package.json", "package-lock.json", "next.config.ts", "middleware.ts", "vercel.json", "public/sw.js", "public/manifest.webmanifest", "public/offline.html", "public/cet-audio"]
changes = subprocess.run(["git", "diff", "--name-only", BASELINE, "--", *AUDITED_SCOPES], cwd=ROOT,
                         capture_output=True, text=True, check=True).stdout.strip()
if changes:
    raise SystemExit("Refusing to relabel modified implementation as the frozen baseline. Run in the baseline worktree.\n" + changes)

def text(path):
    return path.read_text(encoding="utf-8-sig")

def unique(values):
    return sorted(set(values))

def lines_matching(source, pattern):
    return [{"line": n, "text": line.strip()} for n, line in enumerate(source.splitlines(), 1)
            if re.search(pattern, line)]

def output(name, value):
    (OUT / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")

def kind(route):
    if route.startswith("/api/anki/") or route.startswith("/api/ocr-") or route in ["/api/auth/adopt-session", "/api/auth/request-otp", "/api/auth/verify-otp"]:
        return "retained-compatibility-not-normal-ui"
    if route.startswith("/api/admin/"):
        return "admin"
    if route.startswith("/api/billing"):
        return "commercial-capability-live-enablement-must-be-verified"
    if route.startswith("/api/cron/"):
        return "scheduler"
    return "product-or-infrastructure"

routes = []
for path in sorted((ROOT / "app").rglob("route.ts")):
    source = text(path)
    relative = path.relative_to(ROOT).as_posix()
    route = "/" + path.parent.relative_to(ROOT / "app").as_posix()
    methods = unique(re.findall(r"export\s+(?:async\s+)?function\s+(GET|POST|PATCH|PUT|DELETE|HEAD|OPTIONS)\b", source)
                     + re.findall(r"export\s+const\s+(GET|POST|PATCH|PUT|DELETE|HEAD|OPTIONS)\b", source))
    routes.append({
        "route": route, "source": relative, "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "methods": methods, "classification": kind(route),
        "imports": unique(re.findall(r'from\s+[\"\']([^\"\']+)[\"\']', source)),
        "queryKeys": unique(re.findall(r'searchParams\.(?:get|has)\([\"\']([^\"\']+)', source)
                            + re.findall(r'params\.(?:get|has)\([\"\']([^\"\']+)', source)),
        "bodyFieldReferences": unique(re.findall(r'\b(?:body|payload|input|p|b)\??\.([A-Za-z_]\w*)', source)),
        "bodyFieldScopeNote": "Static lexical references, not a complete schema. Nested/local variables can appear; shared validators remain authoritative.",
        "operationBranches": lines_matching(source, r'(?:\.action|\.op|\baction|\bop)\s*(?:===|!==)|case\s+[\"\']'),
        "securityAndLimits": lines_matching(source, r'isAdminRequest|getAdminAccessMode|studyOwner|resolveUsageIdentity|getAuthenticatedUser|readJsonBody|readFormDataBody|gateUsage|reserveUsage|acquireAiSlot|[Oo]rigin|[Rr]ate[Ll]imit|MAX_|MIN_|safeRemote|safeFetch|enforce|requireSameOrigin'),
        "responseAndStatusEvidence": lines_matching(source, r'NextResponse\.json|new Response|status:|Cache-Control|Content-Type|\.enqueue\('),
        "runtimeEvidence": "not-executed-by-functional-contract-agent",
    })
pages = []
for path in sorted((ROOT / "app").rglob("page.tsx")):
    source = text(path)
    route = "/" + path.parent.relative_to(ROOT / "app").as_posix().replace(".", "")
    pages.append({"route": route, "source": path.relative_to(ROOT).as_posix(),
                  "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                  "imports": unique(re.findall(r'from\s+[\"\']([^\"\']+)[\"\']', source)),
                  "redirects": lines_matching(source, r'redirect\('),
                  "runtimeEvidence": "not-executed-by-functional-contract-agent"})
output("route-inventory.json", {"schemaVersion": 1, "baselineSourceRevision": BASELINE,
       "baselineReleaseId": "20261012T135500", "parentReleaseId": "20261010T223500",
       "evidence": "Static source enumeration at accepted baseline; no authenticated or visual runtime claim.",
       "apiRouteCount": len(routes), "pageCount": len(pages), "routes": routes, "pages": pages})

tests = []
for path in sorted((ROOT / "tests").rglob("*")):
    if not path.is_file():
        continue
    source = text(path)
    titles = [{"line": n, "title": match.group(1)} for n, line in enumerate(source.splitlines(), 1)
              if (match := re.search(r'(?:\btest|\bit)\(\s*[\"\']([^\"\']+)', line))]
    tests.append({"source": path.relative_to(ROOT).as_posix(), "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                  "declaredTestTitles": titles, "status": "inventoried-not-run-by-this-agent"})
output("test-inventory.json", {"baselineSourceRevision": BASELINE, "files": tests,
       "note": "A test title can describe static assertions. Presence is not runtime coverage or a passing result."})

sources = []
for directory in ["app", "components", "lib", "types", "tests"]:
    for path in sorted((ROOT / directory).rglob("*")):
        if path.is_file():
            sources.append({"path": path.relative_to(ROOT).as_posix(), "bytes": path.stat().st_size,
                            "sha256": hashlib.sha256(path.read_bytes()).hexdigest()})
for relative in ["package.json", "package-lock.json", "next.config.ts", "middleware.ts", "vercel.json", "public/sw.js", "public/manifest.webmanifest", "public/offline.html"]:
    path = ROOT / relative
    if path.exists():
        sources.append({"path": relative, "bytes": path.stat().st_size, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()})
output("source-baseline.json", {"baselineSourceRevision": BASELINE, "files": sources,
       "note": "Preserves exact comparison anchors for existing implementation, UI, CSS and schemas. Does not bless all implementation choices."})

datasets = []
for directory in ["data", "public/cet-audio"]:
    base = ROOT / directory
    if not base.exists():
        continue
    for path in sorted(base.rglob("*")):
        if path.is_file():
            datasets.append({"path": path.relative_to(ROOT).as_posix(), "bytes": path.stat().st_size,
                             "sha256": hashlib.sha256(path.read_bytes()).hexdigest()})
output("static-data-inventory.json", {"baselineSourceRevision": BASELINE, "files": datasets,
       "note": "Repository dataset/media hashes only, not a production database export or content license claim. Remote media are not downloaded."})

state = []
for entry in sources:
    if not entry["path"].endswith((".ts", ".tsx", ".js", ".mjs")) or entry["path"].startswith("tests/"):
        continue
    source = text(ROOT / entry["path"])
    keys = lines_matching(source, r'[\"\'`](?:context-reader[:\-]|standalone-dictionary-history:|dictionary-history-event:)|ACCOUNT_DATA_|SYNC_.*EVENT|OPEN_.*EVENT')
    exports = lines_matching(source, r'^export (?:interface|type) |(?:ObjectStore|createObjectStore|indexedDB\.open|studyRpc|billingRpc|rpc/)')
    if keys or exports:
        state.append({"source": entry["path"], "storageAndEventEvidence": keys, "schemaAndRpcEvidence": exports})
output("state-inventory.json", {"baselineSourceRevision": BASELINE, "sources": state,
       "note": "Static storage/event/type/RPC evidence index. Preserve caller semantics; this is not a database schema dump or proof of runtime use."})

table = ["# Route index", "", "Generated from baseline source. See `route-inventory.json` for methods, field references, validation/response line evidence and source hashes. All entries are inventoried, not dynamically verified in this audit.", "", "| Path | Methods | Source | Classification |", "| --- | --- | --- | --- |"]
table += [f"| `{r['route']}` | {', '.join(r['methods'])} | `{r['source']}` | {r['classification']} |" for r in routes]
table += ["", "| Page | Source |", "| --- | --- |"] + [f"| `{p['route']}` | `{p['source']}` |" for p in pages]
(OUT / "route-index.md").write_text("\n".join(table) + "\n", encoding="utf-8", newline="\n")
print(json.dumps({"apiRoutes": len(routes), "pages": len(pages), "testFiles": len(tests), "sourceFiles": len(sources), "datasetFiles": len(datasets), "stateSources": len(state)}))
