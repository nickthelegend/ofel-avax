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
- **Repo:** https://github.com/nickthelegend/ofel-avax
- **Demo video:** (link to be added after upload), in `grokbot/videos/ofel-avax/`:
  - **Film** `ofel-avax-film.mp4` (4:59.6, 1080p, voice only, no music; `ofel-avax-film-share.mp4` 720p, 9.97 MB), v18 of
    round 5. It opens on the live landing, then the sandwich lab on a local Anvil fork of Fuji (a demo pool and a real
    mempool-reading bot: front-run, victim, back-run in one block, the victim 224.48 tUSDC over its quote, the bot +156.46)
    and the same reading on the Ofel L1 (hash, commitment, ciphertext); the seal explained (what the browser encrypts, what
    the chain stores, the Warp-message key, 2 of 3 signatures at the close, the trade-offs); the live trade of Nov 13 on
    batch #1165 (test funds, seal, early open refused, validator 3 off, 2 of 3 open, one price 8.21, signatures, private
    pay-in); today's tBTC batch #8 and tETH batch #8 on the three-market desk; the desk's L1 explorer, `cast receipt`s
    from the public RPC and the ConvertSubnetToL1Tx on Avalanche's explorer.
  - **Full walkthrough** `ofel-avax-walkthrough.mp4` (4:43, v17) and the earlier 2:59 cut (v17, `versions/`).
  The take's transactions and the validator-3 stop/start are in `deployments/fuji-l1.json` → `filmV10Run`; today's
  market batches in `filmV18Run`. Every version
  and its judge notes: `grokbot/videos/ofel-avax/versions/` and `videos/ofel-avax/film/JUDGE-v*.md`.