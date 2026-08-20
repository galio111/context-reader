#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
set -a
. "$SCRIPT_DIR/.env"
set +a

COMPOSE_MODE="$SCRIPT_DIR/compose.shadow.yml"
CONNECTIVITY_URL="http://127.0.0.1:8080/api/connectivity"

if [ "${SITE_ADDRESS:-:80}" != ":80" ]; then
  COMPOSE_MODE="$SCRIPT_DIR/compose.production.yml"
  CONNECTIVITY_URL="${HEALTHCHECK_URL:-https://context-reader.com/api/connectivity}"
fi

compose() {
  docker compose --env-file "$SCRIPT_DIR/.env" -f "$SCRIPT_DIR/compose.yml" -f "$COMPOSE_MODE" "$@"
}

RUNNING_SERVICES=$(compose ps --status running --services | sort | tr '\n' ' ')
if [ "$RUNNING_SERVICES" != "app auth caddy postgres rest storage supabase-api " ]; then
  echo "unexpected running services: $RUNNING_SERVICES" >&2
  compose ps >&2
  exit 1
fi

curl --fail --silent --show-error --max-time 15 "$CONNECTIVITY_URL" >/dev/null

DISK_PERCENT=$(df -P / | awk 'NR == 2 { gsub(/%/, "", $5); print $5 }')
if [ "$DISK_PERCENT" -ge 85 ]; then
  echo "root filesystem usage is ${DISK_PERCENT}%" >&2
  exit 1
fi

LATEST_BACKUP=$(find /var/backups/context-reader/postgres/daily -maxdepth 1 -type f -name 'context-reader-*.dump' -mmin -2160 -print -quit)
if [ -z "$LATEST_BACKUP" ]; then
  echo "no PostgreSQL backup newer than 36 hours" >&2
  exit 1
fi

echo "healthcheck passed"
