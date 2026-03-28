#!/usr/bin/env bash
set -euo pipefail

# nmpcc installer / updater
# - First run: install binary, create config, set up systemd service
# - Subsequent runs: update binary, restart service (config untouched)

REPO="easayliu/nmpcc"
INSTALL_DIR="/usr/local/bin"
SERVICE_NAME="nmpcc"
ACCOUNTS_DIR="/accounts"
CONFIG_FILE="/etc/nmpcc.env"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[+]${NC} $*"; }
warn()  { echo -e "${YELLOW}[!]${NC} $*"; }
error() { echo -e "${RED}[x]${NC} $*"; exit 1; }

[[ $EUID -eq 0 ]] || error "Please run as root: sudo bash install.sh"

# Detect arch
ARCH=$(uname -m)
case "$ARCH" in
  x86_64)  ASSET="nmpcc-linux-amd64" ;;
  aarch64) ASSET="nmpcc-linux-arm64" ;;
  *)       error "Unsupported architecture: $ARCH" ;;
esac

# Detect install vs update
IS_UPDATE=false
if [[ -f "${INSTALL_DIR}/nmpcc" ]]; then
  IS_UPDATE=true
  CURRENT=$("${INSTALL_DIR}/nmpcc" --version 2>/dev/null || echo "unknown")
  info "Existing installation detected (${CURRENT})"
fi

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

if $IS_UPDATE; then
  # ── Update ──
  info "Stopping service..."
  systemctl stop "$SERVICE_NAME" 2>/dev/null || true

  mv "/tmp/${ASSET}" "${INSTALL_DIR}/nmpcc"
  info "Binary updated: ${INSTALL_DIR}/nmpcc"

  systemctl start "$SERVICE_NAME"
  info "Service restarted"

  echo ""
  info "Update complete! $LATEST"

else
  # ── Fresh install ──
  mv "/tmp/${ASSET}" "${INSTALL_DIR}/nmpcc"
  info "Installed to ${INSTALL_DIR}/nmpcc"

  mkdir -p "$ACCOUNTS_DIR"
  info "Accounts directory: $ACCOUNTS_DIR"

  # Config
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
  fi

  # Detect claude location so systemd can find it
  CLAUDE_BIN=$(command -v claude 2>/dev/null || true)
  if [[ -z "$CLAUDE_BIN" ]]; then
    warn "claude CLI not found in PATH — service may fail to start"
    warn "Install claude first, then re-run this script or add its path to the service"
    SVC_PATH="/usr/local/bin:/usr/bin:/bin:/usr/local/sbin:/usr/sbin:/sbin"
  else
    SVC_PATH="$(dirname "$CLAUDE_BIN"):${PATH}"
    info "Found claude at: $CLAUDE_BIN"
  fi

  # Systemd service
  cat > "/etc/systemd/system/${SERVICE_NAME}.service" << EOF
[Unit]
Description=nmpcc - Claude CLI Proxy Pool
After=network.target

[Service]
Type=simple
EnvironmentFile=$CONFIG_FILE
Environment=PATH=${SVC_PATH}
ExecStart=${INSTALL_DIR}/nmpcc
Restart=always
RestartSec=5
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable "$SERVICE_NAME" --now 2>/dev/null || true
  info "Service created and started"

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
fi
