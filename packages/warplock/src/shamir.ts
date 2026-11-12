// Shamir secret sharing over the BLS12-381 scalar field Fr.
import { bls12_381 } from "@noble/curves/bls12-381";
import { randomBytes } from "@noble/hashes/utils";

const Fr = bls12_381.fields.Fr;

export interface Share {
  x: number;
  y: bigint;
}

export function randomScalar(): bigint {
  // 31 bytes < 2^248 < r, so no reduction bias.
  let n = 0n;
  for (const b of randomBytes(31)) n = (n << 8n) | BigInt(b);
  return n;
}

export function split(secret: bigint, threshold: number, xs: number[]): Share[] {
  if (threshold < 1 || threshold > xs.length) throw new Error(`warplock: threshold ${threshold} is not within 1..${xs.length}`);
  if (new Set(xs).size !== xs.length || xs.some((x) => x <= 0)) throw new Error("warplock: share x values must be distinct and positive");
  const coeffs = [Fr.create(secret)];
  for (let i = 1; i < threshold; i++) coeffs.push(randomScalar());
  return xs.map((x) => {
    let y = 0n;
    for (let i = coeffs.length - 1; i >= 0; i--) y = Fr.add(Fr.mul(y, BigInt(x)), coeffs[i]);
    return { x, y };
  });
}

export function combine(shares: Share[]): bigint {
  let secret = 0n;
  for (let i = 0; i < shares.length; i++) {
    let num = 1n;
    let den = 1n;
    for (let j = 0; j < shares.length; j++) {
      if (i === j) continue;
      num = Fr.mul(num, Fr.neg(BigInt(shares[j].x)));
      den = Fr.mul(den, Fr.sub(BigInt(shares[i].x), BigInt(shares[j].x)));
    }
    secret = Fr.add(secret, Fr.mul(shares[i].y, Fr.div(num, den)));
  }
  return secret;
}

export function scalarToBytes(n: bigint): Uint8Array {
  const out = new Uint8Array(32);
  let v = n;
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}
export function bytesToScalar(b: Uint8Array): bigint {
  let n = 0n;
  for (const x of b) n = (n << 8n) | BigInt(x);
  return n;
}
