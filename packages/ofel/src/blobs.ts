// Two small encrypted blobs ride with each order:
// - the agent blob: x25519 ECIES to the clearing agent, carrying (size, blind). It sits INSIDE the
//   timelocked envelope, so even the agent cannot read it before the batch closes.
// - the self blob: AES-GCM under a key derived from the trader's own wallet signature, OUTSIDE
//   the timelock, so the trader (and only the trader) can always see their own order.
import { gcm } from "@noble/ciphers/aes";
import { x25519 } from "@noble/curves/ed25519";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha2";
import { randomBytes } from "@noble/hashes/utils";
import { concatBytes } from "warplock";

const enc = new TextEncoder();

export function sealToAgent(agentPublicKey: Uint8Array, plaintext: Uint8Array): Uint8Array {
  const eph = x25519.utils.randomPrivateKey();
  const ephPub = x25519.getPublicKey(eph);
  const shared = x25519.getSharedSecret(eph, agentPublicKey);
  const key = hkdf(sha256, shared, concatBytes(ephPub, agentPublicKey), enc.encode("ofel/agent-blob/v1"), 32);
  const iv = randomBytes(12);
  return concatBytes(ephPub, iv, gcm(key, iv).encrypt(plaintext));
}

export function openAsAgent(agentSecretKey: Uint8Array, blob: Uint8Array): Uint8Array {
  if (blob.length < 32 + 12 + 16) throw new Error("ofel: agent blob too short");
  const ephPub = blob.slice(0, 32);
  const iv = blob.slice(32, 44);
  const shared = x25519.getSharedSecret(agentSecretKey, ephPub);
  const key = hkdf(sha256, shared, concatBytes(ephPub, x25519.getPublicKey(agentSecretKey)), enc.encode("ofel/agent-blob/v1"), 32);
  try {
    return gcm(key, iv).decrypt(blob.slice(44));
  } catch {
    throw new Error("ofel: agent blob failed its tag (not for this agent, or tampered)");
  }
}

/** The message a trader signs once to derive their private order key. */
export const selfKeyMessage = (chainId: number, book: string) =>
  `Ofel: unlock my sealed orders\nchain ${chainId}\nbook ${book.toLowerCase()}\nThis signature never leaves your browser.`;

export function selfKeyFromSignature(signature: `0x${string}`): Uint8Array {
  return sha256(concatBytes(enc.encode("ofel/self-key/v1"), enc.encode(signature.toLowerCase())));
}

export function sealToSelf(key: Uint8Array, plaintext: Uint8Array): Uint8Array {
  const iv = randomBytes(12);
  return concatBytes(iv, gcm(key, iv).encrypt(plaintext));
}

export function openAsSelf(key: Uint8Array, blob: Uint8Array): Uint8Array {
  try {
    return gcm(key, blob.slice(0, 12)).decrypt(blob.slice(12));
  } catch {
    throw new Error("ofel: not your order (self blob failed its tag)");
  }
}
