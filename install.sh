#!/usr/bin/env bash
set -euo pipefail

# nmpcc installer — downloads the latest release from GitHub and sets up systemd service.

REPO="easayliu/nmpcc"
INSTALL_DIR="/usr/local/bin"
SERVICE_NAME="nmpcc"
ACCOUNTS_DIR="/accounts"
CONFIG_FILE="/etc/nmpcc.env"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[+]${NC} $*"; }
warn()  { echo -e "${YELLOW}[!]${NC} $*"; }
error() { echo -e "${RED}[x]${NC} $*"; exit 1; }

# Check root
[[ $EUID -eq 0 ]] || error "Please run as root: sudo bash install.sh"

# Detect arch
ARCH=$(uname -m)
case "$ARCH" in
  x86_64)  ASSET="nmpcc-linux-amd64" ;;
  aarch64) ASSET="nmpcc-linux-arm64" ;;
  *)       error "Unsupported architecture: $ARCH" ;;
esac

# Get latest release tag
info "Fetching latest release..."
LATEST=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" | grep '"tag_name"' | sed -E 's/.*"([^"]+)".*/\1/')
[[ -n "$LATEST" ]] || error "Failed to get latest release"
info "Latest version: $LATEST"

# Download binary
DOWNLOAD_URL="https://github.com/${REPO}/releases/download/${LATEST}/${ASSET}"
info "Downloading ${ASSET}..."
curl -fsSL -o "/tmp/${ASSET}" "$DOWNLOAD_URL" || error "Download failed"
chmod +x "/tmp/${ASSET}"
mv "/tmp/${ASSET}" "${INSTALL_DIR}/nmpcc"
info "Installed to ${INSTALL_DIR}/nmpcc"

# Create accounts directory
mkdir -p "$ACCOUNTS_DIR"
info "Accounts directory: $ACCOUNTS_DIR"

# Create config file if not exists
if [[ ! -f "$CONFIG_FILE" ]]; then
  cat > "$CONFIG_FILE" << 'ENVEOF'
# nmpcc configuration
PORT=3000
ACCOUNTS_DIR=/accounts
SANDBOX_DIR=/tmp/nmpcc-sandbox

# Authentication (leave empty to disable)
SERVICE_API_KEY=
WEB_PASSWORD=

# Limits
MAX_CONCURRENCY=1
MAX_TURNS=1
TIMEOUT_MS=300000
QUEUE_TIMEOUT_MS=60000
ENVEOF
  info "Config created: $CONFIG_FILE"
  warn "Edit $CONFIG_FILE to set SERVICE_API_KEY and WEB_PASSWORD"
else
  info "Config exists: $CONFIG_FILE (not overwritten)"
fi

# Create systemd service
cat > "/etc/systemd/system/${SERVICE_NAME}.service" << EOF
[Unit]
Description=nmpcc - Claude CLI Proxy Pool
After=network.target

[Service]
Type=simple
EnvironmentFile=$CONFIG_FILE
ExecStart=${INSTALL_DIR}/nmpcc
Restart=always
RestartSec=5
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
info "Systemd service created: ${SERVICE_NAME}.service"

# Enable and start
systemctl enable "$SERVICE_NAME" --now 2>/dev/null || true
info "Service started"

echo ""
info "Installation complete!"
echo ""
echo "  Config:    $CONFIG_FILE"
echo "  Binary:    ${INSTALL_DIR}/nmpcc"
echo "  Accounts:  $ACCOUNTS_DIR"
echo "  Service:   systemctl status $SERVICE_NAME"
echo ""
echo "  Add accounts:"
echo "    CLAUDE_CONFIG_DIR=${ACCOUNTS_DIR}/<name> claude auth login"
echo ""
echo "  Manage:"
echo "    systemctl restart $SERVICE_NAME"
echo "    journalctl -u $SERVICE_NAME -f"
