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
#   Supabase Dashboard → Project Settings → Edge Functions → Secrets:
#     AKASH_MTLS_CERT_PEM, AKASH_MTLS_KEY_PEM, AKASH_MTLS_PUBLIC_KEY_PEM
#     OR a single AKASH_MTLS_PEM_BUNDLE = contents of mtls-bundle.pem
#
# CLI (if logged in): multiline PEM is awkward; prefer Dashboard or:
#   supabase secrets set --env-file path/to/secrets.env
#   where secrets.env has one var per line (quoted multiline is shell-specific).
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
if openssl req -help 2>&1 | grep -q -- '-addext'; then
  openssl req -new -x509 -key "${OUT}/key.pem" -out "${OUT}/cert.pem" -days 365 \
    -subj "/CN=${CN}" \
    -addext "keyUsage=digitalSignature,keyAgreement" \
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

Do not commit this directory. Set Supabase Edge secrets from these files, then register
the cert on-chain (deploy-step-cert / check-akash-cert.ts) if not already present.
The wallet address in the cert CN is normalized to lowercase (required by the chain).
EOF

echo "Wrote:"
echo "  ${OUT}/cert.pem"
echo "  ${OUT}/key.pem"
echo "  ${OUT}/pub.pem"
echo "  ${OUT}/mtls-bundle.pem"
echo "  ${OUT}/README.txt"
echo ""
echo "Next: set AKASH_MTLS_* secrets in Supabase (Dashboard recommended). Do not git add this folder."
