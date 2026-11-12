# Ofel

**Private block trading on Avalanche. Your order is sealed before its price exists, and your size stays private for good.**

Ofel (Hebrew אופל, "deep darkness") is a sealed-batch trading desk for funds, DAOs and treasuries that move size and
don't want to be front-run or watched. It runs on its own Avalanche L1. The batch seal is held by that L1's validators,
not by an operator, and balances and fills live in Ava Labs' encrypted ERC (eERC), which has an auditor key for
compliance.

> Status: everything below runs live on a **local** Avalanche network (avalanchego v1.14.0, one Subnet-EVM L1 with three
> PoA validators). There is **no Fuji deployment yet**. The Fuji L1 needs validator hosting, and Nick still has to choose
> the hosting option. See [scripts/deploy-l1-fuji.md](scripts/deploy-l1-fuji.md) and the "What is not done" section.

## How it works

1. **The seal: warplock.** Each batch has a close time T. The trader's browser encrypts the order to the exact bytes of
   the Avalanche Warp message that `OfelBook.closeBatch(batchId)` will emit at T:
   `UnsignedMessage(networkID, L1 chainID, AddressedCall(OfelBook, abi.encode(tag, batchId, T)))`.
   The scheme is identity-based encryption (Boneh–Franklin over BLS12-381, the same idea as tlock). Its "identity" is
   that message, and its key is a validator's BLS signature on it. Avalanche keys are min-pk with the POP ciphersuite, so
   a signature `sk·H(m)` *is* the IBE private key for `m`. A random secret is Shamir-split 2-of-3 across the validators'
   BLS keys, which the app reads live from the P-Chain, and the order is AES-GCM encrypted under that secret.
2. **The order can't be opened before T.** `closeBatch` reverts with `TooEarly` before T. Validators only sign Warp
   messages their chain has accepted, so before T `warp_getMessageSignature` answers "not found" on every validator.
3. **At T, anyone can open it.** Anyone calls `closeBatch`. The precompile emits the message, any 2 of the 3 validators
   sign it, and those signatures open every order. Reveals are checked on-chain against each order's commitment.
4. **One price.** The contract sets the uniform price from the revealed limits alone: bids are sorted high to low, asks
   low to high, and the price is the midpoint of the last crossing pair. It never needs anyone's size to find the price.
5. **Sizes stay private.** A size is never inside the part of the order that opens at T. Each order carries a Pedersen
   commitment on BN254, and the size goes to the clearing agent in a blob encrypted to the agent's x25519 key. That blob
   sits inside the timelock, so the agent can't read it before T either. At clearing the agent submits the buy and sell
   totals, and `OfelBook` checks `Σ C = total·G + blind·H` with the ecAdd/ecMul precompiles. Totals are public, and no
   single order's size ever is.
6. **Settlement is in eERC.** Each trader pays their leg to the clearing hub with a private eERC transfer, proven with
   Groth16 in the browser, and the hub pays out the other leg the same way. The eERC auditor key belongs to the clearing
   agent, so the auditor can decrypt every leg and every size, and only from T onward.
7. **One validator down.** The L1 uses `k=3, alpha=2` consensus parameters, so it keeps finalizing with 2 of 3
   validators. Warplock's threshold is the same 2 of 3.

### Who sees what

| | Public | Validators | Auditor / clearing agent | You |
|---|---|---|---|---|
| Your order before T | ciphertext | ciphertext | ciphertext | yes |
| Side and limit after T | yes | yes | yes | yes |
| Your size | never | never | from T | yes |
| Batch totals and price | yes | yes | yes | yes |
| Your eERC balance | never | never | yes | yes |

### Trust model (stated plainly)

- **Seal:** if 2 or more of the 3 validators collude, they could sign a close message off-chain before T. That is the same
  threshold the L1's own consensus relies on. A production set would be independent operators.
- **Clearing agent:** this role is trusted to settle the legs (the CCP model), to submit totals, and for any voids it
  declares. The totals themselves are verified on-chain against the commitments, and voids are logged. It cannot read
  orders before T. The agent is also the eERC auditor.
- **Not enforced on-chain (v2):** a range proof on committed sizes (today the agent voids out-of-range sizes off-chain),
  and delivery-versus-payment without a hub (this needs a custom eERC settlement circuit).
- A block proposer can skew `block.timestamp` by a few seconds. BLS and IBE are not post-quantum.

## Repository

