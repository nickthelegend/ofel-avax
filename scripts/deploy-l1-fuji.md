# Deploying the Ofel L1 to Fuji

## Status (2026-11-12, Option B chosen)

- **Done:** three avalanchego v1.15.3 validators run on the hackathon VPS (`deploy/vps/docker-compose.yml`, server folder
  `/opt/hk/ofel-l1`), each with `--partial-sync-primary-network`, the Subnet-EVM v1.15.3 plugin (rpcchainvm 47) under the
  VM ID `r4ZfHVjHDXTmiMFdhw82j1E2vE4DUeyM35nrAvRdXABoZjEqq`, and HTTPS through Traefik at
  `https://ofel-v{1,2,3}.201-18-198-162.sslip.io` (only `/ext/info`, `/ext/health` and the L1 `rpc`/`ws` are routed;
  9650 is never published). The Fuji P-Chain is bootstrapped on all three (v1 synced from the network in ~15 minutes,
  v2 and v3 started from a copy of its database). NodeIDs and BLS keys are in `deployments/fuji.json`. The avalanche-cli
  blockchain `ofelfuji` exists (chain ID 77077, OFEL, Warp on, PoA owner and proxy admin `0x5Cc9…148f`, the CLI key
  `ofelfuji`), and the genesis is `deployments/fuji-l1-genesis.json`. The agent image is built on the VPS.
- **Blocked:** about **1.25 Fuji AVAX** (minimum 0.9) on `P-fuji1aw70tg0tgqu7j3eyvxzfjmm0h5ngnxn3ed85nt` (the same key
  is `0x5Cc9CBB73d65Eb832342E788929294CD8237148f` on the C-Chain). The L1 validator fee on Fuji is 512 nAVAX per second per
  validator (0.044 AVAX a day), so 0.4 AVAX per validator lasts about 9 days, through judging. CreateSubnet itself needs only
  ~2,200 nAVAX.
- **avalanche-cli 1.9.7 vs Fuji:** the CLI calls `platform.getBalance` before every deploy, and the public Fuji API
  (avalanchego 1.15.3) answers "method not available". Our own node still serves it, so `deploy/vps/fuji-api-shim.mjs`
  sends only that call to v1 over an SSH tunnel and everything else, including every transaction, to the public API.

### Commands once funded

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
