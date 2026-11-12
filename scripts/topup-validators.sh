#!/usr/bin/env bash
# Top up the three Ofel L1 validators' P-Chain balances on Fuji in one command.
#   scripts/topup-validators.sh                   # spread whatever sits on the deployer's C and P addresses
#   scripts/topup-validators.sh 0.5 "judging"     # first request 0.5 AVAX from the funding hub (avax/.hub/fund.sh)
#   OFEL_DRY_RUN=1 scripts/topup-validators.sh    # print the plan, send nothing
# Steps: hub -> deployer C-Chain (optional), ExportTx C->P, ImportTx on P, IncreaseL1ValidatorBalanceTx per validator
# so all three balances end up equal (they then run out at the same time). Keeps OFEL_KEEP_C (0.01) AVAX on C for gas
# and OFEL_KEEP_P (0.002) on P for fees. Writes the new balances and runway to deployments/fuji.json.
# Key: OFEL_DEPLOYER_PK from the gitignored .env.fuji (never printed).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [ -n "${1:-}" ] && [ "$1" != "0" ]; then
  "$ROOT/../.hub/fund.sh" ofel 0x5Cc9CBB73d65Eb832342E788929294CD8237148f "$1" "${2:-Ofel L1 validator balances (C->P, IncreaseL1ValidatorBalance)}"
  sleep 5
fi
cd "$ROOT/scripts"
exec node --env-file=../.env.fuji topup-validators.ts
