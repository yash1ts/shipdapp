#!/usr/bin/env bash
set -euo pipefail

# Local diagnostic for Akash provider mTLS auth failures (Manifest/Lease status 401).
#
# What it does:
# 1) Resolves provider host URI from chain using provider address.
# 2) Resolves lease gseq/oseq for owner+dseq+provider.
# 3) Calls provider manifest and lease-status endpoints with your cert/key.
#
# Notes:
# - Chain queries use the **akash** CLI (v2.0+), same RPC/chain-id flags as `akash query …`.
# - Manifest payload is intentionally minimal ("{}"), so a non-401 status means mTLS auth worked.
# - If you pass --manifest-file <path>, that JSON payload is used instead.

usage() {
  cat <<'EOF'
Usage:
  scripts/test-akash-mtls.sh \
    --owner <akash1...> \
    --dseq <number> \
    --provider <akash1...> \
    --cert <cert.pem> \
    --key <key.pem> \
    [--node <rpc-url>] \
    [--chain-id <id>] \
    [--manifest-file <groups.json>] \
    [--retries <n>] \
    [--retry-delay-ms <ms>]

Required:
  --owner           Deployment owner wallet (hot wallet address).
  --dseq            Deployment sequence.
  --provider        Provider address selected for the lease.
  --cert            Client certificate PEM file.
  --key             Client private key PEM file (unencrypted).

Optional:
  --node            Tendermint RPC URL (default: https://rpc.sandbox-2.aksh.pw:443)
  --chain-id        Chain ID (default: sandbox-2)
  --manifest-file   Path to manifest groups JSON body for PUT /deployment/<dseq>/manifest.
                    If omitted, "{}" is sent only to test auth.
  --retries         Retry count per endpoint (default: 5)
  --retry-delay-ms  Delay between retries (default: 5000)

Env:
  AKASH             Path to akash binary (default: akash on PATH)
EOF
}

OWNER=""
DSEQ=""
PROVIDER=""
CERT_PATH=""
KEY_PATH=""
NODE_URL="https://rpc.sandbox-2.aksh.pw:443"
CHAIN_ID="sandbox-2"
MANIFEST_FILE=""
RETRIES=5
RETRY_DELAY_MS=5000

while [[ $# -gt 0 ]]; do
  case "$1" in
    --owner) OWNER="${2:-}"; shift 2 ;;
    --dseq) DSEQ="${2:-}"; shift 2 ;;
    --provider) PROVIDER="${2:-}"; shift 2 ;;
    --cert) CERT_PATH="${2:-}"; shift 2 ;;
    --key) KEY_PATH="${2:-}"; shift 2 ;;
    --node) NODE_URL="${2:-}"; shift 2 ;;
    --chain-id) CHAIN_ID="${2:-}"; shift 2 ;;
    --manifest-file) MANIFEST_FILE="${2:-}"; shift 2 ;;
    --retries) RETRIES="${2:-}"; shift 2 ;;
    --retry-delay-ms) RETRY_DELAY_MS="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; usage; exit 1 ;;
  esac
done

if [[ -z "$OWNER" || -z "$DSEQ" || -z "$PROVIDER" || -z "$CERT_PATH" || -z "$KEY_PATH" ]]; then
  echo "Missing required arguments." >&2
  usage
  exit 1
fi

if [[ ! -f "$CERT_PATH" ]]; then
  echo "Cert file not found: $CERT_PATH" >&2
  exit 1
fi
if [[ ! -f "$KEY_PATH" ]]; then
  echo "Key file not found: $KEY_PATH" >&2
  exit 1
fi

AKASH_BIN="${AKASH:-akash}"
if ! command -v "$AKASH_BIN" >/dev/null 2>&1; then
  echo "akash CLI is required in PATH (install from https://github.com/akash-network/node/releases, or set AKASH=/path/to/akash)." >&2
  exit 1
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required in PATH." >&2
  exit 1
fi

echo "== mTLS inputs =="
echo "owner=$OWNER"
echo "dseq=$DSEQ"
echo "provider=$PROVIDER"
echo "node=$NODE_URL"
echo "chain_id=$CHAIN_ID"
echo "cert=$CERT_PATH"
echo "key=$KEY_PATH"

echo "== resolving provider hostUri =="
PROVIDER_JSON="$("$AKASH_BIN" query provider get "$PROVIDER" --node "$NODE_URL" --chain-id "$CHAIN_ID" -o json)"
HOST_URI="$(echo "$PROVIDER_JSON" | jq -r '.provider.host_uri // .provider.hostUri // .host_uri // .hostUri // empty')"
if [[ -z "$HOST_URI" ]]; then
  echo "Could not resolve provider host_uri for $PROVIDER" >&2
  echo "Provider query payload:" >&2
  echo "$PROVIDER_JSON" | jq . >&2
  exit 1
