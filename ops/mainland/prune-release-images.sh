#!/usr/bin/env bash
set -Eeuo pipefail

DEPLOY_LOCK_PATH="/var/lock/context-reader-deploy.lock"
CURRENT_LINK="/opt/context-reader-current"
RELEASE_STATE="/opt/context-reader-release-state.json"

exec 9>"$DEPLOY_LOCK_PATH"
if ! flock -n 9; then
  echo "deployment is active; image pruning deferred"
  exit 0
fi

current_id="$(basename "$(readlink -f "$CURRENT_LINK")")"
mapfile -t release_state < <(python3 - "$RELEASE_STATE" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    state = json.load(handle)
print(state["releaseId"])
print(state["parentReleaseId"])
PY
)
state_current="${release_state[0]:-}"
parent_id="${release_state[1]:-}"

if [[ ! "$current_id" =~ ^[0-9]{8}T[0-9]{6}$ || "$current_id" != "$state_current" ]]; then
  echo "release state mismatch: symlink=$current_id state=$state_current" >&2
  exit 76
fi
if [[ ! "$parent_id" =~ ^[0-9]{8}T[0-9]{6}$ ]]; then
  echo "invalid parent release id: $parent_id" >&2
  exit 76
fi

for required in \
  "context-reader-app:latest" \
  "context-reader-app:accepted-$current_id" \
  "context-reader-app:candidate-$current_id" \
  "context-reader-app:accepted-$parent_id" \
  "context-reader-app:candidate-$parent_id"; do
  docker image inspect "$required" >/dev/null
done

mapfile -t old_refs < <(
  docker image ls context-reader-app --format '{{.Repository}}:{{.Tag}}' |
    grep -Ev "^context-reader-app:(latest|accepted-(${current_id}|${parent_id})|candidate-(${current_id}|${parent_id}))$" |
    sort -u || true
)

for ref in "${old_refs[@]}"; do
  docker image rm "$ref"
done
docker image prune -f

echo "release image retention complete: current=$current_id parent=$parent_id removed_tags=${#old_refs[@]}"
