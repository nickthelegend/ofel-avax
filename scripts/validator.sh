#!/usr/bin/env bash
# Stop or start ONE Ofel L1 validator (local network, or the Fuji containers on the VPS) (for the "one validator offline" demo).
#   scripts/validator.sh stop  NodeID-...
#   scripts/validator.sh start NodeID-...
#   scripts/validator.sh status
set -euo pipefail
# Fuji L1 (OFEL_NETWORK=fuji-l1): the validators are Docker containers on the VPS (ofel-l1-v{1,2,3}-1).
if [ "${OFEL_NETWORK:-local}" = "fuji-l1" ]; then
  ROOT="$(cd "$(dirname "$0")/.." && pwd)"
  VPS="${OFEL_VPS:-root@201.18.198.162}"; KEY="${OFEL_VPS_KEY:-$HOME/.ssh/hackathon_vps}"
  cmd="${1:-status}"; node="${2:-}"
  container() { python3 -c "import json,sys;v=[x for x in json.load(open('$ROOT/deployments/fuji.json'))['validators'] if x['nodeID']==sys.argv[1]];print('ofel-l1-'+v[0]['name']+'-1' if v else '')" "$1"; }
  case "$cmd" in
    status) ssh -i "$KEY" "$VPS" 'docker ps -a --filter name=ofel-l1-v --format "{{.Names}} {{.Status}}"' ;;
    stop|start)
      c="$(container "$node")"; [ -n "$c" ] || { echo "unknown validator $node" >&2; exit 2; }
      ssh -i "$KEY" "$VPS" "docker $cmd $c" >/dev/null; echo "${cmd}ped $node ($c)" | sed 's/startped/started/; s/stopped/stopped/' ;;
    *) echo "usage: $0 status|stop|start [NodeID-...]"; exit 2 ;;
  esac
  exit 0
fi
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
