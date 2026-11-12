// Building, sealing and opening Ofel orders. Mirrors OfelBook.orderCommitment / closePayload.
import { decodeAbiParameters, encodeAbiParameters, keccak256, toBytes, toHex, type Hex } from "viem";
import { decodeEnvelope, encodeEnvelope, identityMessage, open as warpOpen, seal, type Validator } from "warplock";
import { openAsAgent, openAsSelf, sealToAgent, sealToSelf } from "./blobs.ts";
import { commit, randomBlind, type Point } from "./pedersen.ts";

export const BUY = 1;
export const SELL = 2;
export type Side = typeof BUY | typeof SELL;
export const CLOSE_TAG = keccak256(toBytes("ofel/batch-closed/v1"));

export interface BookContext {
  chainId: number;
  networkID: number;
  /** L1 blockchain ID, 32-byte hex. */
  blockchainIdHex: Hex;
  book: Hex;
}

/** The Warp payload OfelBook.closeBatch(batchId) will emit. */
export function closePayload(batchId: bigint, closeAt: bigint): Hex {
  return encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }, { type: "uint64" }], [CLOSE_TAG, batchId, closeAt]);
}

/** The exact Warp UnsignedMessage bytes every order in the batch is sealed to. */
export function batchIdentity(ctx: BookContext, batchId: bigint, closeAt: bigint): Uint8Array {
  return identityMessage({ networkID: ctx.networkID, sourceChainID: ctx.blockchainIdHex, sourceAddress: ctx.book, payload: closePayload(batchId, closeAt) });
}

export function orderCommitment(ctx: BookContext, batchId: bigint, trader: Hex, side: number, limit: bigint, salt: Hex, c: Point, agentBlobHash: Hex): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "uint256" }, { type: "address" }, { type: "uint256" }, { type: "address" }, { type: "uint8" },
        { type: "uint64" }, { type: "bytes32" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes32" },
      ],
      [BigInt(ctx.chainId), ctx.book, batchId, trader, side, limit, salt, c.x, c.y, agentBlobHash],
    ),
  );
}

export interface OrderInput {
  batchId: bigint;
  closeAt: bigint;
  trader: Hex;
  side: Side;
  /** quote cents per 1.00 base */
  limit: bigint;
  /** base units, 2 decimals (eERC decimals) */
  size: bigint;
}

export interface SealedOrder {
  commitment: Hex;
  c: Point;
  /** bytes passed to OfelBook.submitOrder: abi.encode(bytes timelocked, bytes mine) */
  envelope: Hex;
  salt: Hex;
  blind: bigint;
  agentBlobHash: Hex;
}

const SELF_FIELDS = [{ type: "uint8" }, { type: "uint64" }, { type: "uint64" }, { type: "uint256" }, { type: "bytes32" }] as const;
const SEALED_FIELDS = [{ type: "uint8" }, { type: "uint64" }, { type: "bytes32" }, { type: "bytes" }] as const;
const AGENT_FIELDS = [{ type: "uint64" }, { type: "uint256" }] as const;
const OUTER = [{ type: "bytes" }, { type: "bytes" }] as const;

export function sealOrder(
  ctx: BookContext,
  o: OrderInput,
  validators: Validator[],
  threshold: number,
  agentKey: Uint8Array,
  selfKey: Uint8Array,
): SealedOrder {
  if (o.size <= 0n || o.size >= 1n << 63n) throw new Error("ofel: size out of range");
  if (o.limit <= 0n || o.limit >= 1n << 63n) throw new Error("ofel: limit out of range");
  const salt = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const blind = randomBlind();
  const c = commit(o.size, blind);
  const agentBlob = sealToAgent(agentKey, toBytes(encodeAbiParameters(AGENT_FIELDS, [o.size, blind])));
  const agentBlobHash = keccak256(agentBlob);
  const identity = batchIdentity(ctx, o.batchId, o.closeAt);
  const timelocked = seal(toBytes(encodeAbiParameters(SEALED_FIELDS, [o.side, o.limit, salt, toHex(agentBlob)])), identity, validators, threshold);
  const mine = sealToSelf(selfKey, toBytes(encodeAbiParameters(SELF_FIELDS, [o.side, o.limit, o.size, blind, salt])));
  const envelope = encodeAbiParameters(OUTER, [toHex(encodeEnvelope(timelocked)), toHex(mine)]);
  return { commitment: orderCommitment(ctx, o.batchId, o.trader, o.side, o.limit, salt, c, agentBlobHash), c, envelope, salt, blind, agentBlobHash };
}

export function splitEnvelope(envelope: Hex): { timelocked: Uint8Array; mine: Uint8Array } {
  const [t, m] = decodeAbiParameters(OUTER, envelope);
  return { timelocked: toBytes(t), mine: toBytes(m) };
}

export interface OpenedOrder {
  side: number;
  limit: bigint;
  salt: Hex;
  agentBlob: Hex;
  agentBlobHash: Hex;
  used: string[];
}

/** Open the timelocked half with validator signatures on the batch-close message. */
export function openOrder(envelope: Hex, identity: Uint8Array, validators: Validator[], signatures: Map<string, Uint8Array>): OpenedOrder {
  const { timelocked } = splitEnvelope(envelope);
  const r = warpOpen(decodeEnvelope(timelocked), identity, validators, signatures);
  const [side, limit, salt, agentBlob] = decodeAbiParameters(SEALED_FIELDS, toHex(r.plaintext));
  return { side, limit, salt, agentBlob, agentBlobHash: keccak256(agentBlob), used: r.used };
}

export function openAgentBlob(agentSecret: Uint8Array, agentBlob: Hex): { size: bigint; blind: bigint } {
  const [size, blind] = decodeAbiParameters(AGENT_FIELDS, toHex(openAsAgent(agentSecret, toBytes(agentBlob))));
  return { size, blind };
}

export interface MyOrder {
  side: number;
  limit: bigint;
  size: bigint;
  blind: bigint;
  salt: Hex;
}

/** Trader-only view of their own order, available before and after the batch closes. */
export function openMine(selfKey: Uint8Array, envelope: Hex): MyOrder | null {
  try {
    const { mine } = splitEnvelope(envelope);
    const [side, limit, size, blind, salt] = decodeAbiParameters(SELF_FIELDS, toHex(openAsSelf(selfKey, mine)));
    return { side, limit, size, blind, salt };
  } catch {
    return null;
  }
}
