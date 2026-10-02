#!/usr/bin/env bash
# Provision the FastAPI backend on the Ubuntu Server VM (LabServer, ADR-0016).
# The database is MongoDB Atlas (ADR-0004) — nothing database-related is
# installed here; the VM just needs outbound access to Atlas (TCP 27017).
# Run ON the VM:  sudo env MONGODB_URL='mongodb+srv://...' bash deploy/server-provision.sh
# Assumes Ubuntu Server 24.04 LTS and that this repo is present (git clone or scp).

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$REPO_DIR/backend"

# The systemd unit's User= is replaced with the account that owns the repo
# (SUDO_USER when the script runs under sudo, else the repo dir's owner).
# A hardcoded User= made systemd exit 217/USER on any VM whose first user
# isn't 'ubuntu' — and the service user must be able to read the .env.
RUN_USER="${SUDO_USER:-$(stat -c '%U' "$REPO_DIR")}"

# LabServer's adapters (ADR-0016): NAT for internet/Atlas + host ssh, intnet for clients.
NAT_IFACE="${NAT_IFACE:-enp0s3}"
LAN_IFACE="${LAN_IFACE:-enp0s8}"

MONGODB_URL="${MONGODB_URL:?Set MONGODB_URL first, e.g. sudo env MONGODB_URL='mongodb+srv://...' bash $0}"

echo "==> Installing system packages (no database packages on this VM)"
apt-get update -qq
apt-get install -y -qq python3-venv python3-pip

echo "==> Writing backend .env"
if [ ! -f "$BACKEND_DIR/.env" ]; then
  SECRET_KEY="$(python3 -c 'import secrets; print(secrets.token_hex(32))')"
  cat > "$BACKEND_DIR/.env" <<ENV
MONGODB_URL=$MONGODB_URL
MONGODB_DB=hms
SECRET_KEY=$SECRET_KEY
ACCESS_TOKEN_EXPIRE_MINUTES=60
CORS_ORIGINS=http://localhost:5173
SEED_PASSWORD=hms-demo-1234
ENV
else
  echo "    .env already exists — leaving its contents alone"
fi
# Always (re)apply ownership: an .env written by an earlier root-owned run
# would otherwise stay unreadable to the service user, and uvicorn would
# crash on the missing MONGODB_URL.
chmod 600 "$BACKEND_DIR/.env"
chown "$RUN_USER": "$BACKEND_DIR/.env"

echo "==> Creating venv and installing dependencies"
python3 -m venv "$BACKEND_DIR/.venv"
"$BACKEND_DIR/.venv/bin/pip" install --quiet -r "$BACKEND_DIR/requirements.txt"

echo "==> Seeding demo data into Atlas"
cd "$BACKEND_DIR"
.venv/bin/python -m app.seed

echo "==> Installing systemd service"
cp "$REPO_DIR/deploy/hms-api.service" /etc/systemd/system/hms-api.service
# The unit references this repo's paths; fix them for this machine:
sed -i "s|__REPO__|$REPO_DIR|g; s|__REPO_USER__|$RUN_USER|g" /etc/systemd/system/hms-api.service
systemctl daemon-reload
systemctl enable hms-api
# restart, not start: a re-run must pick up a changed unit or .env even when
# an older instance is still running (or crash-looping).
systemctl restart hms-api

echo "==> Firewall: deny incoming except ssh on $NAT_IFACE and http on $LAN_IFACE"
# Port 8000 is never opened: uvicorn listens on loopback behind nginx.
# The ssh rule goes in before enabling so a running ssh session survives.
apt-get install -y -qq ufw
ufw default deny incoming
ufw default allow outgoing
ufw allow in on "$NAT_IFACE" to any port 22 proto tcp
ufw allow in on "$LAN_IFACE" to any port 80 proto tcp
ufw delete allow 8000/tcp >/dev/null 2>&1 || true   # rule from older runs
ufw --force enable

echo "==> Verifying"
systemctl --no-pager status hms-api | head -5 || true
# The first boot also runs ensure_indexes against Atlas — wait for it instead
# of failing a provisioning run that is seconds away from being healthy.
for attempt in $(seq 1 12); do
  if curl -fsS --max-time 4 http://localhost:8000/api/health; then break; fi
  if [ "$attempt" = 12 ]; then
    echo "API health never reported OK - check: journalctl -u hms-api" >&2
    exit 1
  fi
  sleep 3
done
echo
echo "BACKEND PROVISIONED OK - next: sudo bash deploy/nginx-setup.sh"