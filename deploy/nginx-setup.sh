#!/usr/bin/env bash
# nginx on LabServer (ADR-0016): serves the built React SPA and reverse-proxies
# the API, so the browser sees ONE origin (http://<LabServer>/) — no CORS, and
# client IPs (DHCP) don't matter. uvicorn stays on 127.0.0.1:8000.
#
#   http://<LabServer>/               -> SPA files (frontend/dist)
#   http://<LabServer>/api/...        -> uvicorn 127.0.0.1:8000
#   http://<LabServer>/docs           -> Swagger UI (same upstream)
#
# Run ON LabServer, after server-provision.sh:  sudo bash deploy/nginx-setup.sh
# Prerequisite: frontend/dist exists — build on the Windows host and scp it over
# (see deploy/README.md). Safe to re-run after every frontend rebuild.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_ROOT="/var/www/hms"
DIST_DIR="$REPO_DIR/frontend/dist"
API_UPSTREAM="http://127.0.0.1:8000"
LAN_IFACE="${LAN_IFACE:-enp0s8}"

if [ ! -f "$DIST_DIR/index.html" ]; then
  echo "ERROR: $DIST_DIR/index.html missing — build the SPA on the host and copy frontend/dist here first." >&2
  exit 1
fi

echo "==> Installing nginx"
apt-get update -qq
apt-get install -y -qq nginx rsync

echo "==> Deploying static build to $WEB_ROOT"
mkdir -p "$WEB_ROOT"
rsync -a --delete "$DIST_DIR/" "$WEB_ROOT/"
chown -R www-data:www-data "$WEB_ROOT"

echo "==> Writing nginx site config"
cat > /etc/nginx/sites-available/hms <<NGINX
server {
    listen 80 default_server;
    server_name _;

    root $WEB_ROOT;
    index index.html;

    # API -> FastAPI. '^~' wins over the regex asset rule below, so no API
    # path is ever served as a static file.
    location ^~ /api/ {
        proxy_pass $API_UPSTREAM;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    # Swagger UI and its schema live on the API too.
    location = /docs         { proxy_pass $API_UPSTREAM; }
    location = /openapi.json { proxy_pass $API_UPSTREAM; }

    # Client-side routing: unknown paths fall back to the SPA entrypoint.
    location / {
        try_files \$uri \$uri/ /index.html;
    }

    location ~* \.(?:js|css|svg|png|jpg|woff2?)\$ {
        expires 7d;
        add_header Cache-Control "public, immutable";
    }
}
NGINX
ln -sf /etc/nginx/sites-available/hms /etc/nginx/sites-enabled/hms
rm -f /etc/nginx/sites-enabled/default

echo "==> Restarting nginx"
nginx -t
systemctl enable nginx
systemctl restart nginx

echo "==> Verifying"
curl -fsS http://localhost/ | head -3
echo
curl -fsS http://localhost/api/health
echo
LAN_IP="$(ip -4 -o addr show "$LAN_IFACE" 2>/dev/null | awk '{print $4}' | cut -d/ -f1)"
echo "FRONTEND + API SERVED OK — open http://${LAN_IP:-<LabServer-IP>}/ from a client VM"
