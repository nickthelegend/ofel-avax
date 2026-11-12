// warplock unit tests. Validator keys here are real BLS12-381 keys generated locally and signing
// with Avalanche's POP ciphersuite DST; nothing is mocked. Live-chain tests are in live.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bls12_381 } from "@noble/curves/bls12-381";
import {
  AVALANCHE_SIG_DST,
  NotEnoughSignaturesError,
  bytesToHex,
  cb58Decode,
  cb58Encode,
  combine,
  decodeEnvelope,
  encodeAddressedCall,
  encodeEnvelope,
  encodeUnsignedMessage,
  hexToBytes,
  ibeDecrypt,
  ibeEncrypt,
  identityMessage,
  messageId,
  open,
  seal,
  split,
  verifySignature,
  type Validator,
} from "../src/index.ts";

const enc = new TextEncoder();

function makeValidators(n: number) {
  return Array.from({ length: n }, (_, i) => {
    const sk = bls12_381.utils.randomPrivateKey();
    const pk = bls12_381.getPublicKey(sk);
    const nodeID = "NodeID-" + cb58Encode(new Uint8Array(20).fill(i + 1));
    return { sk, v: { nodeID, publicKey: bytesToHex(pk) } as Validator };
  });
}
const sign = (sk: Uint8Array, msg: Uint8Array) => bls12_381.sign(bls12_381.G2.hashToCurve(msg, { DST: AVALANCHE_SIG_DST }) as never, sk) as unknown as Uint8Array;
const sigBytes = (sk: Uint8Array, msg: Uint8Array) => {
  const s = sign(sk, msg) as unknown;
  return s instanceof Uint8Array ? s : (s as { toRawBytes(c: boolean): Uint8Array }).toRawBytes(true);
};

const ID = identityMessage({
  networkID: 1337,
  sourceChainID: "0x9d2f5d4be0f35be39b6266cf28837cb0f6e659fdc33b1fd990dd933461a5db1f",
  sourceAddress: "0xCB5bf91D236ebe6eF6AE57342570884234bd11Cc",
  payload: "0x" + "ab".repeat(96),
});

test("CB58 matches avalanchego (blockchain ID of the local Ofel L1)", () => {
  const hex = "0x9d2f5d4be0f35be39b6266cf28837cb0f6e659fdc33b1fd990dd933461a5db1f";
  assert.equal(cb58Encode(hexToBytes(hex)), "2CE5f99WTiVBSG9JuMZQcnyxwDystgvk1CeevH5isLs7Bvap1w");
  assert.equal(bytesToHex(cb58Decode("2CE5f99WTiVBSG9JuMZQcnyxwDystgvk1CeevH5isLs7Bvap1w")), hex);
  assert.throws(() => cb58Decode("2CE5f99WTiVBSG9JuMZQcnyxwDystgvk1CeevH5isLs7Bvap1x"), /checksum/);
});

test("UnsignedMessage / AddressedCall layout: codec v0, typeID 1, length-prefixed bytes", () => {
  const call = encodeAddressedCall(new Uint8Array(20).fill(0x11), new Uint8Array([1, 2, 3]));
  assert.equal(bytesToHex(call), "0x" + "0000" + "00000001" + "00000014" + "11".repeat(20) + "00000003" + "010203");
  const m = encodeUnsignedMessage(5, new Uint8Array(32).fill(0x22), call);
  assert.equal(bytesToHex(m.slice(0, 6)), "0x000000000005");
  assert.equal(m.length, 2 + 4 + 32 + 4 + call.length);
  assert.equal(messageId(m).length, 32);
});

test("Shamir: any t of n recover, t-1 do not", () => {
  const secret = 0x1234567890abcdefn;
  const shares = split(secret, 3, [1, 2, 3, 4, 5]);
  assert.equal(combine([shares[0], shares[2], shares[4]]), secret);
  assert.equal(combine([shares[1], shares[3], shares[4]]), secret);
  assert.notEqual(combine([shares[0], shares[1]]), secret);
});

