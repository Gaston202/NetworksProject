#!/usr/bin/env bash
# Provision the FastAPI backend + PostgreSQL on the Ubuntu Server VM (hms-server).
# Run ON the VM:  sudo bash deploy/server-provision.sh
# Assumes Ubuntu Server 24.04 LTS and that this repo is present (git clone or scp).

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$REPO_DIR/backend"
DB_NAME="hms"
DB_USER="hms"
DB_PASSWORD="${HMS_DB_PASSWORD:?Set HMS_DB_PASSWORD first, e.g. HMS_DB_PASSWORD='pick-a-real-one' sudo bash $0}"

echo "==> Installing system packages"
apt-get update -qq
apt-get install -y -qq python3-venv python3-pip postgresql libpq-dev

echo "==> Creating PostgreSQL database and user"
sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$DB_USER') THEN
    CREATE ROLE $DB_USER LOGIN PASSWORD '$DB_PASSWORD';
  END IF;
END \$\$;
SQL
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1 \
  || sudo -u postgres createdb -O "$DB_USER" "$DB_NAME"

echo "==> Writing backend .env"
if [ ! -f "$BACKEND_DIR/.env" ]; then
  SECRET_KEY="$(python3 -c 'import secrets; print(secrets.token_hex(32))')"
  cat > "$BACKEND_DIR/.env" <<ENV
DATABASE_URL=postgresql+psycopg2://$DB_USER:$DB_PASSWORD@localhost:5432/$DB_NAME
SECRET_KEY=$SECRET_KEY
ACCESS_TOKEN_EXPIRE_MINUTES=60
CORS_ORIGINS=http://10.0.2.20,http://localhost:5173
SEED_PASSWORD=hms-demo-1234
ENV
  chmod 600 "$BACKEND_DIR/.env"
else
  echo "    .env already exists — leaving it alone"
fi

echo "==> Creating venv and installing dependencies"
python3 -m venv "$BACKEND_DIR/.venv"
"$BACKEND_DIR/.venv/bin/pip" install --quiet -r "$BACKEND_DIR/requirements.txt"

echo "==> Migrating database (generates initial revision on first run)"
cd "$BACKEND_DIR"
if [ -z "$(ls alembic/versions/*.py 2>/dev/null)" ]; then
  .venv/bin/alembic revision --autogenerate -m "initial schema"
fi
.venv/bin/alembic upgrade head

echo "==> Seeding demo data"
.venv/bin/python -m app.seed

echo "==> Installing systemd service"
cp "$REPO_DIR/deploy/hms-api.service" /etc/systemd/system/hms-api.service
# The unit reads ExecStart from this file; fix the paths for this machine:
sed -i "s|__REPO__|$REPO_DIR|g" /etc/systemd/system/hms-api.service
systemctl daemon-reload
systemctl enable --now hms-api

echo "==> Allowing the API port through the firewall (NAT network only)"
if command -v ufw >/dev/null; then ufw allow 8000/tcp || true; fi

echo "==> Verifying"
sleep 2
systemctl --no-pager status hms-api | head -5 || true
curl -fsS http://localhost:8000/api/health && echo && echo "BACKEND PROVISIONED OK"