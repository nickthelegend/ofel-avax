// warplock envelope: data sealed to a future Warp message of an Avalanche L1.
//
// 1. A random secret s is Shamir-split t-of-n across the L1's validators.
// 2. Share i is IBE-encrypted to validator i's BLS public key with identity = the future
//    Warp UnsignedMessage bytes.
// 3. The plaintext is AES-256-GCM encrypted under sha256(s), with the identity's message ID as AAD.
// Anyone holding t validator signatures on that exact message can open it; nobody can before
// the L1 accepts the message, because honest validators only sign accepted Warp messages.

import { gcm } from "@noble/ciphers/aes";
import { sha256 } from "@noble/hashes/sha2";
import { randomBytes } from "@noble/hashes/utils";
import { ibeDecrypt, ibeEncrypt, verifySignature } from "./ibe.ts";
import { bytesToScalar, combine, randomScalar, scalarToBytes, split, type Share } from "./shamir.ts";
import { cb58Decode, cb58Encode, concatBytes, hexToBytes, messageId } from "./warp.ts";

export const ENVELOPE_VERSION = 1;
const SHARE_LEN = 1 + 20 + 48 + 32 + 32;

export interface Validator {
  /** "NodeID-…" */
  nodeID: string;
  /** 48-byte compressed G1 BLS public key, hex. */
  publicKey: string;
  weight?: bigint;
}

export interface SealedShare {
  x: number;
  nodeID: string;
  U: Uint8Array;
  V: Uint8Array;
  W: Uint8Array;
}

export interface Envelope {
  version: number;
  threshold: number;
  shares: SealedShare[];
  iv: Uint8Array;
  ciphertext: Uint8Array;
}

export function nodeIdToBytes(nodeID: string): Uint8Array {
  if (!nodeID.startsWith("NodeID-")) throw new Error(`warplock: "${nodeID}" is not a NodeID`);
  const b = cb58Decode(nodeID.slice(7));
  if (b.length !== 20) throw new Error(`warplock: NodeID ${nodeID} does not decode to 20 bytes`);
  return b;
}
export function bytesToNodeId(b: Uint8Array): string {
  return "NodeID-" + cb58Encode(b);
}

/** Seal `plaintext` so it opens only with `threshold` validator signatures on `identity`. */
export function seal(plaintext: Uint8Array, identity: Uint8Array, validators: Validator[], threshold: number): Envelope {
  if (validators.length === 0) throw new Error("warplock: no validators to seal to");
  if (validators.length > 255) throw new Error("warplock: at most 255 validators");
  const secret = randomScalar();
  const shares = split(secret, threshold, validators.map((_, i) => i + 1));
  const sealed = shares.map((s, i) => {
    const ct = ibeEncrypt(hexToBytes(validators[i].publicKey), identity, scalarToBytes(s.y));
    return { x: s.x, nodeID: validators[i].nodeID, ...ct };
  });
  const iv = randomBytes(12);
  const key = sha256(scalarToBytes(secret));
  const ciphertext = gcm(key, iv, messageId(identity)).encrypt(plaintext);
  return { version: ENVELOPE_VERSION, threshold, shares: sealed, iv, ciphertext };
}

export class NotEnoughSignaturesError extends Error {
  have: number;
  need: number;
  constructor(have: number, need: number) {
    super(`warplock: ${have} valid validator signature(s), ${need} needed to open`);
    this.have = have;
    this.need = need;
  }
}

export interface OpenReport {
  plaintext: Uint8Array;
  used: string[];
  rejected: { nodeID: string; reason: string }[];
}

/**
 * Open an envelope with validator signatures (nodeID → 96-byte G2 signature).
 * Each signature is checked against the validator's public key before use, so a bad or
 * mismatched signature is reported, never silently used.
 */
export function open(env: Envelope, identity: Uint8Array, validators: Validator[], signatures: Map<string, Uint8Array>): OpenReport {
  const byId = new Map(validators.map((v) => [v.nodeID, v]));
  const good: Share[] = [];
  const used: string[] = [];
  const rejected: { nodeID: string; reason: string }[] = [];
  for (const s of env.shares) {
    const sig = signatures.get(s.nodeID);
    if (!sig) continue;
    const v = byId.get(s.nodeID);
    if (!v) {
      rejected.push({ nodeID: s.nodeID, reason: "not in the validator set" });
      continue;
    }
    if (!verifySignature(sig, identity, hexToBytes(v.publicKey))) {
      rejected.push({ nodeID: s.nodeID, reason: "signature does not verify against its P-Chain BLS key" });
      continue;
    }
    try {
      good.push({ x: s.x, y: bytesToScalar(ibeDecrypt(sig, s)) });
      used.push(s.nodeID);
    } catch (e) {
      rejected.push({ nodeID: s.nodeID, reason: (e as Error).message });
    }
    if (good.length === env.threshold) break;
  }
  if (good.length < env.threshold) throw new NotEnoughSignaturesError(good.length, env.threshold);
  const key = sha256(scalarToBytes(combine(good)));
  let plaintext: Uint8Array;
  try {
    plaintext = gcm(key, env.iv, messageId(identity)).decrypt(env.ciphertext);
  } catch {
    throw new Error("warplock: payload failed its AES-GCM tag (tampered ciphertext or wrong identity)");
  }
  return { plaintext, used, rejected };
}

/** Compact binary form, for storing on chain. */
export function encodeEnvelope(env: Envelope): Uint8Array {
  const head = new Uint8Array([env.version, env.threshold, env.shares.length]);
  const shares = env.shares.map((s) => concatBytes(new Uint8Array([s.x]), nodeIdToBytes(s.nodeID), s.U, s.V, s.W));
  return concatBytes(head, ...shares, env.iv, env.ciphertext);
}

export function decodeEnvelope(b: Uint8Array): Envelope {
  if (b.length < 3) throw new Error("warplock: envelope too short");
  const [version, threshold, n] = b;
  if (version !== ENVELOPE_VERSION) throw new Error(`warplock: unsupported envelope version ${version}`);
  let o = 3;
  if (b.length < o + n * SHARE_LEN + 12 + 16) throw new Error("warplock: envelope truncated");
  const shares: SealedShare[] = [];
  for (let i = 0; i < n; i++) {
    const s = b.subarray(o, o + SHARE_LEN);
    shares.push({ x: s[0], nodeID: bytesToNodeId(s.slice(1, 21)), U: s.slice(21, 69), V: s.slice(69, 101), W: s.slice(101, 133) });
    o += SHARE_LEN;
  }
  const iv = b.slice(o, o + 12);
  const ciphertext = b.slice(o + 12);
  return { version, threshold, shares, iv, ciphertext };
}
