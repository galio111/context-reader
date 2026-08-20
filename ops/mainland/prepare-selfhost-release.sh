#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: $0 RELEASE_ID ARCHIVE_PATH" >&2
  exit 64
fi

release_id="$1"
archive_path=$(readlink -f "$2")
release_root=/opt/context-reader-releases
release_dir="$release_root/$release_id"
anchor_dir=/opt/context-reader/ops/mainland

if [[ ! "$release_id" =~ ^[0-9]{8}T[0-9]{6}$ ]]; then
  echo "invalid release id: $release_id" >&2
  exit 64
fi
if [[ ! -s "$archive_path" ]]; then
  echo "release archive is missing or empty: $archive_path" >&2
  exit 66
fi
if [[ ! -f "$anchor_dir/.env" || ! -f "$anchor_dir/.env.runtime" ]]; then
  echo "current deployment secrets are missing" >&2
  exit 66
fi

install -d -m 0755 "$release_dir"
tar -xzf "$archive_path" -C "$release_dir"
test -f "$release_dir/package.json"
test -f "$release_dir/ops/mainland/compose.yml"
install -m 0600 "$anchor_dir/.env" "$release_dir/ops/mainland/.env"
install -m 0600 "$anchor_dir/.env.runtime" "$release_dir/ops/mainland/.env.runtime"

python3 - "$release_dir/ops/mainland/.env" <<'PY'
import base64
import hashlib
import hmac
import json
import secrets
import sys
import time
from pathlib import Path

path = Path(sys.argv[1])
values = {}
for raw in path.read_text(encoding="utf-8").splitlines():
    if not raw or raw.lstrip().startswith("#") or "=" not in raw:
        continue
    key, value = raw.split("=", 1)
    values[key] = value

def b64url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")

def jwt(secret: str, role: str) -> str:
    now = int(time.time())
    header = b64url(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
    payload = b64url(json.dumps({
        "iss": "supabase-demo",
        "ref": "context-reader",
        "role": role,
        "iat": now,
        "exp": now + 10 * 365 * 24 * 60 * 60,
    }, separators=(",", ":")).encode())
    signature = b64url(hmac.new(secret.encode(), f"{header}.{payload}".encode(), hashlib.sha256).digest())
    return f"{header}.{payload}.{signature}"

jwt_secret = secrets.token_hex(32)
values.update({
    "POSTGRES_DB": "postgres",
    "POSTGRES_USER": "postgres",
    "JWT_SECRET": jwt_secret,
    "JWT_EXPIRY": "3600",
    "ANON_KEY": jwt(jwt_secret, "anon"),
    "SERVICE_ROLE_KEY": jwt(jwt_secret, "service_role"),
    "PUBLIC_SITE_URL": "https://context-reader.com",
    "SUPABASE_PUBLIC_URL": "https://context-reader.com",
    "ROLLBACK_SITE_URL": "https://context-reader-ten.vercel.app",
    "SITE_ADDRESS": ":80",
})

order = [
    "POSTGRES_DB", "POSTGRES_USER", "POSTGRES_PASSWORD",
    "JWT_SECRET", "JWT_EXPIRY", "ANON_KEY", "SERVICE_ROLE_KEY",
    "PUBLIC_SITE_URL", "SUPABASE_PUBLIC_URL", "ROLLBACK_SITE_URL",
    "SITE_ADDRESS", "RCLONE_REMOTE", "RCLONE_CONFIG",
]
missing = [key for key in order[:11] if not values.get(key)]
if missing:
    raise SystemExit("missing deployment values: " + ", ".join(missing))
path.write_text("\n".join(f"{key}={values.get(key, '')}" for key in order) + "\n", encoding="utf-8")
PY

chmod 600 "$release_dir/ops/mainland/.env" "$release_dir/ops/mainland/.env.runtime"
chmod 700 "$release_dir"/ops/mainland/*.sh
docker compose \
  --env-file "$release_dir/ops/mainland/.env" \
  -f "$release_dir/ops/mainland/compose.yml" \
  -f "$release_dir/ops/mainland/compose.shadow.yml" \
  config --quiet

echo "$release_dir"
