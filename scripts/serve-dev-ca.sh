#!/usr/bin/env bash
# Serve apps/web/certs/rootCA.pem over plain HTTP so an iPhone can install it
# before trusting https://<lan-ip>:3000 (Safari needs the CA first).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CERT_DIR="$ROOT/apps/web/certs"
PORT="${PORT:-3080}"
LAN_IP="${LAN_IP:-$(ip -4 route get 1.1.1.1 | awk '{for (i = 1; i <= NF; i++) if ($i == "src") { print $(i + 1); exit }}')}"

if [[ ! -f "$CERT_DIR/rootCA.pem" ]]; then
  echo "No rootCA.pem — run scripts/mint-lan-certs.sh first." >&2
  exit 1
fi

echo "On iPhone Safari open:"
echo "  http://${LAN_IP}:${PORT}/rootCA.pem"
echo
echo "Then: Settings → Profile Downloaded → Install"
echo "Then: Settings → General → About → Certificate Trust Settings → enable MTG Scanner Dev CA"
echo
cd "$CERT_DIR"
exec python3 -m http.server "$PORT" --bind 0.0.0.0
