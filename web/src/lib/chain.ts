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

const sealedIds = parseAbiItem("event OrderSealed(uint256 indexed batchId, uint32 indexed index, address indexed trader, bytes32 commitment, uint256 cx, uint256 cy, bytes envelope)");
const clearedEv = parseAbiItem("event BatchCleared(uint256 indexed batchId, uint64 price, uint64 buyTotal, uint64 sellTotal, uint32 filled)");

/** The most recent batches that received orders, newest first (from OrderSealed logs: the agent opens a batch every
 * 90 s, so most batches are empty and scanning them one by one would cost hundreds of reads). */
export async function batchesWithOrders(n: number): Promise<Batch[]> {
  const logs = await client.getLogs({ address: cfg.book, event: sealedIds, fromBlock: 0n, toBlock: "latest" });
  const ids = [...new Set(logs.map((l) => l.args.batchId as bigint))].sort((a, b) => (a < b ? 1 : -1)).slice(0, n);
  return Promise.all(ids.map(getBatch));
}

/** The most recent batch that cleared with a cross. */
export async function lastClearedBatch(): Promise<Batch | undefined> {
  const logs = await client.getLogs({ address: cfg.book, event: clearedEv, fromBlock: 0n, toBlock: "latest" });
  const last = logs.filter((l) => (l.args.price as bigint) > 0n).at(-1);
  return last ? getBatch(last.args.batchId as bigint) : undefined;
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

/** How many orders a wallet has sealed (the trader is an indexed, public field; one log query). */
export async function sealedCountOf(trader: Hex): Promise<number> {
  const logs = await client.getLogs({ address: cfg.book, event: sealedEvent, args: { trader }, fromBlock: 0n, toBlock: "latest" });
  return logs.length;
}

export async function readBook<T>(functionName: string, args: unknown[] = []): Promise<T> {
  return (await client.readContract({ address: cfg.book, abi: bookAbi, functionName, args })) as T;
}

// ------------------------------------------------------------- validators

export interface ValidatorStatus extends Validator {
  uri?: string;
  online: boolean;
  /** The L1 block this node has accepted, and how far it is behind the highest of the three. */
  height?: number;
  behind?: number;
  /** Online and within a few blocks of the others: able to sign the next close. */
  synced: boolean;
  error?: string;
}

const LAG_BLOCKS = 5;

// The validator set only changes with a P-Chain transaction, so one read serves every panel for five minutes (the
// public P-Chain endpoint rate-limits busy clients). A failed read is retried on the next call, never cached.
let setCache: { at: number; p: Promise<Validator[]> } | undefined;
export async function validatorSet(): Promise<Validator[]> {
  if (!setCache || Date.now() - setCache.at > 300_000) {
    const p = firstOk(cfg.pchains.map((u) => () => getL1Validators(u, cfg.subnetID)));
    setCache = { at: Date.now(), p };
    p.catch(() => (setCache = undefined));
  }
  return setCache.p;
}

export async function validatorStatus(): Promise<ValidatorStatus[]> {
  const vs = await validatorSet();
  const seen = new Map<string, string>();
  const heights = new Map<string, number>();
  await Promise.all(
    cfg.validatorURIs.map(async (uri) => {
      try {
        const me = await getNodeIdentity(`${uri}/ext/info`);
        seen.set(me.nodeID, uri);
        const r = await fetch(rpcOf(uri), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }) });
        const j = await r.json();
        if (j.result) heights.set(me.nodeID, Number(j.result));
      } catch {
        /* offline */
      }
    }),
  );
  const top = Math.max(0, ...heights.values());
  const byEndpoint = new Map<string, string>(cfg.validatorURIs.map((u, i) => [vs[i]?.nodeID ?? "", u]));
  return vs.map((v) => {
    const height = heights.get(v.nodeID);
    const behind = height === undefined ? undefined : top - height;
    const online = seen.has(v.nodeID);
    return { ...v, uri: seen.get(v.nodeID) ?? byEndpoint.get(v.nodeID), online, height, behind, synced: online && behind !== undefined && behind <= LAG_BLOCKS };
  });
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

// ------------------------------------------------------- P-Chain balances

export interface ValidatorBalance {
  nodeID: string;
  validationID: string;
  balance: bigint; // nAVAX
  runsOut: number; // unix seconds, at the 512 nAVAX/s validator fee
}

/** The first endpoint that answers wins; if none does, the last error is shown. */
async function firstOk<T>(tries: (() => Promise<T>)[]): Promise<T> {
  let err: unknown;
  for (const t of tries) {
    try {
      return await t();
    } catch (e) {
      err = e;
    }
  }
  throw err;
}

async function pcall<T>(method: string, params: unknown): Promise<T> {
  return firstOk(cfg.pchains.map((u) => () => pcallAt<T>(u, method, params)));
}

async function pcallAt<T>(url: string, method: string, params: unknown): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = await r.json();
  if (!j.result) throw new Error(`${method}: ${j.error?.message ?? r.status}`);
  return j.result as T;
}

/** Each L1 validator's P-Chain fee balance and when it runs out (Fuji: 512 nAVAX per second per validator). */
export async function validatorBalances(): Promise<ValidatorBalance[]> {
  const [{ validators }, { timestamp }] = await Promise.all([
    pcall<{ validators: { nodeID: string; validationID?: string }[] }>("platform.getCurrentValidators", { subnetID: cfg.subnetID }),
    pcall<{ timestamp: string }>("platform.getTimestamp", {}),
  ]);
  const t0 = Date.parse(timestamp) / 1000;
  return Promise.all(
    validators
      .filter((v) => v.validationID)
      .map(async (v) => {
        const cur = await pcall<{ balance: string }>("platform.getL1Validator", { validationID: v.validationID });
        const balance = BigInt(cur.balance);
        return { nodeID: v.nodeID, validationID: v.validationID!, balance, runsOut: t0 + Number(balance / 512n) };
      }),
  );
}
