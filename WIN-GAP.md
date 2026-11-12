# Ofel: where it stands against the rubric

Honest self-score on Nov 12, 2026 (after the Fuji L1 went live), against the Avalanche Speedrun weights. Target 9/10.
"Before" is the state at the start of this round: everything ran on a local network only.

Ship round (Nov 12–13): screen-by-screen audit of every hosted route and state at 1440 and 375
([docs/SCREEN-AUDIT.md](docs/SCREEN-AUDIT.md)), the landing re-positioned for a non-crypto judge, a new art set and OG
card. Re-score in the last column.

| Criterion (weight) | Before | Nov 12 | Ship round | Why (ship round) |
|---|---|---|---|---|
| Does it work (30%) | 7.5 | 8.8 | 8.9 | A signed-out judge now gets "Start with a test wallet" on the ticket instead of a disabled button; a new wallet sees "No orders yet" instead of a pointless decrypt; auditor legs name their asset. Same limits as before (one VPS for all three validators). |
| Idea and originality (25%) | 9 | 9 | 9 | Unchanged. |
| Technical depth (20%) | 9 | 9.2 | 9.2 | Unchanged. |
| Avalanche fit (15%) | 7.5 | 9 | 9 | Unchanged; the landing now says why Avalanche in the first screen and links the L1 and its P-Chain txs. |
| Demo and communication (10%) | 7.5 | 7.5 | 8 | The first screen says who it's for and what they get in one line; phone layouts fixed; OG card. The film is still not recorded. |
| **Weighted** | **8.1** | **8.8** | **8.9** | |

## What is left for 9/10, in order of value

1. **The film** (Nick or the film session): lead with the problem (front-running and watched size), then the hosted
   desk live: Test wallet → Get test funds → seal → "Try to open it now" refused by the contract and all validators →
   T → opens with the validators' signatures → one price → pay privately → the auditor's view → stop one validator on
   camera (`OFEL_NETWORK=fuji-l1 scripts/validator.sh stop NodeID-9by3D2T4Kh2XrDKmwt1kAaksZdqwvWEJX`) and clear again.
2. **Validator runway:** balances last until about **2026-11-26 00:06 UTC** (0.5919 AVAX each). Nothing to do before
   judging; for longer, `scripts/topup-validators.sh 0.3 "Ofel validators"`.
3. **Independent validators.** All three run on our one VPS, so the 2-of-3 seal is only as independent as that box.
   A second operator (or one Builder Console node) would make the trust claim real. Not done.
4. **ICTT deposits** from the Fuji C-Chain into the L1: needs Teleporter on the L1 and a relayer. Not built, not claimed.
5. **On-chain range proof** for committed sizes and DvP without the hub (custom eERC circuit). Not built; the README's
   trust model says so.

## Things that are real and easy to miss

- The faucet's one-per-wallet rule is in the contract (`OfelFaucet.claimed`), not in the server; the relay only pays
  the gas a new wallet doesn't have.
- The house sees only that a wallet sealed something (the trader address is public); it quotes 31.30 / 31.40 blind and
  can't read the size or limit it is trading against.
- The desk's runway figures come live from `platform.getL1Validator` on the Fuji P-Chain, counted from the P-Chain's
  own timestamp.
