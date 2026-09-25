#!/usr/bin/env bash
# Serve the built React SPA from nginx on the Ubuntu Desktop VM (hms-desktop).
# Run ON the VM:  sudo bash deploy/desktop-setup.sh
# Prerequisite: the built SPA files exist at frontend/dist (see deploy/README.md
# for building on the Windows host and copying the folder over).

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_ROOT="/var/www/hms"
DIST_DIR="$REPO_DIR/frontend/dist"

if [ ! -f "$DIST_DIR/index.html" ]; then
  echo "ERROR: $DIST_DIR/index.html missing — build the SPA on the host and copy frontend/dist here first."
  exit 1
fi

echo "==> Installing nginx"
apt-get update -qq
apt-get install -y -qq nginx

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

echo "==> Reloading nginx"
nginx -t
systemctl reload nginx

echo "==> Verifying"
curl -fsS http://localhost/ | head -3
echo
echo "FRONTEND SERVED OK — open http://10.0.2.20/ from any machine on the NAT network"