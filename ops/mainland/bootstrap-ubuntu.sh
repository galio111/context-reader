#!/usr/bin/env sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
  echo "run as root: sudo sh bootstrap-ubuntu.sh" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl docker.io docker-compose-v2 unattended-upgrades ufw
systemctl enable --now docker
systemctl enable --now unattended-upgrades

install -d -m 0750 /opt/context-reader
install -d -m 0700 /var/backups/context-reader/postgres

ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw --force enable

echo "bootstrap complete"
echo "Shadow HTTP remains private. Use an SSH tunnel to 127.0.0.1:8080."
echo "Do not open ports 80/443 until ICP filing and production acceptance are complete."
