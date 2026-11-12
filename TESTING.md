# Testing

All counts below come from real runs on 2026-11-12. The chain-facing suites run against the live local Ofel L1
(avalanchego v1.14.0, Subnet-EVM, 3 validators). Nothing in them is mocked.

| Suite | Command | Count | Result | Touches a chain? |
|---|---|---|---|---|
| Contracts (Foundry) | `cd contracts && forge test` | 31 tests (two fuzz suites with 256 runs each) | 31/31 pass | No: EVM unit tests (see the note below) |
| warplock unit | `pnpm --filter warplock test` | 10 | 10/10 pass | No: real BLS12-381 keys generated locally |
| @ofel/core unit | `pnpm --filter @ofel/core test` | 7 | 7/7 pass | No |
| Live end-to-end | `pnpm test:live` (scripts/e2e.ts) | 31 live checks | 31/31 pass | **Yes, the live L1, P-Chain, every validator and eERC** |
| Go/no-go spike | `node scripts/spike.ts` | 9 checks (docs/spike-output.txt) | GO | Yes |
| UI screenshots | `node scripts/qa/shots.mjs` | 8 routes × 2 widths = 16 | 0 px overflow, 0 console errors | Yes, through the live desk |

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

## What the live e2e covers (scripts/e2e.ts → deployments/local.json `e2e`)
1. Two traders seal orders, and the transaction input of each holds no plaintext size or limit word (1,248 B of ciphertext).
2. `closeBatch` before T reverts with `TooEarly`, and each of the 3 validators refuses to sign (`not found`). The trader
   can still read their own order before T.
3. The batch clears at 31.35 with buy and sell totals proven against the commitments. All 3 validator signatures are
   verified against their P-Chain keys. Both legs settle as private eERC transfers. The agent pays out and marks both
   orders settled, and the bonds are returned.
4. The auditor decrypts the private legs, and the buyer's private balance includes the fill.
5. **One validator stopped:** `NodeID-MNFfnXYxqu6RwKWJHcjiqspQywFaVETww` is killed, and the next batch still closes,
   opens with **2/3** signatures, clears and settles. The validator is then restarted.

warplock's unit tests also cover: a signature on any other message fails; another validator's signature fails; tampered
U/V/W is detected; any 2 of 3 open the envelope; 1 of 3 is refused; a forged signature is rejected before use; batch N's
envelope does not open with batch N+1's signatures; and a flipped ciphertext byte fails the GCM tag.

Run `pnpm test:live` only while no other `agent.ts` is running, because the suite starts its own.
