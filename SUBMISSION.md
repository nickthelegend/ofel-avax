# Ofel: submission

**Name:** Ofel (Hebrew אופל, "deep darkness")

**One-liner:** Trade size without being front-run. Private block trading for funds, DAOs and treasuries: your order
stays sealed until the batch closes, and your size is never made public. On its own Avalanche L1.

**Event:** Team1 India "Build Anything on Avalanche" speedrun. The deadline is Nov 14 22:59 UTC.

## Description
Funds, DAOs and treasuries can't move size on-chain without being front-run or watched. Commit-reveal sealed auctions
fix part of this, but they need a trusted operator or let traders choose not to reveal. Encrypted mempools still show
your size afterwards.

Ofel runs sealed batches on its own Avalanche L1. Each order is encrypted to the exact Warp message the L1 will emit
when its batch closes at time T. The decryption key is the L1 validators' own BLS signatures on that message: any 2 of
the 3. Before T the contract refuses to close and every validator refuses to sign, because the message doesn't exist
yet. At T, anyone closes the batch, collects the signatures and opens every order at once. That removes both the
operator who could peek and the free option not to reveal.

The contract sets one uniform price from the revealed limits. Sizes are never in the part that opens: each order
carries a Pedersen commitment. The clearing agent, which is also the compliance auditor, reads sizes only from T onward
and proves the batch totals against the sum of the commitments on-chain. Fills settle as private transfers in Ava Labs'
encrypted ERC, so balances and legs stay encrypted, and the auditor key decrypts them for compliance.

We built the timelock as **warplock**, an open-source TypeScript SDK that turns any Avalanche L1's validator set into a
timelock. Exam papers, sealed tenders and results embargoes could all use it.

## How it uses Avalanche
- **Its own L1, on Fuji:** a Subnet-EVM L1 created and converted with ConvertSubnetToL1, with three PoA validators we
  run and fund on the P-Chain (IncreaseL1ValidatorBalanceTx). The app reads the validator set and BLS keys from the P-Chain. The
  consensus parameters (`k=3, α=2`) were tuned so one validator can be offline.
- **Avalanche Warp:** the core mechanism. The validators' BLS signatures on a Warp message are the IBE keys. We encode
  the message byte-for-byte to match avalanchego, so its message ID matches the precompile's.
- **eERC (Ava Labs EncryptedERC):** converter mode. It holds private balances and the private settlement legs, with
  Groth16 proofs made in the browser and an auditor key.
- **Precompiles:** Warp (`0x…05`), plus BN254 ecAdd/ecMul for the Pedersen total proofs.

## Tech stack
Solidity 0.8.27 with Foundry; Ava Labs EncryptedERC (vendored, prod verifiers); TypeScript; @noble/curves (BLS12-381,
BN254, x25519); viem; @avalabs/eerc-sdk with snarkjs; React and Vite; Avalanche-CLI, avalanchejs and avalanchego v1.15.3 for the
Fuji L1; Playwright for QA.

## Live links
- **Desk (hosted):** https://ofel-desk.vercel.app. Connect → **Test wallet** → **Get test funds** (one tap: OFEL gas,
  tAVAX and tUSDC from the Ofel faucet contract on the L1, then eERC registration and deposits) → seal an order. No
  Fuji AVAX and no browser extension needed. A house wallet quotes blind into any batch you trade in.
- **The Ofel L1 on Fuji:** [Avalanche Explorer](https://subnets-test.avax.network/subnets/soDva7N79urhP1jb4SM8Av8XcmDQgnpfGTLjqdx8mnYDVXMKt),
  [ConvertSubnetToL1Tx](https://subnets-test.avax.network/p-chain/tx/9E9JwtLhCSSRGkfD5VwWhJuuAJxDUvhBQeQemf7HTdRbFPSw3).
  Three PoA validators we run, RPC with the warp API at
  `https://ofel-v1.201-18-198-162.sslip.io/ext/bc/29iRKcsUXYnLp4EFt2SAgKjn4AHFd8i7DS8CwXoeQ2mFHkL4pd/rpc`.
  Contract addresses and every recorded tx hash: README "Live deployment (Fuji)" and `deployments/fuji-l1.json`.
  No hosted explorer indexes the L1's own EVM txs; check them with `cast receipt` on that RPC, or on the desk's
  Batches pages.
- **Repo:** (to be pushed by Nick).
- **Demo video:** (link to be added after upload). Film: `grokbot/videos/ofel-avax/ofel-avax-film.mp4` (2:55, 1080p) and
  `ofel-avax-film-share.mp4` (720p, 9.8 MB), v6 of round 3, recorded live on the hosted desk on Nov 13 (00:00 UTC) from a
  brand-new test wallet: batch #323 (our buy of 1,000 among 9 sealed orders) refused early by the contract and all
  three validators, opened with 3 of 3 BLS signatures, cleared at 8.34 with public totals of 1,820 / 2,432 (no single
  size shown), settled privately; `cast receipt` of the seal, the clear and the private payment from the L1 RPC; the
  ConvertSubnetToL1Tx and the L1's three validators on Avalanche's explorer. Every version is kept in
  `videos/ofel-avax/versions/` (v1 = old desk), with the independent judge's notes in `videos/ofel-avax/film/JUDGE-vN.md`.
