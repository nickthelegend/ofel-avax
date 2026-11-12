# Ofel: where it stands against the rubric

Honest self-score on Nov 12, 2026 (after the Fuji L1 went live), against the Avalanche Speedrun weights. Target 9/10.
"Before" is the state at the start of this round: everything ran on a local network only.

| Criterion (weight) | Before | Now | Why |
|---|---|---|---|
| Does it work (30%) | 7.5 | 8.8 | The L1 is real on Fuji (ConvertSubnetToL1, 3 PoA validators, validator manager initialised) and the desk is hosted. A fresh wallet on https://ofel-desk.vercel.app reached a settled fill with zero setup: Test wallet, one tap for faucet + eERC key + deposits, sealed buy, the house's blind quote, clear at 31.45 with 3/3 signatures, private pay-in, payout, bond back (`hostedJudgeRun`). The e2e passes 31/31 on Fuji, including a batch opened with 2/3 while a validator was stopped. Not higher: the first eERC proof takes a few seconds on a slow laptop, and all three validators run on one VPS, so a VPS outage stops the L1. |
| Idea and originality (25%) | 9 | 9 | Unchanged: the L1's own validator set as a timelock (IBE keyed by Warp BLS signatures), so no operator can read the book before T, plus sizes that never open. |
| Technical depth (20%) | 9 | 9.2 | Added the real L1 lifecycle: P-Chain fee balances via avalanchejs (C→P export, import, IncreaseL1ValidatorBalanceTx, equalised so all three run out together), an on-chain faucet with a relay, and a house that quotes without reading orders and settles over eERC like any trader. |
| Avalanche fit (15%) | 7.5 | 9 | Own L1 on Fuji with Warp at the core, Ava Labs eERC unmodified for balances and legs (auditor key used), ACP-77 validator fees handled. Still no ICM/ICTT bridge from the C-Chain. |
| Demo and communication (10%) | 7.5 | 7.5 | Screenshots at 1440 and 375 of every hosted route (`orchestration/shots/avax-ofel/fuji/`), README with every Fuji tx. The film is not recorded yet. |
| **Weighted** | **8.1** | **8.8** | |

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
