#!/usr/bin/env bash
# Fetch Ava Labs eERC circuit artifacts (wasm + zkey) at a pinned upstream commit.
# They match the prod verifiers vendored in contracts/src/vendor/eerc/prod.
set -euo pipefail
COMMIT="$(cat "$(dirname "$0")/../contracts/src/vendor/eerc/UPSTREAM_COMMIT")"
OUT="$(dirname "$0")/../web/public/circuits"
BASE="https://raw.githubusercontent.com/ava-labs/EncryptedERC/${COMMIT}/circom/build"
mkdir -p "$OUT"
for c in registration transfer withdraw mint burn; do
  mkdir -p "$OUT/$c"
  zkey="$c.zkey"; case "$c" in registration|withdraw) zkey="circuit_final.zkey";; esac
  for f in "$c.wasm" "$zkey"; do
    [ -s "$OUT/$c/$f" ] || curl -fsSL "$BASE/$c/$f" -o "$OUT/$c/$f"
  done
done
echo "circuits in $OUT"
