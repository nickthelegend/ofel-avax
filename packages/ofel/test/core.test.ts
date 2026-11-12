import { test } from "node:test";
import assert from "node:assert/strict";
import { bls12_381 } from "@noble/curves/bls12-381";
import { bn254 } from "@noble/curves/bn254";
import { keccak_256 } from "@noble/hashes/sha3";
import { x25519 } from "@noble/curves/ed25519";
import { AVALANCHE_SIG_DST, bytesToHex, cb58Encode, type Validator } from "warplock";
import {
  BUY,
  SELL,
  H,
  addBlinds,
  batchIdentity,
  clearingPrice,
  commit,
  fillFor,
  inCross,
  openAgentBlob,
  openMine,
  openOrder,
  opens,
  randomBlind,
  sealOrder,
  selfKeyFromSignature,
  sumCommitments,
  type BookContext,
} from "../src/index.ts";

const ctx: BookContext = { chainId: 77077, networkID: 1337, blockchainIdHex: `0x${"9d".repeat(32)}`, book: "0xCB5bf91D236ebe6eF6AE57342570884234bd11Cc" };

test("Pedersen H is derived exactly as Pedersen.sol documents", () => {
  const h = keccak_256(new Uint8Array([...new TextEncoder().encode("ofel/pedersen/H/v1"), 0]));
  let x = 0n;
  for (const b of h) x = (x << 8n) | BigInt(b);
  assert.equal(bn254.fields.Fp.create(x), H.toAffine().x);
  assert.equal(H.toAffine().y % 2n, 0n);
});

test("Pedersen: homomorphic sums open to the total with the summed blinds", () => {
  const sizes = [125_000n, 40_000n, 7n];
  const blinds = sizes.map(() => randomBlind());
  const sum = sumCommitments(sizes.map((s, i) => commit(s, blinds[i])));
  assert.ok(opens(sum, 165_007n, addBlinds(blinds)));
  assert.ok(!opens(sum, 165_008n, addBlinds(blinds)));
});

test("Pedersen: equal sizes give unlinkable commitments", () => {
  assert.notEqual(commit(500n, randomBlind()).x, commit(500n, randomBlind()).x);
});

test("clearing: midpoint of the last crossing pair, inclusion by limit", () => {
  const os = [
    { index: 0, side: BUY, limit: 3200n },
    { index: 1, side: BUY, limit: 3100n },
    { index: 2, side: SELL, limit: 3050n },
    { index: 3, side: SELL, limit: 3150n },
    { index: 4, side: BUY, limit: 2900n },
  ];
  const p = clearingPrice(os);
  assert.equal(p, 3125n);
  assert.deepEqual(os.filter((o) => inCross(o, p)).map((o) => o.index), [0, 2]);
  assert.equal(clearingPrice([{ index: 0, side: BUY, limit: 3000n }, { index: 1, side: SELL, limit: 3100n }]), 0n);
});

test("fills: long side scaled pro rata, one price, matches OfelBook.fillFor", () => {
  assert.deepEqual(fillFor(BUY, 125_000n, 3135n, 125_000n, 90_000n), { base: 90_000n, quote: 2_821_500n });
  assert.deepEqual(fillFor(SELL, 90_000n, 3135n, 125_000n, 90_000n), { base: 90_000n, quote: 2_821_500n });
  assert.deepEqual(fillFor(BUY, 50_000n, 3000n, 100_000n, 60_000n), { base: 30_000n, quote: 900_000n });
});

function validators(n: number) {
  return Array.from({ length: n }, (_, i) => {
    const sk = bls12_381.utils.randomPrivateKey();
    return { sk, v: { nodeID: "NodeID-" + cb58Encode(new Uint8Array(20).fill(i + 9)), publicKey: bytesToHex(bls12_381.getPublicKey(sk)) } as Validator };
  });
}
function sig(sk: Uint8Array, m: Uint8Array): Uint8Array {
  const s = bls12_381.sign(bls12_381.G2.hashToCurve(m, { DST: AVALANCHE_SIG_DST }) as never, sk) as unknown;
  return s instanceof Uint8Array ? s : (s as { toRawBytes(c: boolean): Uint8Array }).toRawBytes(true);
}