| Path | What it is |
|---|---|
| `packages/warplock` | **warplock**, a reusable open-source TypeScript SDK that turns any Avalanche L1's validator set into a timelock. It has byte-exact Warp `UnsignedMessage`/`AddressedCall` encoding, CB58, IBE keyed by Avalanche BLS keys, Shamir over Fr, AES-GCM envelopes, and P-Chain and warp RPC readers. |
| `packages/ofel` | `@ofel/core`: order sealing, Pedersen commitments (matching `Pedersen.sol`), agent and self blobs, the clearing mirror and the ABIs. |
| `contracts/` | Foundry: `OfelBook.sol`, `Pedersen.sol`, test assets, and Ava Labs eERC vendored at upstream `8dc98cd` with its prod verifiers (Ecosystem License kept in `src/vendor/eerc/LICENSE.md`). |
| `scripts/` | `agent.ts` (clearing agent and auditor), `trader.ts` (CLI), `e2e.ts` (live suite), `spike.ts` (go/no-go), `eerc-setup.ts`, `topup.ts`, `validator.sh` (stop or start one validator), `qa/shots.mjs`. |
| `web/` | The desk, built with Vite and React: landing, Desk, Batches, Portfolio, Auditor, Validators. |
| `deployments/` | `local.json` (live addresses plus the recorded e2e and web-run tx hashes), the L1 chain and subnet configs, and `fuji.json` (not deployed). |

## Live deployment (local network)

Ofel L1: Subnet-EVM, chain ID 77077, token OFEL, subnet `2W9boARgCWL25z6pMFNtkCfNA5v28VGg9PmBgUJfuKndEdhrvw`,
blockchain `2CE5f99WTiVBSG9JuMZQcnyxwDystgvk1CeevH5isLs7Bvap1w`, 3 PoA validators, warp API on, `k=3 alpha=2`.

| Contract | Address |
|---|---|
| OfelBook | `0xCB5bf91D236ebe6eF6AE57342570884234bd11Cc` |
| EncryptedERC (converter, 2 decimals) | `0x97C0FE6aB595cbFD50ad3860DA5B2017d8B35c2E` |
| Registrar (eERC) | `0xB8a934dcb74d0E3d1DF6Bce0faC12cD8B18801eD` |
| tAVAX (test asset) | `0x8B3BC4270BE2abbB25BC04717830bd1Cc493a461` |
| tUSDC (test asset) | `0x7B4982e1F7ee384F206417Fb851a1EB143c513F9` |
| Warp precompile | `0x0200000000000000000000000000000000000005` |

These are local-network addresses, so they don't exist on any public explorer. The desk's Batches page shows the raw
transaction input of every order, which is exactly what an explorer would show. The recorded runs are in
`deployments/local.json`:

- `e2e`: batches 3 and 5, with 31 live checks. Batch 5 was opened with validator `NodeID-MNFf…` stopped.
- `webRun`: batch 50, sealed and settled from the web desk.

## Run it

```bash
pnpm install && (cd contracts && forge install)
scripts/fetch-circuits.sh                         # eERC wasm/zkeys at the pinned upstream commit
# local L1 (Avalanche-CLI), see scripts/deploy-l1-fuji.md for the exact flags and configs
cp .env.example .env                              # fill local test keys (never real ones)
(cd contracts && forge script script/Deploy.s.sol --rpc-url $OFEL_L1_RPC --broadcast)
(cd scripts && node --env-file=../.env eerc-setup.ts)
pnpm agent                                        # clearing agent: opens, closes, clears, settles
(cd web && pnpm build:qa && pnpm preview:qa)      # the desk with local QA signers on :5362
pnpm test && pnpm test:live                       # Foundry + unit, then the live e2e suite
```

## Bonus features, honestly

- **Own L1:** yes. A Subnet-EVM L1 with PoA validators, local for now; Fuji is pending hosting.
- **Avalanche Warp / ICM:** Warp is the core mechanism. The validator BLS signatures on a Warp message are the decryption
  key. There is no Teleporter or ICTT bridge from the C-Chain: a local L1 can't reach Fuji, so that part is not claimed.
- **eERC:** yes, used for real. It holds the private balances and the settlement legs, the auditor decrypts every leg,
  and proofs are generated in the browser.
- **Open-source reusable work:** yes, `warplock`.
- **Mainnet:** no.

Built with Claude Code. 3D art generated with ChatGPT. MIT © 2026 Nivesh Gajengi. The vendored eERC code keeps Ava
Labs' Ecosystem License.
