#!/usr/bin/env sh
set -eu

DOMAIN=${1:-context-reader.com}
WWW_DOMAIN=${2:-www.context-reader.com}
EXPECTED_IPV4=${3:-43.143.122.238}
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ENV_FILE="$SCRIPT_DIR/.env"

case "$DOMAIN:$WWW_DOMAIN:$EXPECTED_IPV4" in
  *[!A-Za-z0-9.:_-]*) echo "invalid cutover argument" >&2; exit 2 ;;
esac

resolves_to_server() {
  getent ahostsv4 "$1" | awk '{print $1}' | grep -Fqx "$EXPECTED_IPV4"
}

if ! resolves_to_server "$DOMAIN" || ! resolves_to_server "$WWW_DOMAIN"; then
  echo "DNS is not ready for $DOMAIN and $WWW_DOMAIN at $EXPECTED_IPV4" >&2
  exit 3
fi

BACKUP_ENV="$SCRIPT_DIR/.env.pre-production-$(date -u +%Y%m%dT%H%M%SZ)"
TEMP_ENV=$(mktemp "$SCRIPT_DIR/.env.production.XXXXXX")
cleanup() {
  rm -f "$TEMP_ENV"
}
trap cleanup EXIT INT TERM

cp -p "$ENV_FILE" "$BACKUP_ENV"
awk -v site="$DOMAIN, $WWW_DOMAIN" -v health="https://$DOMAIN/api/connectivity" '
  BEGIN { site_written = 0; health_written = 0 }
  /^SITE_ADDRESS=/ { print "SITE_ADDRESS=\"" site "\""; site_written = 1; next }
  /^HEALTHCHECK_URL=/ { print "HEALTHCHECK_URL=" health; health_written = 1; next }
  { print }
  END {
    if (!site_written) print "SITE_ADDRESS=\"" site "\""
    if (!health_written) print "HEALTHCHECK_URL=" health
  }
' "$ENV_FILE" > "$TEMP_ENV"
chmod 600 "$TEMP_ENV"
mv "$TEMP_ENV" "$ENV_FILE"

ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw allow 443/udp >/dev/null

compose_production() {
  docker compose --env-file "$ENV_FILE" -f "$SCRIPT_DIR/compose.yml" -f "$SCRIPT_DIR/compose.production.yml" "$@"
}

compose_shadow() {
  docker compose --env-file "$ENV_FILE" -f "$SCRIPT_DIR/compose.yml" -f "$SCRIPT_DIR/compose.shadow.yml" "$@"
}

if ! compose_production up -d --no-build --force-recreate caddy; then
  cp -p "$BACKUP_ENV" "$ENV_FILE"
  compose_shadow up -d --no-build --force-recreate caddy
  echo "production proxy failed to start; shadow mode restored" >&2
  exit 4
fi

for _ in $(seq 1 60); do
  if curl --fail --silent --show-error --max-time 10 "https://$DOMAIN/api/connectivity" >/dev/null 2>&1; then
    echo "production cutover passed: https://$DOMAIN"
    exit 0
  fi
  sleep 3
done

cp -p "$BACKUP_ENV" "$ENV_FILE"
compose_shadow up -d --no-build --force-recreate caddy
echo "HTTPS acceptance failed; shadow mode restored" >&2
exit 5
