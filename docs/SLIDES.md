# Ofel: slides (8)

1. **Title.** Ofel: trade size in the dark. Private block trading on Avalanche. (Hero: the sealed glass envelope.)
2. **Problem.** Moving $1M+ on-chain leaks it: bots front-run the order, and everyone watches the wallet afterwards.
   Sealed auctions still trust an operator, or let bidders choose not to reveal.
3. **The idea.** Seal each order to a message that doesn't exist yet: the Warp message our L1 emits when the batch
   closes. The L1's own validators' signatures on it are the key. Nobody can open the batch early: not us, and not a
   single validator.
4. **How it works.** Seal (IBE to validator BLS keys from the P-Chain, 2-of-3 Shamir) → `TooEarly` before T, and
   validators answer "not found" → close at T → any 2 signatures open every order → one price from the limits → totals
   proven against Pedersen commitments → private eERC settlement.
5. **Who sees what.** The matrix: the public sees ciphertext, then side, limit and totals; the auditor sees sizes from T
   onward; you see your own order.
6. **Live demo.** Two traders seal orders. The raw tx input shows ciphertext only. "Try to open it now" fails twice. At
   T the batch clears at 31.35. Private pay-ins. The auditor view. `validator.sh stop`, and the next batch opens with 2/3.
7. **Avalanche fit and depth.** Own L1 (Subnet-EVM, consensus tuned for 2/3); Warp as a timelock; eERC with in-browser
   Groth16; BN254 precompiles; **warplock**, an open-source SDK. 31 Foundry tests, 17 unit tests and 31 live checks.
8. **Honest limits and next steps.** Validator collusion at threshold; agent-trusted settlement and voids (CCP model);
   next: range proofs on sizes, a DvP eERC circuit, ICTT from the C-Chain, and independent validator operators on Fuji
   and then mainnet.
