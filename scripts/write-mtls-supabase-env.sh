#!/usr/bin/env bash
# Build a dotenv file for `supabase secrets set --env-file` with a correct multiline PEM bundle.
# Avoids shell word-splitting and mangled newlines from pasting into the Dashboard/CLI.
#
# Usage (repo root):
#   ./scripts/write-mtls-supabase-env.sh akash-mtls-fresh/mtls-bundle.pem
#   supabase secrets set --env-file ./.secrets.mtls.env
#
# Output default: ./.secrets.mtls.env (gitignored below)
#
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="${1:-"$ROOT/akash-mtls-fresh/mtls-bundle.pem"}"
OUT="${2:-"$ROOT/.secrets.mtls.env"}"

if [[ ! -f "$SRC" ]]; then
  echo "File not found: $SRC"
  exit 1
fi

python3 - "$SRC" "$OUT" <<'PY'
import pathlib, sys

src, out = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
pem = src.read_text(encoding="utf-8").replace("\r\n", "\n").strip() + "\n"

for label, block in (
    ("cert", "CERTIFICATE"),
    ("EC private key", "EC PRIVATE KEY"),
    ("EC public key", "EC PUBLIC KEY"),
):
    if f"-----BEGIN {block}-----" not in pem:
        sys.exit(f"error: expected PEM block BEGIN {block} in bundle")

# Dotenv double-quoted value: escape \ and " only; real newlines stay inside the quotes.
escaped = pem.replace("\\", "\\\\").replace('"', '\\"')
out.write_text(f'AKASH_MTLS_PEM_BUNDLE="{escaped}"\n', encoding="utf-8")
print(f"Wrote {out}")
print("Next (linked project):")
print(f'  supabase secrets set --env-file "{out}"')
print("Then redeploy Edge functions if your host requires it. Do not commit this file.")
PY
