#!/usr/bin/env bash
# Provision the FastAPI backend on the Ubuntu Server VM (hms-server).
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
CORS_ORIGINS=http://10.0.2.20,http://localhost:5173
SEED_PASSWORD=hms-demo-1234
ENV
  chmod 600 "$BACKEND_DIR/.env"
  chown "$RUN_USER": "$BACKEND_DIR/.env"
else
  echo "    .env already exists — leaving it alone"
fi

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
systemctl enable --now hms-api

echo "==> Allowing the API port through the firewall (NAT network only)"
if command -v ufw >/dev/null; then ufw allow 8000/tcp || true; fi

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
echo "BACKEND PROVISIONED OK"