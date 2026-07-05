#!/usr/bin/env bash
# Remove a sim-agent systemd service + its state. Keeps state (the token) unless --purge.
#   sudo ./uninstall.sh [--name NAME] [--purge]

# Re-exec under bash if started with `sh` (dash lacks `set -o pipefail`).
if [ -z "${BASH_VERSION:-}" ]; then exec bash "$0" "$@"; fi
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "Please run as root (sudo)."; exit 1; }

NAME="sim-agent"
PURGE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --name) NAME="$2"; shift 2 ;;
    --purge) PURGE=1; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

systemctl disable --now "$NAME" 2>/dev/null || true
rm -f "/etc/systemd/system/$NAME.service"
systemctl daemon-reload

if [ "$PURGE" -eq 1 ]; then
  rm -rf "/var/lib/$NAME"
  echo "Removed service '$NAME' and its state."
else
  echo "Removed service '$NAME'. State kept at /var/lib/$NAME (re-run with --purge to delete the token)."
fi

# The 'sim-agent' user is left in place (other instances may use it). Each instance's
# binary lives in its own state dir, so it's removed together with the state on --purge.
