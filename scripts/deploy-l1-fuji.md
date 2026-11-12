# Deploying the Ofel L1 to Fuji

## Status (2026-11-12 ~15:00 UTC): LIVE

The L1 exists on Fuji: subnet `soDva7N79urhP1jb4SM8Av8XcmDQgnpfGTLjqdx8mnYDVXMKt`, blockchain
`29iRKcsUXYnLp4EFt2SAgKjn4AHFd8i7DS8CwXoeQ2mFHkL4pd`, converted with the three VPS validators (PoA, validator manager
initialised). P-Chain txs, balances and run-out dates: `deployments/fuji.json`; contracts: `deployments/fuji-l1.json`.

What actually worked (avalanche-cli 1.9.6), for a re-run:
- `blockchain deploy … --convert-only` created the subnet and chain, then stopped at an interactive prompt ("deploy
  the Validator Manager into an external blockchain?"). The conversion was finished with `avalanche blockchain convert
  ofelfuji --fuji --endpoint http://127.0.0.1:19651 --key ofelfuji --bootstrap-endpoints … --balance 0.1664 --weight 100
  --change-owner-address P-fuji1aw70… --convert-only --proof-of-authority --validator-manager-owner 0x5Cc9…148f
  --validator-manager-blockchain-id <blockchainID> --validator-manager-address 0x0Feedc0de0000000000000000000000000000000
  --verify-input=false`, after adding the Fuji subnet/blockchain IDs to the CLI sidecar.
- `contract initValidatorManager` needs `--rpc` pointing at a node that serves `/ext/bc/P` too (the SSH tunnel to v1,
  `http://127.0.0.1:19650/ext/bc/<id>/rpc`); Traefik only routes the L1 rpc/ws.
- `key transfer` (C→P) issues the export but then fails on `avax.getAtomicTxStatus`, which the public API no longer
  serves. `scripts/topup-validators.sh` does export, import and IncreaseL1ValidatorBalanceTx with avalanchejs instead.

### Commands used (history)

```bash
IP=$(ssh -i ~/.ssh/hackathon_vps root@201.18.198.162 'docker inspect -f "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}" ofel-l1-v1-1')
ssh -i ~/.ssh/hackathon_vps -f -N -L 127.0.0.1:19650:$IP:9650 root@201.18.198.162
node deploy/vps/fuji-api-shim.mjs &
avalanche blockchain deploy ofelfuji --fuji --endpoint http://127.0.0.1:19651 --key ofelfuji --same-control-key \
  --bootstrap-endpoints https://ofel-v1.201-18-198-162.sslip.io,https://ofel-v2.201-18-198-162.sslip.io,https://ofel-v3.201-18-198-162.sslip.io \
  --balance 0.4 --weight 100 --change-owner-address P-fuji1aw70tg0tgqu7j3eyvxzfjmm0h5ngnxn3ed85nt --convert-only
# VPS: deployments/l1-chain-config.fuji.json -> configs/chains/<blockchainID>/config.json,
#      deployments/l1-subnet-config.json -> configs/subnets/<subnetID>.json,
#      OFEL_SUBNET_ID / OFEL_CHAIN_ID in /opt/hk/ofel-l1/.env, then docker compose up -d (tracks the subnet, adds the rpc route)
avalanche contract initValidatorManager ofelfuji --fuji --endpoint http://127.0.0.1:19651 --key ofelfuji \
  --rpc https://ofel-v1.201-18-198-162.sslip.io/ext/bc/<blockchainID>/rpc
```

Then step 4 of Option B below with `--env-file=../.env.fuji` (fresh agent, alice and bob keys, gitignored).

Ofel needs its own L1 because the seal *is* that L1's validator set. On local, the same steps produced the network that
`deployments/local.json` describes. This runbook covers two hosting options. **Nothing here has been bought, and no
account has been created.**

## What every option needs

- **Subnet-EVM**, version compatible with avalanchego v1.14.x (local used Subnet-EVM v0.8.0, RPC protocol 44). Use
  chain ID 77077 and token OFEL. The Warp precompile is enabled at genesis (`--warp`).
- **Chain config** (`deployments/l1-chain-config.json`): `"warp-api-enabled": true`. The desk and the agent call
  `warp_getMessageSignature` on each validator.
- **Subnet config** (`deployments/l1-subnet-config.json`): `k=3, alphaPreference=2, alphaConfidence=2`. With the default
  consensus parameters a 3-validator L1 halts when one validator is down; we saw this locally. With these parameters it
  keeps finalizing on 2 of 3, which matches warplock's 2-of-3 threshold.
- **Three validators.** Each one exposes its HTTP API (`/ext/info`, and `/ext/bc/<chain>/rpc` with the warp API) to the
  desk, behind CORS or a reverse proxy with TLS.
- **The P-Chain endpoint for validator BLS keys:** `https://api.avax-test.network/ext/bc/P`
  (`platform.getCurrentValidators {subnetID}` returns each L1 validator's `publicKey`).
- **About 1–2 Fuji AVAX** for CreateSubnet, CreateChain, ConvertSubnetToL1 and the validators' P-Chain balances. Ask
  Nick before spending: the shared funding key is nearly empty.

## Option A: Builder Console hosted nodes

1. In the Avalanche Builder Console (build.avax.network → Console → "Create L1"), create the subnet and the chain from
   `avalanche blockchain describe ofel --genesis` (Subnet-EVM, chain ID 77077, Warp on, PoA validator manager).
2. Under Testnet Infra → Nodes, start **three** hosted nodes that track the subnet, and convert to an L1 with those
   three as bootstrap validators.
3. Paste the chain config and subnet config above into each node's settings, if the console exposes them. **Risks:**
   hosted testnet nodes are reported to expire after about 3 days, so they would need restarting before judging on
   Nov 16–18; and the console may not let you set consensus parameters. Without `k=3/α=2`, stopping a validator stops
   the chain.
4. Needs: a Builder Console account (Nick's), and Fuji AVAX on the P-Chain.

## Option B: three self-hosted Docker validators (recommended for judging)

On a VPS with 4 vCPU, 8 GB RAM and 60 GB disk (partial primary-network sync):

```yaml
# docker-compose.yml (sketch; one service per validator, ports 9650/9651, 9652/9653, 9654/9655)
services:
  v1:
    image: avaplatform/avalanchego:v1.14.0
    command: >
      --network-id=fuji --partial-sync-primary-network=true --track-subnets=${SUBNET_ID}
      --http-host=0.0.0.0 --http-allowed-hosts=* --http-allowed-origins=*
      --chain-config-dir=/configs/chains --subnet-config-dir=/configs/subnets
    volumes: [ "./v1:/root/.avalanchego", "./configs:/configs" ]
    ports: [ "9650:9650", "9651:9651" ]
  # v2, v3: same with their own volumes and ports
```

1. Put `l1-chain-config.json` at `configs/chains/<blockchainID>/config.json` and `l1-subnet-config.json` at
   `configs/subnets/<subnetID>.json`. Place the Subnet-EVM binary in each node's plugin dir under the VM ID.
2. Start the three nodes. Collect each NodeID and BLS key with `info.getNodeID`.
3. On the operator's machine run
   `avalanche blockchain deploy ofel --fuji --bootstrap-endpoints http://VPS:9650,http://VPS:9652,http://VPS:9654`.
   This creates the subnet and chain, converts them to an L1 with the three as PoA validators, and sets up the validator
   manager.
4. Deploy the contracts:
   `OFEL_OUT=../deployments/fuji-l1.json forge script script/Deploy.s.sol --rpc-url https://VPS/ext/bc/<id>/rpc --broadcast`.
   Then run `eerc-setup.ts`, set `OFEL_NETWORK=fuji-l1` for the scripts, add `deployments/fuji-l1.json` to
   `web/src/lib/config.ts`, and run the agent on the VPS under a process manager.
5. The "one validator offline" demo is `docker stop v3`. The batch still clears with 2/3. Then run `docker start v3`.

Needs: Nick's answer on whether the VPS can run three validators. Fuji AVAX as above.

## Not covered: ICTT from the Fuji C-Chain

Bringing funds in from the C-Chain over ICM/ICTT needs Teleporter on the L1 and an icm-relayer between the Fuji C-Chain
and the Ofel L1. Both are possible once the L1 is on Fuji (`avalanche blockchain deploy --icm`, plus ICTT home on the
C-Chain and remote on the L1). This is not built, and Ofel does not claim it.
