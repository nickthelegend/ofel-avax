# Ofel: submission

**Name:** Ofel (Hebrew אופל, "deep darkness")

**One-liner:** Private block trading on Avalanche. Your order is sealed before its price exists, and your size stays
private for good.

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
- **Its own L1:** a Subnet-EVM L1 with PoA validators. The app reads the validator set and BLS keys from the P-Chain. The
  consensus parameters (`k=3, α=2`) were tuned so one validator can be offline.
- **Avalanche Warp:** the core mechanism. The validators' BLS signatures on a Warp message are the IBE keys. We encode
  the message byte-for-byte to match avalanchego, so its message ID matches the precompile's.
- **eERC (Ava Labs EncryptedERC):** converter mode. It holds private balances and the private settlement legs, with
  Groth16 proofs made in the browser and an auditor key.
- **Precompiles:** Warp (`0x…05`), plus BN254 ecAdd/ecMul for the Pedersen total proofs.

## Tech stack
Solidity 0.8.27 with Foundry; Ava Labs EncryptedERC (vendored, prod verifiers); TypeScript; @noble/curves (BLS12-381,
BN254, x25519); viem; @avalabs/eerc-sdk with snarkjs; React and Vite; Avalanche-CLI and avalanchego v1.14.0 for the
local L1; Playwright for QA.

## Live links
- **Network:** a local Avalanche network with the Ofel L1. Addresses and every recorded tx hash are in
  `deployments/local.json`, and the README has the table. There are **no Snowtrace links yet.** The three Fuji validators run on the
  hackathon VPS with the Fuji P-Chain synced (NodeIDs and BLS keys in `deployments/fuji.json`), and the L1 is waiting
  on about 1.25 Fuji AVAX for the deployer's P-Chain address (`scripts/deploy-l1-fuji.md`). The demo runs live against
  the local L1 until then.
- **Repo:** (to be pushed by Nick).
- **Demo video:** (to be recorded live).

## Tests
31 Foundry tests, 17 unit tests and 31 live end-to-end checks, including stopping a validator. All pass. See TESTING.md.

## AI tools used
Claude Code (all code, contracts and docs); ChatGPT image generation (the 3D object set). No Codex was used for this
build.