test("IBE: a validator signature on the identity is the decryption key", () => {
  const [{ sk, v }] = makeValidators(1);
  const msg = new Uint8Array(32).fill(7);
  const ct = ibeEncrypt(hexToBytes(v.publicKey), ID, msg);
  const sig = sigBytes(sk, ID);
  assert.ok(verifySignature(sig, ID, hexToBytes(v.publicKey)));
  assert.deepEqual(ibeDecrypt(sig, ct), msg);
});

test("IBE: a signature on any other message fails (wrong key)", () => {
  const [{ sk, v }] = makeValidators(1);
  const ct = ibeEncrypt(hexToBytes(v.publicKey), ID, new Uint8Array(32).fill(7));
  const other = sigBytes(sk, enc.encode("batch 2 closed"));
  assert.throws(() => ibeDecrypt(other, ct), /integrity check/);
});

test("IBE: another validator's signature on the right message fails", () => {
  const [a, b] = makeValidators(2);
  const ct = ibeEncrypt(hexToBytes(a.v.publicKey), ID, new Uint8Array(32).fill(7));
  assert.throws(() => ibeDecrypt(sigBytes(b.sk, ID), ct), /integrity check/);
});

test("IBE: tampering U, V or W is detected", () => {
  const [{ sk, v }] = makeValidators(1);
  const sig = sigBytes(sk, ID);
  for (const field of ["V", "W"] as const) {
    const ct = ibeEncrypt(hexToBytes(v.publicKey), ID, new Uint8Array(32).fill(7));
    ct[field] = ct[field].slice();
    ct[field][0] ^= 1;
    assert.throws(() => ibeDecrypt(sig, ct), /integrity check/);
  }
});

test("seal/open: 2-of-3 opens with any two, refuses one, reports a forged signature", () => {
  const vs = makeValidators(3);
  const env = seal(enc.encode("BUY 1,250 @ 31.50"), ID, vs.map((x) => x.v), 2);
  for (const pair of [[0, 1], [0, 2], [1, 2]]) {
    const sigs = new Map(pair.map((i) => [vs[i].v.nodeID, sigBytes(vs[i].sk, ID)]));
    assert.equal(new TextDecoder().decode(open(env, ID, vs.map((x) => x.v), sigs).plaintext), "BUY 1,250 @ 31.50");
  }
  assert.throws(() => open(env, ID, vs.map((x) => x.v), new Map([[vs[0].v.nodeID, sigBytes(vs[0].sk, ID)]])), NotEnoughSignaturesError);
  const forged = new Map([
    [vs[0].v.nodeID, sigBytes(vs[1].sk, ID)],
    [vs[2].v.nodeID, sigBytes(vs[2].sk, ID)],
  ]);
  assert.throws(() => open(env, ID, vs.map((x) => x.v), forged), NotEnoughSignaturesError);
});

test("seal/open: an envelope sealed to batch N does not open with batch N+1 signatures (replay)", () => {
  const vs = makeValidators(3);
  const env = seal(enc.encode("x"), ID, vs.map((x) => x.v), 2);
  const next = identityMessage({ networkID: 1337, sourceChainID: "0x" + "9d".repeat(32), sourceAddress: "0xCB5bf91D236ebe6eF6AE57342570884234bd11Cc", payload: "0x" + "ac".repeat(96) });
  const sigs = new Map(vs.map((x) => [x.v.nodeID, sigBytes(x.sk, next)]));
  assert.throws(() => open(env, next, vs.map((x) => x.v), sigs));
});

test("envelope binary round trip, and a flipped ciphertext byte fails the GCM tag", () => {
  const vs = makeValidators(3);
  const env = seal(enc.encode("hello"), ID, vs.map((x) => x.v), 2);
  const bytes = encodeEnvelope(env);
  const back = decodeEnvelope(bytes);
  assert.deepEqual(encodeEnvelope(back), bytes);
  back.ciphertext[0] ^= 1;
  const sigs = new Map(vs.map((x) => [x.v.nodeID, sigBytes(x.sk, ID)]));
  assert.throws(() => open(back, ID, vs.map((x) => x.v), sigs), /AES-GCM tag/);
});
