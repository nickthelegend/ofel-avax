// Live reads from the Ofel L1, its P-Chain and each validator. No caching beyond a poll.
import { batchIdentity, encryptedErcAbi, ofelBookAbi, type BookContext } from "@ofel/core";
import { createPublicClient, http, parseAbiItem, type Abi, type Hex } from "viem";
import { getL1Validators, getNodeIdentity, getWarpSignature, messageId, verifySignature, hexToBytes, bytesToHex, type Validator } from "warplock";
import { cfg, chain, rpcOf } from "./config";

export const client = createPublicClient({ chain, transport: http(cfg.rpc), pollingInterval: 1500 });
export const bookAbi = ofelBookAbi as Abi;
export const eercAbi = encryptedErcAbi as Abi;

export const ctx: BookContext = { chainId: cfg.chainId, networkID: cfg.networkID, blockchainIdHex: cfg.blockchainIdHex, book: cfg.book };

export const STATE = ["None", "Open", "Closed", "Cleared"] as const;
export const STATUS = ["None", "Sealed", "Revealed", "Void", "Unfilled", "Filled", "Settled", "Bond claimed"] as const;

export interface Batch {
  id: bigint;
  closeAt: bigint;
  closedAt: bigint;
  clearedAt: bigint;
  orderCount: number;
  revealedCount: number;
  state: number;
  price: bigint;
  buyTotal: bigint;
  sellTotal: bigint;
  closeMessageId: Hex;
}

export interface Order {
  index: number;
  trader: Hex;
  side: number;
  status: number;
  limit: bigint;
  commitment: Hex;
  cx: bigint;
  cy: bigint;
}

export async function batchCount(): Promise<bigint> {
  return (await client.readContract({ address: cfg.book, abi: bookAbi, functionName: "batchCount" })) as bigint;
}

export async function getBatch(id: bigint): Promise<Batch> {
  const b = (await client.readContract({ address: cfg.book, abi: bookAbi, functionName: "getBatch", args: [id] })) as Omit<Batch, "id">;
  return { ...b, id };
}

export async function recentBatches(n = 12): Promise<Batch[]> {
  const count = await batchCount();
  const ids: bigint[] = [];
  for (let id = count; id >= 1n && ids.length < n; id--) ids.push(id);
  return Promise.all(ids.map(getBatch));
}

/** The most recent batches that received orders (empty batches skipped), newest first. */
export async function batchesWithOrders(n: number, scan = 200): Promise<Batch[]> {
  const count = await batchCount();
  const out: Batch[] = [];
  for (let id = count; id >= 1n && id > count - BigInt(scan) && out.length < n; id--) {
    const b = await getBatch(id);
    if (b.orderCount > 0) out.push(b);
  }
  return out;
}

/** The most recent batch that cleared with a cross (scans back up to 200 batches). */
export async function lastClearedBatch(): Promise<Batch | undefined> {
  const count = await batchCount();
  for (let id = count; id >= 1n && id > count - 200n; id--) {
    const b = await getBatch(id);
    if (b.state === 3 && b.price > 0n) return b;
  }
  return undefined;
}

export async function getOrders(id: bigint): Promise<Order[]> {
  const os = (await client.readContract({ address: cfg.book, abi: bookAbi, functionName: "getOrders", args: [id] })) as Omit<Order, "index">[];
  return os.map((o, index) => ({ ...o, index }));
}

const sealedEvent = parseAbiItem(
  "event OrderSealed(uint256 indexed batchId, uint32 indexed index, address indexed trader, bytes32 commitment, uint256 cx, uint256 cy, bytes envelope)",
);

export interface SealedLog {
  index: number;
  trader: Hex;
  envelope: Hex;
  tx: Hex;
  block: bigint;
}

export async function getSealed(id: bigint): Promise<SealedLog[]> {
  const logs = await client.getLogs({ address: cfg.book, event: sealedEvent, args: { batchId: id }, fromBlock: 0n, toBlock: "latest" });
  return logs.map((l) => ({ index: Number(l.args.index), trader: l.args.trader as Hex, envelope: l.args.envelope as Hex, tx: l.transactionHash, block: l.blockNumber }));
}

export async function readBook<T>(functionName: string, args: unknown[] = []): Promise<T> {
  return (await client.readContract({ address: cfg.book, abi: bookAbi, functionName, args })) as T;
}

// ------------------------------------------------------------- validators

export interface ValidatorStatus extends Validator {
  uri?: string;
  online: boolean;
  error?: string;
}

export async function validatorSet(): Promise<Validator[]> {
  return getL1Validators(cfg.pchain, cfg.subnetID);
}

export async function validatorStatus(): Promise<ValidatorStatus[]> {
  const vs = await validatorSet();
  const seen = new Map<string, string>();
  await Promise.all(
    cfg.validatorURIs.map(async (uri) => {
      try {
        const me = await getNodeIdentity(`${uri}/ext/info`);
        seen.set(me.nodeID, uri);
      } catch {
        /* offline */
      }
    }),
  );
  const byEndpoint = new Map<string, string>(cfg.validatorURIs.map((u, i) => [vs[i]?.nodeID ?? "", u]));
  return vs.map((v) => ({ ...v, uri: seen.get(v.nodeID) ?? byEndpoint.get(v.nodeID), online: seen.has(v.nodeID) }));
}

export interface SignatureCheck {
  nodeID: string;
  ok: boolean;
  detail: string;
  signature?: Uint8Array;
}

/** Ask each validator for its BLS signature on a batch's close message and verify it here, in the browser. */
export async function checkSignatures(b: Batch, vs: ValidatorStatus[]): Promise<{ identity: Uint8Array; messageIdHex: Hex; checks: SignatureCheck[] }> {
  const identity = batchIdentity(ctx, b.id, b.closeAt);
  const mid = messageId(identity);
  const checks = await Promise.all(
    vs.map(async (v): Promise<SignatureCheck> => {
      if (!v.online || !v.uri) return { nodeID: v.nodeID, ok: false, detail: "offline" };
      try {
        const sig = await getWarpSignature(rpcOf(v.uri), mid);
        const ok = verifySignature(sig, identity, hexToBytes(v.publicKey));
        return { nodeID: v.nodeID, ok, detail: ok ? "verified against P-Chain BLS key" : "does not verify", signature: sig };
      } catch (e) {
        const m = (e as Error).message;
        return { nodeID: v.nodeID, ok: false, detail: /not found/.test(m) ? "refused: message does not exist yet" : m.slice(0, 80) };
      }
    }),
  );
  return { identity, messageIdHex: bytesToHex(mid) as Hex, checks };
}

export async function latestBlockTime(): Promise<number> {
  const b = await client.getBlock();
  return Number(b.timestamp);
}
