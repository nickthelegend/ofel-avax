#!/usr/bin/env bash
# Stop or start ONE local Ofel L1 validator (for the "one validator offline" demo).
#   scripts/validator.sh stop  NodeID-...
#   scripts/validator.sh start NodeID-...
#   scripts/validator.sh status
set -euo pipefail
CLUSTER="${OFEL_CLUSTER_DIR:-$HOME/.avalanche-cli/local/ofel-local-node-local-network}"
AVAGO="${OFEL_AVALANCHEGO:-$HOME/.avalanche-cli/bin/avalanchego/avalanchego-v1.14.0/avalanchego}"
cmd="${1:-status}"; node="${2:-}"
pid_of() { pgrep -f "avalanchego.*${1}/flags.json" || true; }
case "$cmd" in
  status)
    for d in "$CLUSTER"/NodeID-*; do n="$(basename "$d")"; p="$(pid_of "$n")"; if [ -n "$p" ]; then echo "$n up (pid $p)"; else echo "$n down"; fi; done ;;
  stop)
    p="$(pid_of "$node")"; [ -n "$p" ] || { echo "$node is not running"; exit 1; }
    kill "$p"; echo "stopped $node (pid $p)" ;;
  start)
    [ -z "$(pid_of "$node")" ] || { echo "$node already running"; exit 0; }
    nohup "$AVAGO" --config-file "$CLUSTER/$node/flags.json" >/dev/null 2>&1 &
    echo "started $node (pid $!)" ;;
  *) echo "usage: $0 status|stop|start [NodeID-...]"; exit 2 ;;
esac
