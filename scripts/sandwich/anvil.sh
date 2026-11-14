#!/usr/bin/env bash
# Local Anvil fork of the Avalanche Fuji C-Chain for the sandwich demo: 4 s blocks and a fee-ordered mempool, so
# pending swaps sit in a public mempool for a few seconds, the way they do on a busy public chain.
# Port 8546 (not 8545) so it never collides with other local chains. Pid in /tmp/ofel-sandwich-anvil.pid.
set -euo pipefail
LOG="${SANDWICH_LOG:-/tmp/ofel-sandwich-anvil.log}"
if curl -s -m 2 -X POST -H content-type:application/json --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId"}' http://127.0.0.1:8546 | grep -q 0xa869; then
  echo "anvil fork already up on :8546"; exit 0
fi
nohup anvil --fork-url "${FUJI_RPC:-https://avalanche-fuji-c-chain-rpc.publicnode.com}" --chain-id 43113 --block-time 4 --order fees \
  --port 8546 --host 127.0.0.1 --silent >"$LOG" 2>&1 &
echo $! > /tmp/ofel-sandwich-anvil.pid
for i in $(seq 1 60); do
  if curl -s -m 2 -X POST -H content-type:application/json --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId"}' http://127.0.0.1:8546 | grep -q 0xa869; then
    echo "anvil fork of Fuji up on http://127.0.0.1:8546 (pid $(cat /tmp/ofel-sandwich-anvil.pid))"; exit 0
  fi
  sleep 0.5
done
echo "anvil did not start, see $LOG" >&2; exit 1
