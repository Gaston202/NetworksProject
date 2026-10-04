#!/usr/bin/env bash
# Build the React SPA ON the server VM (no scp from a laptop needed).
# Node is only a build tool here: it turns frontend/src into plain files in
# frontend/dist, which nginx then serves (deploy/nginx-setup.sh). Nothing
# Node-based runs while the app is up.
#
# Run ON the VM:  sudo bash deploy/build-frontend.sh
# Then:           sudo bash deploy/nginx-setup.sh

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND_DIR="$REPO_DIR/frontend"
# npm must run as the repo owner, not root, or node_modules/dist end up root-owned.
RUN_USER="${SUDO_USER:-$(stat -c '%U' "$REPO_DIR")}"
NODE_MAJOR=22   # Vite needs Node 20.19+ / 22.12+; Ubuntu 24.04's own apt package is too old

node_is_recent() {
  command -v node >/dev/null || return 1
  node -e 'const [maj, min] = process.versions.node.split(".").map(Number);
           process.exit(maj > 22 || (maj === 22 && min >= 12) || (maj === 20 && min >= 19) ? 0 : 1)'
}

if node_is_recent; then
  echo "==> Node $(node --version) already installed"
else
  echo "==> Installing Node.js $NODE_MAJOR (NodeSource repository)"
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl gnupg
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y -qq nodejs
  echo "    installed Node $(node --version)"
fi

echo "==> Installing frontend dependencies (npm ci, as $RUN_USER)"
cd "$FRONTEND_DIR"
sudo -H -u "$RUN_USER" npm ci --no-audit --no-fund

echo "==> Building (empty VITE_API_BASE_URL: the app calls /api on its own server)"
sudo -H -u "$RUN_USER" env VITE_API_BASE_URL= npm run build

if [ ! -f "$FRONTEND_DIR/dist/index.html" ]; then
  echo "ERROR: build finished but frontend/dist/index.html is missing" >&2
  exit 1
fi
echo
echo "FRONTEND BUILT OK - next: sudo bash deploy/nginx-setup.sh"