test("order: sealed to the batch, opened at close; size only for the agent and the trader", () => {
  const vs = validators(3);
  const agentSk = x25519.utils.randomPrivateKey();
  const selfKey = selfKeyFromSignature(`0x${"12".repeat(65)}`);
  const o = { batchId: 4n, closeAt: 1_800_000_000n, trader: "0xA08B96d2076E96321051697fDE922Ac7123d0D06" as const, side: BUY as 1, limit: 3150n, size: 125_000n };
  const s = sealOrder(ctx, o, vs.map((x) => x.v), 2, x25519.getPublicKey(agentSk), selfKey);

  const id = batchIdentity(ctx, 4n, 1_800_000_000n);
  const opened = openOrder(s.envelope, id, vs.map((x) => x.v), new Map(vs.slice(1).map((x) => [x.v.nodeID, sig(x.sk, id)])));
  assert.equal(opened.side, BUY);
  assert.equal(opened.limit, 3150n);
  assert.equal(opened.agentBlobHash, s.agentBlobHash);
  // The opened envelope reveals no size: only the agent's key reads it.
  assert.ok(!JSON.stringify(opened, (_, v) => (typeof v === "bigint" ? v.toString() : v)).includes("125000"));
  const blob = openAgentBlob(agentSk, opened.agentBlob);
  assert.equal(blob.size, 125_000n);
  assert.ok(opens(s.c, blob.size, blob.blind));
  assert.throws(() => openAgentBlob(x25519.utils.randomPrivateKey(), opened.agentBlob), /not for this agent/);

  const mine = openMine(selfKey, s.envelope);
  assert.equal(mine?.size, 125_000n);
  assert.equal(openMine(selfKeyFromSignature(`0x${"34".repeat(65)}`), s.envelope), null);
});

test("order: signatures for another batch cannot open it", () => {
  const vs = validators(3);
  const s = sealOrder(ctx, { batchId: 4n, closeAt: 1_800_000_000n, trader: "0xA08B96d2076E96321051697fDE922Ac7123d0D06", side: SELL, limit: 3100n, size: 9n }, vs.map((x) => x.v), 2, x25519.getPublicKey(x25519.utils.randomPrivateKey()), new Uint8Array(32));
  const wrong = batchIdentity(ctx, 5n, 1_800_000_000n);
  assert.throws(() => openOrder(s.envelope, wrong, vs.map((x) => x.v), new Map(vs.map((x) => [x.v.nodeID, sig(x.sk, wrong)]))));
});

test("house ladder: blind, several orders per side, totals never equal one outside order", async () => {
  const { houseLadder, checkLadder, ladderBand } = await import("../src/ladder.ts");
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  for (const answer of [830785204n, 835469261n, 3125000000n]) {
    const { lo, hi } = ladderBand(answer, 15n);
    for (let i = 0; i < 50; i++) {
      const l = houseLadder({ answer, rand });
      for (const side of [BUY, SELL] as const) assert.ok(l.filter((o) => o.side === side).length >= 3 && l.filter((o) => o.side === side).length <= 5);
      for (const o of l) {
        assert.ok(o.limit >= lo && o.limit <= hi, "limit inside ±0.15% of Chainlink");
        assert.equal(o.size % 100n, 0n, "whole tAVAX sizes");
      }
      // A 1,000 tAVAX order at Chainlink ±0.5% (the desk's default) on either side: fills in full, and at least
      // two orders fill on each side, so neither public total equals that order's size.
      for (const [side, limit] of [[BUY, (answer * 10050n) / 10000n / 1000000n + 1n], [SELL, (answer * 9950n) / 10000n / 1000000n]] as const) {
        const c = checkLadder(l, { side, size: 100_000n, limit });
        assert.equal(c.outsideFill, 100_000n);
        assert.ok(c.buys >= 2 && c.sells >= 2);
        assert.ok(c.price >= lo && c.price <= hi);
      }
    }
  }
});
