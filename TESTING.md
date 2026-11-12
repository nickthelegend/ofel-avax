# Testing

All counts below come from real runs on 2026-11-12. The chain-facing suites ran against the live **Fuji** Ofel L1
(avalanchego v1.15.3, Subnet-EVM v1.15.3, 3 PoA validators on the VPS) and, before that, the local Ofel L1. Nothing in
them is mocked.

| Suite | Command | Count | Result | Touches a chain? |
|---|---|---|---|---|
| Contracts (Foundry) | `cd contracts && forge test` | 35 tests: OfelBook 31 (two fuzz suites with 256 runs each), OfelFaucet 4 | 35/35 pass | No: EVM unit tests (see the note below) |
| warplock unit | `pnpm --filter warplock test` | 10 | 10/10 pass | No: real BLS12-381 keys generated locally |
| @ofel/core unit | `pnpm --filter @ofel/core test` | 7 | 7/7 pass | No |
| Live end-to-end, **Fuji** | `cd scripts && OFEL_E2E_AGENT_LOGS="ssh … docker logs -f --since 1s ofel-l1-agent-1" node --env-file=../.env.fuji e2e.ts` | 31 live checks | 31/31 pass (docs/fuji-e2e-output.txt) | **Yes: the Fuji L1, the Fuji P-Chain, the 3 VPS validators, eERC and the hosted agent** |
| Live end-to-end, local | `pnpm test:live` (scripts/e2e.ts) | 31 live checks | 31/31 pass | Yes, the local L1 |
| Hosted judge path | browser, https://ofel-desk.vercel.app, fresh Test wallet | faucet → register → deposit → seal → clear → pay-in → settle → bond | done, tx hashes in `deployments/fuji-l1.json` `hostedJudgeRun` | Yes, Fuji L1 |
| Go/no-go spike | `node scripts/spike.ts` | 9 checks (docs/spike-output.txt) | GO | Yes |
| UI screenshots (hosted) | `OFEL_QA_URL=https://ofel-desk.vercel.app OFEL_QA_NET=fuji-l1 node --env-file=../../.env.fuji scripts/qa/shots.mjs` | 9 routes × 2 widths = 18 | 0 px overflow, 0 console errors | Yes, the hosted desk on the Fuji L1 |

## What the Foundry suite covers
- **Early open:** `closeBatch` before T reverts with `TooEarly`, and no Warp message is emitted. A second close reverts
  with `AlreadyClosed`. An unknown batch reverts. A reveal before close reverts.
- **Replays:** an identical commitment submitted by another account is rejected. An order replayed into a later batch is
  rejected. A reveal reused for another trader's order fails, because the commitment binds the trader. A double reveal
  fails.
- **Wrong keys:** a wrong salt, a flipped side and a changed limit each fail `InvalidReveal`. A wrong total or a wrong
  blind fails `TotalsMismatch`. Clearing as a non-agent fails.
- **Clearing:** uniform price and pro rata (31.35, 900/1,250 filled); a five-order inclusion check; a batch that doesn't
  cross; the reveal window, with unrevealed orders voided; an agent void.
- **Size privacy:** no plaintext size appears in any log word or stored field, and the same size committed twice gives
  unlinkable commitments.
- **Pedersen:** H is derived exactly as documented, and a fuzz test checks the homomorphism.
- **Fuzz:** the clearing price lies within every filled order's limit, and a cross always has both sides.
- **Bonds:** settle, claim, a non-trader claim is refused, a lapsed bond is swept after the window, and an early sweep is
  refused.

> **Note on the Foundry suite.** Foundry's EVM has no Subnet-EVM precompiles, so the unit tests put a small recorder at
> the Warp precompile address to capture the payload. The real precompile, real validator signatures and real decryption
> are tested only in the live suites.

## What the live e2e covers (scripts/e2e.ts → deployments/fuji-l1.json `e2e`, and local.json for the local run)
1. Two traders seal orders, and the transaction input of each holds no plaintext size or limit word (1,248 B of ciphertext).
2. `closeBatch` before T reverts with `TooEarly`, and each of the 3 validators refuses to sign (`not found`). The trader
   can still read their own order before T.
3. The batch clears at 31.35 with buy and sell totals proven against the commitments. All 3 validator signatures are
   verified against their P-Chain keys. Both legs settle as private eERC transfers. The agent pays out and marks both
   orders settled, and the bonds are returned.
4. The auditor decrypts the private legs, and the buyer's private balance includes the fill.
5. **One validator stopped:** on Fuji the container `ofel-l1-v3-1` (`NodeID-9by3D2T4Kh2XrDKmwt1kAaksZdqwvWEJX`) is
   stopped, and batch 3 still closes, opens with **2/3** signatures, clears and settles; the L1 keeps finalizing on 2 of
   3 (`k=3 α=2`). The validator is then restarted and catches up. (Locally: `NodeID-MNFf…` was killed.)

warplock's unit tests also cover: a signature on any other message fails; another validator's signature fails; tampered
U/V/W is detected; any 2 of 3 open the envelope; 1 of 3 is refused; a forged signature is rejected before use; batch N's
envelope does not open with batch N+1's signatures; and a flipped ciphertext byte fails the GCM tag.

Run `pnpm test:live` only while no other `agent.ts` is running, because the suite starts its own. On Fuji the suite
follows the hosted agent instead (`OFEL_E2E_AGENT_LOGS`), and the house ignores the two scripted traders, so the
expected prices hold.

## Faucet (OfelFaucet.t.sol)
One drip per address (a second reverts `AlreadyClaimed`), only the operator can drip, an empty faucet reverts without
marking the wallet, and only the owner can change the operator or sweep. On Fuji the relay additionally limits each IP
to 5 wallets an hour.
