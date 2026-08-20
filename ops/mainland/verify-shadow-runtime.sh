#!/usr/bin/env bash
set -Eeuo pipefail

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
compose=(docker compose --env-file "$script_dir/.env" -f "$script_dir/compose.yml" -f "$script_dir/compose.shadow.yml")

"${compose[@]}" ps

for path in /api/connectivity /api/auth/session /api/public-articles /guide /; do
  passed=0
  for _ in $(seq 1 20); do
    code=$(curl --silent --show-error --output /tmp/context-reader-verify-body --write-out '%{http_code}' "http://127.0.0.1:8080$path" || true)
    case "$path:$code" in
      /api/auth/session:200|/api/auth/session:401|/api/public-articles:200|*:200)
        passed=1
        break
        ;;
    esac
    sleep 2
  done
  if [[ "$passed" -ne 1 ]]; then
    echo "shadow verification failed for $path with $code" >&2
    exit 1
  fi
  echo "$path=$code"
done

echo "shadow runtime verification passed"
