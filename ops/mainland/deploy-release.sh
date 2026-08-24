#!/usr/bin/env bash
set -Eeuo pipefail

RELEASE_GUARD_VERSION=1
DEPLOY_LOCK_PATH="/var/lock/context-reader-deploy.lock"
MANIFEST_RELATIVE_PATH="ops/mainland/release-manifest.json"
CONTRACT_VERIFIER="/opt/context-reader/bin/verify-release-contracts"

if [[ $# -ne 2 ]]; then
  echo "usage: $0 RELEASE_ID ARCHIVE_PATH" >&2
  exit 64
fi

release_id="$1"
archive_path="$(readlink -f "$2")"
release_root="/opt/context-reader-releases"
release_dir="$release_root/$release_id"
anchor_dir="/opt/context-reader"
current_dir="/opt/context-reader-current"
candidate_name="context-reader-candidate-$release_id"
candidate_image="context-reader-app:candidate-$release_id"
accepted_image="context-reader-app:accepted-$release_id"
manifest_temp="$(mktemp)"
candidate_started=0

cleanup() {
  rm -f -- "$manifest_temp"
  if [[ "$candidate_started" -eq 1 ]]; then
    docker rm -f "$candidate_name" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

exec 9>"$DEPLOY_LOCK_PATH"
if ! flock -n 9; then
  echo "another Context Reader deployment is active; retry after it finishes" >&2
  exit 75
fi

if [[ ! "$release_id" =~ ^[0-9]{8}T[0-9]{6}$ ]]; then
  echo "invalid release id: $release_id" >&2
  exit 64
fi
if [[ "$(readlink -f "$release_root")" != "$release_root" ]]; then
  echo "unexpected release root: $release_root" >&2
  exit 65
fi
if [[ ! -f "$archive_path" ]]; then
  echo "release archive not found: $archive_path" >&2
  exit 66
fi
if [[ -e "$release_dir" ]]; then
  echo "release directory already exists: $release_dir" >&2
  exit 73
fi

current_resolved="$(readlink -f "$current_dir")"
if [[ "$current_resolved" != "$release_root"/* || ! -d "$current_resolved" ]]; then
  echo "current production release is not a valid versioned directory: $current_resolved" >&2
  exit 65
fi
current_release_id="$(basename "$current_resolved")"

python3 - "$archive_path" <<'PY'
import pathlib
import subprocess
import sys

archive = sys.argv[1]
names = subprocess.check_output(["tar", "-tzf", archive], text=True).splitlines()
for raw in names:
    name = raw[2:] if raw.startswith("./") else raw
    path = pathlib.PurePosixPath(name)
    if path.is_absolute() or ".." in path.parts:
        raise SystemExit(f"unsafe archive member: {raw}")
PY

manifest_member="$(tar -tzf "$archive_path" | awk -v target="$MANIFEST_RELATIVE_PATH" '
  {
    normalized = $0
    sub(/^\.\//, "", normalized)
    if (!found && normalized == target) {
      print $0
      found = 1
    }
  }
')"
if [[ -z "$manifest_member" ]]; then
  echo "release manifest is missing: $MANIFEST_RELATIVE_PATH" >&2
  exit 66
fi
tar -xOf "$archive_path" "$manifest_member" > "$manifest_temp"

mapfile -t manifest_values < <(python3 - "$manifest_temp" <<'PY'
import json
import re
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    data = json.load(handle)
required = {
    "schemaVersion": int,
    "releaseId": str,
    "parentReleaseId": str,
    "sourceRevision": str,
    "guardVersion": int,
    "requiredContracts": list,
    "changedFiles": list,
}
for key, expected_type in required.items():
    if not isinstance(data.get(key), expected_type):
        raise SystemExit(f"invalid release manifest field: {key}")
if data["schemaVersion"] != 1:
    raise SystemExit("unsupported release manifest schema")
if not re.fullmatch(r"[0-9a-f]{40}", data["sourceRevision"]):
    raise SystemExit("sourceRevision must be a full 40-character Git commit")
contracts = data["requiredContracts"]
changed = data["changedFiles"]
if any(not isinstance(item, str) or not item for item in contracts):
    raise SystemExit("requiredContracts must contain non-empty strings")
if any(not isinstance(item, str) or not item for item in changed):
    raise SystemExit("changedFiles must contain non-empty strings")
if len(set(contracts)) != len(contracts) or len(set(changed)) != len(changed):
    raise SystemExit("release manifest arrays may not contain duplicates")
required_contracts = {"release-lineage-v1", "phonetic-current-form-v1"}
missing_contracts = sorted(required_contracts - set(contracts))
if missing_contracts:
    raise SystemExit("candidate is missing required protected contract: " + ", ".join(missing_contracts))
print(data["releaseId"])
print(data["parentReleaseId"])
print(data["sourceRevision"])
print(data["guardVersion"])
PY
)

manifest_release_id="${manifest_values[0]:-}"
manifest_parent_release_id="${manifest_values[1]:-}"
source_revision="${manifest_values[2]:-}"
manifest_guard_version="${manifest_values[3]:-0}"

if [[ "$manifest_release_id" != "$release_id" ]]; then
  echo "release manifest id mismatch: expected $release_id, got $manifest_release_id" >&2
  exit 65
fi
if [[ "$manifest_parent_release_id" != "$current_release_id" ]]; then
  echo "parent release mismatch: candidate expects $manifest_parent_release_id, current production is $current_release_id" >&2
  exit 76
fi
if [[ "$manifest_guard_version" -lt "$RELEASE_GUARD_VERSION" ]]; then
  echo "candidate release guard is too old: $manifest_guard_version" >&2
  exit 76
fi
if [[ ! -x "$CONTRACT_VERIFIER" ]]; then
  echo "stable release contract verifier is unavailable: $CONTRACT_VERIFIER" >&2
  exit 69
fi

stack_env="$current_dir/ops/mainland/.env"
runtime_env="$current_dir/ops/mainland/.env.runtime"
if [[ ! -f "$stack_env" || ! -f "$runtime_env" ]]; then
  stack_env="$anchor_dir/ops/mainland/.env"
  runtime_env="$anchor_dir/ops/mainland/.env.runtime"
  if [[ ! -f "$stack_env" || ! -f "$runtime_env" ]]; then
    echo "current deployment secrets are missing" >&2
    exit 66
  fi
fi

install -d -m 0755 "$release_dir"
tar --no-same-owner -xzf "$archive_path" -C "$release_dir"
test -f "$release_dir/package.json"
test -f "$release_dir/ops/mainland/compose.yml"
test -f "$release_dir/$MANIFEST_RELATIVE_PATH"
find "$release_dir/ops/mainland" -maxdepth 1 -type f \( -name '*.sh' -o -name '*.py' \) -exec chmod 0755 {} +
if ! cmp -s "$manifest_temp" "$release_dir/$MANIFEST_RELATIVE_PATH"; then
  echo "extracted release manifest differs from the preflight manifest" >&2
  exit 65
fi

python3 - "$current_resolved" "$release_dir" "$release_dir/$MANIFEST_RELATIVE_PATH" <<'PY'
import hashlib
import json
import os
import pathlib
import sys

parent = pathlib.Path(sys.argv[1])
candidate = pathlib.Path(sys.argv[2])
manifest_path = pathlib.Path(sys.argv[3])
with manifest_path.open(encoding="utf-8") as handle:
    manifest = json.load(handle)
ignored_exact = {
    "ops/mainland/.env",
    "ops/mainland/.env.runtime",
    "ops/mainland/release-manifest.json",
    "tsconfig.tsbuildinfo",
}
ignored_roots = {".git", ".next", ".next-dev", ".npm-cache", "node_modules", "__pycache__"}

def inventory(root: pathlib.Path):
    result = {}
    for dirpath, dirnames, filenames in os.walk(root):
        relative_dir = pathlib.Path(dirpath).relative_to(root)
        dirnames[:] = [name for name in dirnames if name not in ignored_roots]
        for filename in filenames:
            path = pathlib.Path(dirpath) / filename
            relative = (relative_dir / filename).as_posix()
            if relative in ignored_exact or relative.split("/", 1)[0] in ignored_roots:
                continue
            if path.is_symlink():
                result[relative] = "link:" + os.readlink(path)
            elif path.is_file():
                digest = hashlib.sha256()
                with path.open("rb") as handle:
                    for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                        digest.update(chunk)
                result[relative] = digest.hexdigest()
    return result

parent_files = inventory(parent)
candidate_files = inventory(candidate)
actual = sorted(
    path for path in set(parent_files) | set(candidate_files)
    if parent_files.get(path) != candidate_files.get(path)
)
declared = sorted(manifest["changedFiles"])
unsafe = [path for path in declared if pathlib.PurePosixPath(path).is_absolute() or ".." in pathlib.PurePosixPath(path).parts]
if unsafe:
    raise SystemExit("unsafe changedFiles entry: " + ", ".join(unsafe))
if actual != declared:
    missing = sorted(set(actual) - set(declared))
    extra = sorted(set(declared) - set(actual))
    if missing:
        print("undeclared release changes: " + ", ".join(missing), file=sys.stderr)
    if extra:
        print("declared files without a source change: " + ", ".join(extra), file=sys.stderr)
    raise SystemExit(76)
print(f"release delta verified: {len(actual)} reviewed files")
PY

"$CONTRACT_VERIFIER" "$release_dir"
install -m 0600 "$stack_env" "$release_dir/ops/mainland/.env"
install -m 0600 "$runtime_env" "$release_dir/ops/mainland/.env.runtime"

cd "$release_dir"
docker build --pull=false \
  --build-arg "CONTEXT_READER_RELEASE_ID=$release_id" \
  --build-arg "CONTEXT_READER_PARENT_RELEASE_ID=$current_release_id" \
  -f ops/mainland/Dockerfile \
  -t "$candidate_image" .

set -a
# shellcheck disable=SC1090
source "$release_dir/ops/mainland/.env"
set +a
compose_overlay="$release_dir/ops/mainland/compose.shadow.yml"
if [[ "${SITE_ADDRESS:-:80}" != ":80" ]]; then
  compose_overlay="$release_dir/ops/mainland/compose.production.yml"
fi

docker rm -f "$candidate_name" >/dev/null 2>&1 || true
docker run -d \
  --name "$candidate_name" \
  --network context-reader_private \
  --env-file "$release_dir/ops/mainland/.env.runtime" \
  --env NODE_ENV=production \
  --env CONTEXT_READER_RUNTIME_MODE=mainland \
  --env HOSTNAME=0.0.0.0 \
  --env PORT=3000 \
  --env "DATABASE_URL=postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  --env SUPABASE_URL=http://supabase-api:8000 \
  --env "SUPABASE_PUBLIC_URL=${SUPABASE_PUBLIC_URL:-https://context-reader.com}" \
  --env "SUPABASE_SERVICE_ROLE_KEY=${SERVICE_ROLE_KEY:-}" \
  "$candidate_image" >/dev/null
candidate_started=1

candidate_ok=0
candidate_connectivity=""
for _ in $(seq 1 60); do
  if candidate_connectivity="$(docker exec "$candidate_name" wget -qO- http://127.0.0.1:3000/api/connectivity 2>/dev/null)"; then
    if python3 - "$release_id" "$current_release_id" "$candidate_connectivity" <<'PY'
import json
import sys

release_id, parent_id, payload = sys.argv[1:]
data = json.loads(payload)
if (
    data.get("ok") is not True
    or data.get("releaseId") != release_id
    or data.get("parentReleaseId") != parent_id
    or data.get("backendMode") != "mainland_internal"
):
    raise SystemExit(1)
PY
    then
      candidate_ok=1
      break
    fi
  fi
  sleep 2
done
if [[ "$candidate_ok" -ne 1 ]]; then
  docker logs --tail 120 "$candidate_name" >&2 || true
  echo "candidate release identity or health check failed; current deployment was not changed" >&2
  exit 1
fi

docker exec "$candidate_name" wget -qO- http://127.0.0.1:3000/guide >/dev/null
docker rm -f "$candidate_name" >/dev/null
candidate_started=0

current_before_cutover="$(basename "$(readlink -f "$current_dir")")"
if [[ "$current_before_cutover" != "$current_release_id" ]]; then
  echo "parent release mismatch before cutover: started from $current_release_id, now $current_before_cutover" >&2
  exit 76
fi

docker tag "$candidate_image" context-reader-app:latest
docker tag "$candidate_image" "$accepted_image"
docker compose \
  --env-file "$release_dir/ops/mainland/.env" \
  -f "$release_dir/ops/mainland/compose.yml" \
  -f "$compose_overlay" \
  up -d --no-build --no-deps --force-recreate app caddy
ln -sfn "$release_dir" "$current_dir"

state_temp="$(mktemp)"
python3 - "$state_temp" "$release_id" "$current_release_id" "$source_revision" <<'PY'
import json
import sys
from datetime import datetime, timezone

path, release_id, parent_id, source_revision = sys.argv[1:]
data = {
    "schemaVersion": 1,
    "releaseId": release_id,
    "parentReleaseId": parent_id,
    "sourceRevision": source_revision,
    "acceptedAt": datetime.now(timezone.utc).isoformat(),
    "guardVersion": 1,
}
with open(path, "w", encoding="utf-8") as handle:
    json.dump(data, handle, ensure_ascii=False, indent=2)
    handle.write("\n")
PY
install -m 0644 "$state_temp" /opt/context-reader-release-state.json
python3 - "$state_temp" >> /var/log/context-reader-release-audit.jsonl <<'PY'
import json
import sys
with open(sys.argv[1], encoding="utf-8") as handle:
    print(json.dumps(json.load(handle), ensure_ascii=False, separators=(",", ":")))
PY
rm -f -- "$state_temp"

docker compose \
  --env-file "$release_dir/ops/mainland/.env" \
  -f "$release_dir/ops/mainland/compose.yml" \
  -f "$compose_overlay" \
  ps
echo "accepted release: $release_id (parent: $current_release_id, source: $source_revision)"
