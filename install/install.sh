#!/usr/bin/env bash
# Install sim-agent as a systemd service (Linux). Run as root.
#   sudo ./install.sh --code ABCD-EFGH                       # download latest + pair + start
#   sudo ./install.sh --binary ./sim-agent-linux-x64         # use a local binary
#   sudo ./install.sh --name work --code ABCD-EFGH           # a second, independent agent

# Re-exec under bash if started with `sh` (dash lacks `set -o pipefail`).
if [ -z "${BASH_VERSION:-}" ]; then exec bash "$0" "$@"; fi
set -euo pipefail

REPO="Blake870/sim-agent"
SERVICE_USER="sim-agent"

NAME="sim-agent"
CODE="${AGENT_PAIRING_CODE:-}"
BINARY_SRC=""
SERVER_URL="${AGENT_SERVER_URL:-}"
NO_AUTO_UPDATE=""

usage() { echo "Usage: sudo ./install.sh [--name NAME] [--code ABCD-EFGH] [--binary FILE] [--server URL] [--no-auto-update]"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --name) NAME="$2"; shift 2 ;;
    --code) CODE="$2"; shift 2 ;;
    --binary) BINARY_SRC="$2"; shift 2 ;;
    --server) SERVER_URL="$2"; shift 2 ;;
    --no-auto-update) NO_AUTO_UPDATE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1"; usage; exit 1 ;;
  esac
done

[ "$(id -u)" -eq 0 ] || { echo "Please run as root (sudo)."; exit 1; }
case "$NAME" in *[!a-zA-Z0-9_-]*) echo "Invalid --name (letters, digits, - and _ only)."; exit 1 ;; esac

STATE_DIR="/var/lib/$NAME"
UNIT_DEST="/etc/systemd/system/$NAME.service"
# The binary lives inside the service-owned state dir (not /usr/local/bin) so that
# auto-update can atomically replace it: that dir is writable by the service user and
# is the one path ProtectSystem=strict leaves read-write for the unit.
BIN_PATH="$STATE_DIR/sim-agent"

# 1. Obtain the binary.
TMP_BIN="$(mktemp)"
trap 'rm -f "$TMP_BIN"' EXIT
if [ -n "$BINARY_SRC" ]; then
  cp "$BINARY_SRC" "$TMP_BIN"
else
  arch="$(uname -m)"; case "$arch" in x86_64) arch=x64 ;; aarch64|arm64) arch=arm64 ;; esac
  url="https://github.com/$REPO/releases/latest/download/sim-agent-linux-$arch"
  echo "Downloading $url ..."
  curl -fsSL "$url" -o "$TMP_BIN"
fi

# 2. Shared service user; per-instance private state directory.
id "$SERVICE_USER" >/dev/null 2>&1 || useradd --system --home-dir /var/lib/sim-agent --shell /usr/sbin/nologin "$SERVICE_USER"
install -d -o "$SERVICE_USER" -g "$SERVICE_USER" -m 0700 "$STATE_DIR"

# 3. Install the binary, owned by the service user so auto-update can replace it in place.
install -o "$SERVICE_USER" -g "$SERVICE_USER" -m 0755 "$TMP_BIN" "$BIN_PATH"

# 4. Server URL override (only needed if the binary has no baked-in URL, e.g. a custom build).
#    Written to the env file the service loads, and forwarded to the pairing step below.
if [ -n "$SERVER_URL" ]; then
  printf 'AGENT_SERVER_URL=%s\n' "$SERVER_URL" > "/etc/$NAME.env"
  chmod 0644 "/etc/$NAME.env"
fi

# 5. Pair (writes the token into this instance's state) if a code was provided.
if [ -n "$CODE" ]; then
  echo "Pairing '$NAME' ..."
  sudo -u "$SERVICE_USER" env AGENT_PAIR_ONLY=1 AGENT_PAIRING_CODE="$CODE" \
    ${SERVER_URL:+AGENT_SERVER_URL="$SERVER_URL"} \
    ${NO_AUTO_UPDATE:+AGENT_AUTO_UPDATE=0} \
    AGENT_STATE_PATH="$STATE_DIR/agent-state.json" "$BIN_PATH"
elif [ -n "$NO_AUTO_UPDATE" ]; then
  echo "Note: --no-auto-update is persisted during pairing; pass it together with --code."
elif [ ! -f "$STATE_DIR/agent-state.json" ]; then
  echo "Note: '$NAME' not paired. Re-run with --code ABCD-EFGH, or pair later:"
  echo "  sudo -u $SERVICE_USER env AGENT_PAIR_ONLY=1 AGENT_PAIRING_CODE=... AGENT_STATE_PATH=$STATE_DIR/agent-state.json $BIN_PATH"
fi

# 6. Generate the unit for this instance and start it.
cat > "$UNIT_DEST" <<EOF
[Unit]
Description=sim-agent ($NAME) - Steam task agent for sim.gudoguy.com
Documentation=https://github.com/$REPO
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_USER
WorkingDirectory=$STATE_DIR
ExecStart=$BIN_PATH
Restart=always
RestartSec=10
EnvironmentFile=-/etc/$NAME.env
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=$STATE_DIR

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now "$NAME"

echo "Done. Status: systemctl status $NAME   Logs: journalctl -u $NAME -f"
