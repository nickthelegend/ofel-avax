// Byte-exact Avalanche Warp message encoding.
//
// Mirrors avalanchego:
//   vms/platformvm/warp/unsigned_message.go   UnsignedMessage{NetworkID, SourceChainID, Payload}
//   vms/platformvm/warp/payload/addressed_call.go  AddressedCall{SourceAddress, Payload}
//   vms/platformvm/warp/payload/codec.go      types registered in order: Hash (0), AddressedCall (1)
// The linearcodec writes a uint16 codec version, then fields big-endian; []byte is uint32 length + bytes;
// interface values (the payload codec) carry a uint32 type ID.

import { sha256 } from "@noble/hashes/sha2";

const CODEC_VERSION = 0;
const ADDRESSED_CALL_TYPE_ID = 1;

function u16(n: number): Uint8Array {
  return new Uint8Array([(n >>> 8) & 0xff, n & 0xff]);
}
function u32(n: number): Uint8Array {
  return new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
}
export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
function varBytes(b: Uint8Array): Uint8Array {
  return concatBytes(u32(b.length), b);
}

export function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (h.length % 2 !== 0 || /[^0-9a-fA-F]/.test(h)) throw new Error(`warplock: invalid hex "${hex.slice(0, 20)}…"`);
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}
export function bytesToHex(b: Uint8Array): string {
  return "0x" + Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/** AddressedCall payload bytes (what a contract's sendWarpMessage(payload) wraps). */
export function encodeAddressedCall(sourceAddress: Uint8Array, payload: Uint8Array): Uint8Array {
  if (sourceAddress.length !== 20) throw new Error("warplock: source address must be 20 bytes");
  return concatBytes(u16(CODEC_VERSION), u32(ADDRESSED_CALL_TYPE_ID), varBytes(sourceAddress), varBytes(payload));
}

/** Warp UnsignedMessage bytes. These exact bytes are what each validator BLS-signs. */
export function encodeUnsignedMessage(networkID: number, sourceChainID: Uint8Array, payload: Uint8Array): Uint8Array {
  if (sourceChainID.length !== 32) throw new Error("warplock: source chain ID must be 32 bytes");
  return concatBytes(u16(CODEC_VERSION), u32(networkID), sourceChainID, varBytes(payload));
}

/** Warp message ID = sha256(unsigned message bytes). */
export function messageId(unsignedMessage: Uint8Array): Uint8Array {
  return sha256(unsignedMessage);
}

export interface WarpIdentity {
  networkID: number;
  /** 32-byte blockchain ID of the L1 (hex). */
  sourceChainID: string;
  /** Contract that will call sendWarpMessage (20-byte hex address). */
  sourceAddress: string;
  /** The exact payload bytes the contract will pass to sendWarpMessage (hex). */
  payload: string;
}

/** The future Warp message, fully determined before it exists. */
export function identityMessage(id: WarpIdentity): Uint8Array {
  const call = encodeAddressedCall(hexToBytes(id.sourceAddress), hexToBytes(id.payload));
  return encodeUnsignedMessage(id.networkID, hexToBytes(id.sourceChainID), call);
}

// ---- CB58 (avalanche IDs) -------------------------------------------------
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58Encode(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let s = "";
  while (n > 0n) {
    s = B58[Number(n % 58n)] + s;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    s = "1" + s;
  }
  return s;
}
function base58Decode(s: string): Uint8Array {
  let n = 0n;
  for (const c of s) {
    const i = B58.indexOf(c);
    if (i < 0) throw new Error(`warplock: invalid base58 character "${c}"`);
    n = n * 58n + BigInt(i);
  }
  const bytes: number[] = [];
  while (n > 0n) {
    bytes.unshift(Number(n & 0xffn));
    n >>= 8n;
  }
  for (const c of s) {
    if (c !== "1") break;
    bytes.unshift(0);
  }
  return new Uint8Array(bytes);
}

/** CB58 = base58(bytes || last 4 bytes of sha256(bytes)). */
export function cb58Encode(bytes: Uint8Array): string {
  return base58Encode(concatBytes(bytes, sha256(bytes).slice(-4)));
}
export function cb58Decode(s: string): Uint8Array {
  const raw = base58Decode(s);
  const body = raw.slice(0, -4);
  const sum = raw.slice(-4);
  const want = sha256(body).slice(-4);
  if (want.some((b, i) => b !== sum[i])) throw new Error("warplock: CB58 checksum mismatch");
  return body;
}
