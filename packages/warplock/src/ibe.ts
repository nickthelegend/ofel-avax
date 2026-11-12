// Boneh–Franklin identity-based encryption over BLS12-381, keyed by Avalanche validator BLS keys.
//
// Avalanche (avalanchego utils/crypto/bls) is "min-pk": public keys are G1 points (48 bytes),
// signatures are G2 points (96 bytes), messages hash to G2 with the POP ciphersuite DST below.
// A validator's signature on message m is sk·H(m) — which is exactly the IBE private key for
// identity m under master public key pk = sk·G1. This is the tlock construction
// (Gailly, Melissaris, Romailler — eprint 2023/189), with an Avalanche validator in place of drand.
// The Fujisaki–Okamoto transform (sigma, r = H3(sigma, M), recheck U) makes it CCA-secure.

import { bls12_381 } from "@noble/curves/bls12-381";
import { sha256 } from "@noble/hashes/sha2";
import { randomBytes } from "@noble/hashes/utils";
import { concatBytes } from "./warp.ts";

/** avalanchego utils/crypto/bls/ciphersuite.go: CiphersuiteSignature. */
export const AVALANCHE_SIG_DST = "BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_POP_";

const G1 = bls12_381.G1.ProjectivePoint;
const G2 = bls12_381.G2.ProjectivePoint;
const Fp12 = bls12_381.fields.Fp12;
const R = bls12_381.params.r;

const enc = new TextEncoder();
function tagged(tag: string, ...parts: Uint8Array[]): Uint8Array {
  return sha256(concatBytes(enc.encode(`warplock/v1/${tag}`), ...parts));
}
function xor(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.length !== b.length) throw new Error("warplock: xor length mismatch");
  return a.map((x, i) => x ^ b[i]);
}
function bytesToBig(b: Uint8Array): bigint {
  let n = 0n;
  for (const x of b) n = (n << 8n) | BigInt(x);
  return n;
}

/** H(m) on G2 exactly as an Avalanche validator hashes before signing. */
export function hashToG2(message: Uint8Array) {
  return bls12_381.G2.hashToCurve(message, { DST: AVALANCHE_SIG_DST }) as unknown as InstanceType<typeof G2>;
}

/** Verify an Avalanche validator BLS signature (G2) on message bytes against its G1 public key. */
export function verifySignature(signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array): boolean {
  try {
    return bls12_381.verify(signature, message, publicKey, { DST: AVALANCHE_SIG_DST });
  } catch {
    return false;
  }
}

function h3(sigma: Uint8Array, msg: Uint8Array): bigint {
  const wide = concatBytes(tagged("h3a", sigma, msg), tagged("h3b", sigma, msg));
  const r = bytesToBig(wide) % R;
  return r === 0n ? 1n : r;
}
function gtKey(gt: ReturnType<typeof bls12_381.pairing>): Uint8Array {
  return tagged("h2", Fp12.toBytes(gt));
}

export interface IbeCiphertext {
  /** r·G1, 48 bytes compressed. */
  U: Uint8Array;
  /** sigma XOR H2(e(pk, H(id))^r), 32 bytes. */
  V: Uint8Array;
  /** M XOR H4(sigma), 32 bytes. */
  W: Uint8Array;
}

/** Encrypt a 32-byte message to identity `identity` under validator public key `publicKey`. */
export function ibeEncrypt(publicKey: Uint8Array, identity: Uint8Array, msg: Uint8Array): IbeCiphertext {
  if (msg.length !== 32) throw new Error("warplock: IBE plaintext must be 32 bytes");
  const pk = G1.fromHex(publicKey);
  pk.assertValidity();
  const Q = hashToG2(identity);
  const sigma = randomBytes(32);
  const r = h3(sigma, msg);
  const U = G1.BASE.multiply(r);
  const gid = bls12_381.pairing(pk.multiply(r), Q);
  return { U: U.toRawBytes(true), V: xor(sigma, gtKey(gid)), W: xor(msg, tagged("h4", sigma)) };
}

/** Decrypt with the validator's BLS signature on the identity message (the IBE private key). */
export function ibeDecrypt(signature: Uint8Array, ct: IbeCiphertext): Uint8Array {
  const S = G2.fromHex(signature);
  S.assertValidity();
  const U = G1.fromHex(ct.U);
  U.assertValidity();
  const sigma = xor(ct.V, gtKey(bls12_381.pairing(U, S)));
  const msg = xor(ct.W, tagged("h4", sigma));
  const r = h3(sigma, msg);
  if (!G1.BASE.multiply(r).equals(U)) throw new Error("warplock: IBE ciphertext failed its integrity check (wrong key or tampered)");
  return msg;
}
