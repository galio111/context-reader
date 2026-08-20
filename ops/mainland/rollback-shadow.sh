#!/usr/bin/env sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "usage: $0 IMAGE_TAG" >&2
  exit 2
fi

TAG=$1
case "$TAG" in
  *[!A-Za-z0-9._-]*|'') echo "invalid image tag" >&2; exit 2 ;;
esac

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
docker image inspect "context-reader-app:$TAG" >/dev/null
docker tag "context-reader-app:$TAG" context-reader-app:latest
docker compose --env-file "$SCRIPT_DIR/.env" -f "$SCRIPT_DIR/compose.yml" -f "$SCRIPT_DIR/compose.shadow.yml" up -d --no-build app caddy

for _ in 1 2 3 4 5 6 7 8 9 10; do
  if curl --fail --silent --max-time 5 http://127.0.0.1:8080/api/connectivity >/dev/null; then
    echo "rollback to $TAG passed"
    exit 0
  fi
  sleep 5
done

echo "rollback health check failed" >&2
exit 1
