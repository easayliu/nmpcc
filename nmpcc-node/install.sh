#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────
#  NMPCC SDK — 一键安装脚本
#  支持：Ubuntu / Debian
#  服务管理：systemd
# ─────────────────────────────────────────────

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[ OK ]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
die()   { echo -e "${RED}[FAIL]${NC}  $*" >&2; exit 1; }

# ── 默认配置（可通过环境变量覆盖）──
INSTALL_DIR="${INSTALL_DIR:-/opt/nmpcc-sdk}"
SERVICE_USER="${SERVICE_USER:-nmpcc}"
PORT="${PORT:-3000}"
REPO_URL="${REPO_URL:-}"          # 留空则从当前目录复制
SERVICE_NAME="nmpcc-sdk"

echo ""
echo "  ███╗   ██╗███╗   ███╗██████╗  ██████╗ ██████╗"
echo "  ████╗  ██║████╗ ████║██╔══██╗██╔════╝██╔════╝"
echo "  ██╔██╗ ██║██╔████╔██║██████╔╝██║     ██║"
echo "  ██║╚██╗██║██║╚██╔╝██║██╔═══╝ ██║     ██║"
echo "  ██║ ╚████║██║ ╚═╝ ██║██║     ╚██████╗╚██████╗"
echo "  ╚═╝  ╚═══╝╚═╝     ╚═╝╚═╝      ╚═════╝ ╚═════╝"
echo ""
echo "  Claude Code Proxy — 安装程序"
echo "  安装目录: $INSTALL_DIR  |  端口: $PORT  |  用户: $SERVICE_USER"
echo ""

# ── 检查 root ──
[[ $EUID -ne 0 ]] && die "请使用 sudo 或 root 运行此脚本"

# ── 检测系统 ──
if ! command -v apt-get &>/dev/null; then
  die "此脚本仅支持 Ubuntu/Debian (apt)。其他系统请手动安装。"
fi

# ── 安装系统依赖 ──
info "更新软件包列表..."
apt-get update -qq

info "安装依赖：curl, unzip, git..."
apt-get install -y -qq curl unzip git

# ── 安装 Bun ──
if command -v bun &>/dev/null; then
  ok "Bun 已安装：$(bun --version)"
else
  info "安装 Bun..."
  curl -fsSL https://bun.sh/install | bash
  # 使 bun 在当前 shell 可用
  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"
  # 同时安装到系统路径
  ln -sf "$HOME/.bun/bin/bun" /usr/local/bin/bun
  ok "Bun 安装完成：$(bun --version)"
fi

BUN_BIN="$(command -v bun)"

# ── 创建系统用户 ──
if id "$SERVICE_USER" &>/dev/null; then
  ok "用户 $SERVICE_USER 已存在"
else
  info "创建系统用户 $SERVICE_USER..."
  useradd --system --shell /usr/sbin/nologin --create-home --home-dir "$INSTALL_DIR" "$SERVICE_USER"
  ok "用户 $SERVICE_USER 创建完成"
fi

# ── 部署文件 ──
info "部署应用到 $INSTALL_DIR..."
mkdir -p "$INSTALL_DIR"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ -n "$REPO_URL" ]]; then
  # 从 Git 仓库克隆
  info "从 $REPO_URL 克隆..."
  if [[ -d "$INSTALL_DIR/.git" ]]; then
    git -C "$INSTALL_DIR" pull --ff-only
  else
    git clone "$REPO_URL" "$INSTALL_DIR"
  fi
else
  # 从当前目录复制
  info "从 $SCRIPT_DIR 复制文件..."
  rsync -a --exclude='node_modules' --exclude='.env' --exclude='accounts' \
    "$SCRIPT_DIR/" "$INSTALL_DIR/"
fi

# ── 安装 Node 依赖 ──
info "安装 npm 依赖..."
cd "$INSTALL_DIR"
"$BUN_BIN" install --frozen-lockfile 2>/dev/null || "$BUN_BIN" install

# ── 创建必要目录 ──
mkdir -p "$INSTALL_DIR/accounts"
mkdir -p "$INSTALL_DIR/public"

# ── 生成 .env（如果不存在）──
if [[ ! -f "$INSTALL_DIR/.env" ]]; then
  info "生成默认 .env 配置..."
  cat > "$INSTALL_DIR/.env" <<EOF
PORT=$PORT
# TIMEOUT_MS=600000
# SERVICE_API_KEYS=your-secret-key-here
# ANTHROPIC_BASE_URL=https://api.anthropic.com
# ACCOUNTS_DIR=./accounts
EOF
  ok ".env 已生成，请按需编辑：$INSTALL_DIR/.env"
else
  ok ".env 已存在，跳过生成"
fi

# ── 设置权限 ──
chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"
chmod 750 "$INSTALL_DIR"
chmod 600 "$INSTALL_DIR/.env"

# ── 创建 systemd 服务 ──
info "注册 systemd 服务 $SERVICE_NAME..."
cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=NMPCC SDK - Claude Code Proxy
After=network.target
StartLimitIntervalSec=60
StartLimitBurst=5

[Service]
Type=simple
User=$SERVICE_USER
WorkingDirectory=$INSTALL_DIR
ExecStart=$BUN_BIN run server.mjs
Restart=on-failure
RestartSec=5s

# 环境
EnvironmentFile=$INSTALL_DIR/.env

# 安全加固
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=$INSTALL_DIR/accounts

# 日志
StandardOutput=journal
StandardError=journal
SyslogIdentifier=$SERVICE_NAME

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
systemctl restart "$SERVICE_NAME"

# ── 验证启动 ──
info "等待服务启动..."
sleep 3

if systemctl is-active --quiet "$SERVICE_NAME"; then
  ok "服务已成功启动！"
else
  warn "服务未能启动，查看日志："
  journalctl -u "$SERVICE_NAME" -n 30 --no-pager
  exit 1
fi

# ── 完成 ──
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  安装完成！${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "  Dashboard:    http://localhost:$PORT"
echo "  API Endpoint: http://localhost:$PORT/v1/messages"
echo "  安装目录:     $INSTALL_DIR"
echo "  配置文件:     $INSTALL_DIR/.env"
echo "  账号目录:     $INSTALL_DIR/accounts"
echo ""
echo "  常用命令："
echo "    查看状态   systemctl status $SERVICE_NAME"
echo "    查看日志   journalctl -u $SERVICE_NAME -f"
echo "    重启服务   systemctl restart $SERVICE_NAME"
echo "    停止服务   systemctl stop $SERVICE_NAME"
echo "    编辑配置   nano $INSTALL_DIR/.env"
echo ""
