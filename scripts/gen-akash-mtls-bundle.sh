#!/usr/bin/env bash
# Generate EC P-256 (prime256v1) mTLS PEMs compatible with Akash + @akashnetwork/chain-sdk
# (public key uses -----BEGIN EC PUBLIC KEY----- after OpenSSL relabel).
#
# Usage (from repo root):
#   ./scripts/gen-akash-mtls-bundle.sh akash1youraddress...
#   AKASH_ADDRESS=akash1... ./scripts/gen-akash-mtls-bundle.sh
#
# Output directory (default): ./akash-mtls-fresh/
#   cert.pem  key.pem  pub.pem  mtls-bundle.pem  README.txt
#
# Publish secrets (do NOT commit keys — directory is gitignored):
#   Cloudflare Worker secrets (from cloudflare-backend/):
#     npx wrangler secret put AKASH_MTLS_CERT_PEM       < cert.pem
#     npx wrangler secret put AKASH_MTLS_KEY_PEM        < key.pem
#     npx wrangler secret put AKASH_MTLS_PUBLIC_KEY_PEM < pub.pem
#     # OR a single bundle secret (contents of mtls-bundle.pem):
#     npx wrangler secret put AKASH_MTLS_PEM_BUNDLE     < mtls-bundle.pem
#
# Also upload the cert+key to the Worker's mTLS binding (see wrangler.jsonc → mtls_certificates):
#     npx wrangler mtls-certificate upload --cert cert.pem --key key.pem --name akash-mtls
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${ROOT}/akash-mtls-fresh"
CN="${1:-${AKASH_ADDRESS:-}}"

if [[ -z "${CN}" ]]; then
  echo "Usage: $0 <akash1...address>"
  echo "   or: AKASH_ADDRESS=akash1... $0"
  echo "(CN must match the hot wallet bech32 address used for mTLS, same as chain-sdk generatePEM.)"
  exit 1
fi

# Akash rejects cert subjects with mixed-case bech32 ("decoding bech32 failed: string not all lowercase or all uppercase").
CN="$(printf '%s' "${CN}" | tr '[:upper:]' '[:lower:]')"

if ! command -v openssl >/dev/null 2>&1; then
  echo "openssl not found"
  exit 1
fi

mkdir -p "${OUT}"

openssl ecparam -name prime256v1 -genkey -noout -out "${OUT}/key.pem"

# Self-signed cert; CN = wallet address (matches SDK certificate subject).
# basicConstraints=CA:FALSE is REQUIRED for Cloudflare Workers mTLS binding upload
# (`wrangler mtls-certificate upload` returns "Missing leaf certificate. [code: 1412]"
# if the cert is marked CA:TRUE — CF expects an end-entity/leaf cert, not a CA).
# Akash itself only checks Subject CN + on-chain-registered pubkey, so CA:FALSE is fine.
if openssl req -help 2>&1 | grep -q -- '-addext'; then
  openssl req -new -x509 -key "${OUT}/key.pem" -out "${OUT}/cert.pem" -days 365 \
    -subj "/CN=${CN}" \
    -addext "basicConstraints=critical,CA:FALSE" \
    -addext "keyUsage=critical,digitalSignature,keyAgreement" \
    -addext "extendedKeyUsage=clientAuth" 2>/dev/null \
    || openssl req -new -x509 -key "${OUT}/key.pem" -out "${OUT}/cert.pem" -days 365 -subj "/CN=${CN}"
else
  openssl req -new -x509 -key "${OUT}/key.pem" -out "${OUT}/cert.pem" -days 365 -subj "/CN=${CN}"
fi

openssl ec -in "${OUT}/key.pem" -pubout -out "${OUT}/pub.tmp.pem"
# Akash / chain-sdk expect EC PUBLIC KEY PEM boundaries (not generic BEGIN PUBLIC KEY).
sed 's/BEGIN PUBLIC KEY/BEGIN EC PUBLIC KEY/g; s/END PUBLIC KEY/END EC PUBLIC KEY/g' \
  "${OUT}/pub.tmp.pem" > "${OUT}/pub.pem"
rm -f "${OUT}/pub.tmp.pem"

cat "${OUT}/cert.pem" "${OUT}/key.pem" "${OUT}/pub.pem" > "${OUT}/mtls-bundle.pem"

cat > "${OUT}/README.txt" <<EOF
Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)
CN (hot wallet): ${CN}

Files:
  cert.pem        — leaf cert (CN must match this wallet)
  key.pem         — EC PRIVATE KEY (keep secret)
  pub.pem         — EC PUBLIC KEY (Akash-compatible header)
  mtls-bundle.pem — concat for AKASH_MTLS_PEM_BUNDLE

Do not commit this directory. Set Cloudflare Worker secrets from these files (wrangler secret put),
upload the cert+key via \`wrangler mtls-certificate upload\` for the AKASH_MTLS binding, then register
the cert on-chain (check-akash-cert.ts) if not already present.
The wallet address in the cert CN is normalized to lowercase (required by the chain).
EOF

echo "Wrote:"
echo "  ${OUT}/cert.pem"
echo "  ${OUT}/key.pem"
echo "  ${OUT}/pub.pem"
echo "  ${OUT}/mtls-bundle.pem"
echo "  ${OUT}/README.txt"
echo ""
echo "Next: set AKASH_MTLS_* secrets in Cloudflare Worker (wrangler secret put) and upload cert+key via \`wrangler mtls-certificate upload\`. Do not git add this folder."
