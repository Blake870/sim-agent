#!/usr/bin/env bash
# Re-pair an installed sim-agent with a fresh code — after a clone-kill, an operator revoke,
# or when moving the seat to this machine. Keeps the binary and accounts.json; only the
# pairing (token + machine id) is reset. Run as root.
#   sudo ./re-pair.sh --code ABCD-EFGH                 # default service 'sim-agent'
#   sudo ./re-pair.sh --name work --code ABCD-EFGH     # a named instance

# Re-exec under bash if started with `sh` (dash lacks `set -o pipefail`).
if [ -z "${BASH_VERSION:-}" ]; then exec bash "$0" "$@"; fi
set -euo pipefail

SERVICE_USER="sim-agent"

NAME="sim-agent"
CODE="${AGENT_PAIRING_CODE:-}"
NO_AUTO_UPDATE=""

usage() { echo "Usage: sudo ./re-pair.sh [--name NAME] --code ABCD-EFGH [--no-auto-update]"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --name) NAME="$2"; shift 2 ;;
    --code) CODE="$2"; shift 2 ;;
    --no-auto-update) NO_AUTO_UPDATE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1"; usage; exit 1 ;;
  esac
done

[ "$(id -u)" -eq 0 ] || { echo "Please run as root (sudo)."; exit 1; }
[ -n "$CODE" ] || { echo "A pairing code is required (--code, from the sim panel)."; usage; exit 1; }
case "$NAME" in *[!a-zA-Z0-9_-]*) echo "Invalid --name (letters, digits, - and _ only)."; exit 1 ;; esac

STATE_DIR="/var/lib/$NAME"
BIN_PATH="$STATE_DIR/sim-agent"
STATE_FILE="$STATE_DIR/agent-state.json"

[ -x "$BIN_PATH" ] || { echo "No sim-agent install found at $BIN_PATH. Install it first with install.sh."; exit 1; }

# Pick up any server/gateway URL overrides the service runs with (a custom build bakes its own
# default, so these are only set when the operator overrode them at install time).
ENV_FILE="/etc/$NAME.env"
if [ -f "$ENV_FILE" ]; then set -a; . "$ENV_FILE"; set +a; fi

# 1. Stop the service so it isn't racing us with the dead token.
systemctl stop "$NAME" 2>/dev/null || true

# 2. Drop the stale pairing (token + machine id). accounts.json and the binary are untouched;
#    re-pairing rebinds a fresh machine id to the same agent record the code belongs to.
rm -f "$STATE_FILE"

# 3. Pair with the new code — writes a fresh token into this instance's state.
echo "Re-pairing '$NAME' ..."
sudo -u "$SERVICE_USER" env AGENT_PAIR_ONLY=1 AGENT_PAIRING_CODE="$CODE" \
  ${AGENT_SERVER_URL:+AGENT_SERVER_URL="$AGENT_SERVER_URL"} \
  ${AGENT_GATEWAY_URL:+AGENT_GATEWAY_URL="$AGENT_GATEWAY_URL"} \
  ${NO_AUTO_UPDATE:+AGENT_AUTO_UPDATE=0} \
  AGENT_STATE_PATH="$STATE_FILE" "$BIN_PATH"

# 4. Back to work.
systemctl start "$NAME"

echo "Done. Status: systemctl status $NAME   Logs: journalctl -u $NAME -f"
