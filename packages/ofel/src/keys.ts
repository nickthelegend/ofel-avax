// Keys derived from one wallet signature, so a role needs nothing but its wallet.
import { x25519 } from "@noble/curves/ed25519";
import { sha256 } from "@noble/hashes/sha2";
import { concatBytes } from "warplock";

const enc = new TextEncoder();

export const agentKeyMessage = (chainId: number, book: string) =>
  `Ofel: clearing agent key\nchain ${chainId}\nbook ${book.toLowerCase()}`;

export function agentSecretFromSignature(signature: `0x${string}`): Uint8Array {
  return sha256(concatBytes(enc.encode("ofel/agent-x25519/v1"), enc.encode(signature.toLowerCase())));
}

export function agentPublicKey(secret: Uint8Array): Uint8Array {
  return x25519.getPublicKey(secret);
}
