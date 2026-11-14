#!/usr/bin/env bash
# One-shot runner for the film. Needs the fork up (anvil.sh) and the pool deployed (setup.ts).
#   bash scripts/sandwich/run-demo.sh baseline   # victim swaps with no bot running: fair price
#   bash scripts/sandwich/run-demo.sh attacked   # bot watches the mempool, victim swaps: sandwiched
#   bash scripts/sandwich/run-demo.sh ofel [s]   # the same bot reads the real Ofel L1 for s seconds (default 40)
# JSON lines go to stdout and to /tmp/ofel-sandwich-<mode>.jsonl; results stay on the fork for the /sandwich page.
set -euo pipefail
cd "$(dirname "$0")/../.."
MODE="${1:-attacked}"; AMT="${SANDWICH_AMOUNT:-8000}"
OUT="/tmp/ofel-sandwich-$MODE.jsonl"; : > "$OUT"
case "$MODE" in
  baseline) node scripts/sandwich/victim.ts "$AMT" | tee -a "$OUT" ;;
  attacked)
    node scripts/sandwich/bot.ts --once > >(tee -a "$OUT") 2>&1 &
    BOT=$!; echo $BOT > /tmp/ofel-sandwich-bot.pid
    sleep 1.5
    node scripts/sandwich/victim.ts "$AMT" | tee -a "$OUT"
    wait $BOT || true; rm -f /tmp/ofel-sandwich-bot.pid ;;
  ofel) node scripts/sandwich/bot-ofel.ts --seconds "${2:-40}" | tee -a "$OUT" ;;
  *) echo "mode: baseline | attacked | ofel" >&2; exit 2 ;;
esac