fi
if [[ "$HOST_URI" =~ ^https?:// ]]; then
  ORIGIN="${HOST_URI%/}"
else
  ORIGIN="https://${HOST_URI%/}"
fi
echo "host_uri=$HOST_URI"
echo "origin=$ORIGIN"

echo "== resolving lease gseq/oseq =="
LEASES_JSON="$("$AKASH_BIN" query market lease list \
  --owner "$OWNER" \
  --provider "$PROVIDER" \
  --dseq "$DSEQ" \
  --node "$NODE_URL" \
  --chain-id "$CHAIN_ID" \
  -o json)"

GSEQ="$(echo "$LEASES_JSON" | jq -r '.leases[0].lease.id.gseq // .leases[0].lease.lease_id.gseq // empty')"
OSEQ="$(echo "$LEASES_JSON" | jq -r '.leases[0].lease.id.oseq // .leases[0].lease.lease_id.oseq // empty')"
if [[ -z "$GSEQ" || -z "$OSEQ" ]]; then
  echo "Could not find lease for owner+dseq+provider." >&2
  echo "$LEASES_JSON" | jq .
  exit 1
fi
echo "gseq=$GSEQ"
echo "oseq=$OSEQ"

MANIFEST_URL="${ORIGIN}/deployment/${DSEQ}/manifest"
STATUS_URL="${ORIGIN}/lease/${DSEQ}/${GSEQ}/${OSEQ}/status"
echo "manifest_url=$MANIFEST_URL"
echo "status_url=$STATUS_URL"

if [[ -n "$MANIFEST_FILE" ]]; then
  if [[ ! -f "$MANIFEST_FILE" ]]; then
    echo "Manifest file not found: $MANIFEST_FILE" >&2
    exit 1
  fi
  MANIFEST_BODY="$(<"$MANIFEST_FILE")"
else
  MANIFEST_BODY="{}"
fi

attempt_manifest() {
  local attempt="$1"
  local out
  local code
  out="$(mktemp)"
  code="$(
    curl -sS \
      --cert "$CERT_PATH" \
      --key "$KEY_PATH" \
      -o "$out" \
      -w "%{http_code}" \
      -X PUT "$MANIFEST_URL" \
      -H "Content-Type: application/json" \
      -H "Accept: application/json" \
      --data "$MANIFEST_BODY"
  )"
  echo "[manifest attempt $attempt/$RETRIES] http=$code body=$(<"$out")"
  rm -f "$out"
  if [[ "$code" != "401" && "$code" != "000" ]]; then
    return 0
  fi
  return 1
}

attempt_status() {
  local attempt="$1"
  local out
  local code
  out="$(mktemp)"
  code="$(
    curl -sS \
      --cert "$CERT_PATH" \
      --key "$KEY_PATH" \
      -o "$out" \
      -w "%{http_code}" \
      -X GET "$STATUS_URL" \
      -H "Accept: application/json"
  )"
  echo "[status attempt $attempt/$RETRIES] http=$code body=$(<"$out")"
  rm -f "$out"
  if [[ "$code" != "401" && "$code" != "000" ]]; then
    return 0
  fi
  return 1
}

echo "== testing manifest endpoint =="
manifest_ok=false
for ((i=1; i<=RETRIES; i++)); do
  if attempt_manifest "$i"; then
    manifest_ok=true
    break
  fi
  if [[ "$i" -lt "$RETRIES" ]]; then
    sleep "$(awk "BEGIN { printf \"%.3f\", $RETRY_DELAY_MS/1000 }")"
  fi
done

echo "== testing lease status endpoint =="
status_ok=false
for ((i=1; i<=RETRIES; i++)); do
  if attempt_status "$i"; then
    status_ok=true
    break
  fi
  if [[ "$i" -lt "$RETRIES" ]]; then
    sleep "$(awk "BEGIN { printf \"%.3f\", $RETRY_DELAY_MS/1000 }")"
  fi
done

echo "== summary =="
echo "manifest_non_401=$manifest_ok"
echo "status_non_401=$status_ok"

if [[ "$manifest_ok" != "true" || "$status_ok" != "true" ]]; then
  echo "mTLS auth still failing (401 persisted on at least one endpoint)." >&2
  exit 2
fi

echo "mTLS auth accepted by provider endpoints."
