#!/usr/bin/env bash
# Mint a local CA + server cert for phone/LAN HTTPS smoke (iOS camera needs a
# trusted secure context). Certs land in apps/web/certs/ (gitignored).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CERT_DIR="$ROOT/apps/web/certs"
LAN_IP="${LAN_IP:-$(ip -4 route get 1.1.1.1 | awk '{for (i = 1; i <= NF; i++) if ($i == "src") { print $(i + 1); exit }}')}"

if [[ -z "${LAN_IP}" ]]; then
  echo "Could not detect LAN IP; set LAN_IP=..." >&2
  exit 1
fi

mkdir -p "$CERT_DIR"
cd "$CERT_DIR"

openssl genrsa -out rootCA-key.pem 2048
openssl req -x509 -new -nodes -key rootCA-key.pem -sha256 -days 825 \
  -out rootCA.pem -subj "/CN=MTG Scanner Dev CA"

openssl genrsa -out dev-key.pem 2048
cat > san.cnf <<EOF
[req]
distinguished_name = req_distinguished_name
req_extensions = v3_req
prompt = no

[req_distinguished_name]
CN = ${LAN_IP}

[v3_req]
subjectAltName = @alt_names
basicConstraints = CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth

[alt_names]
IP.1 = ${LAN_IP}
DNS.1 = localhost
IP.2 = 127.0.0.1
EOF

openssl req -new -key dev-key.pem -out dev.csr -config san.cnf
openssl x509 -req -in dev.csr -CA rootCA.pem -CAkey rootCA-key.pem \
  -CAcreateserial -out dev-cert.pem -days 825 -sha256 \
  -extfile san.cnf -extensions v3_req
rm -f dev.csr

chmod 644 rootCA.pem dev-cert.pem
chmod 640 rootCA-key.pem dev-key.pem

echo "Minted certs for ${LAN_IP} in ${CERT_DIR}"
echo "Install on iPhone: open http://${LAN_IP}:3080/rootCA.pem (see scripts/serve-dev-ca.sh)"
