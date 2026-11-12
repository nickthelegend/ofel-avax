// Order actions from the browser: seal + submit, try to open early, read my orders.
import { BaseError, ContractFunctionRevertedError, toBytes, type Hex, type WalletClient } from "viem";
import { BUY, batchIdentity, fillFor, inCross, openMine, sealOrder, type MyOrder, type Side } from "@ofel/core";
import { getWarpSignature, messageId } from "warplock";
import { cfg, rpcOf } from "./config";
import { bookAbi, client, ctx, getBatch, getOrders, getSealed, readBook, validatorSet, validatorStatus, type Batch, type Order } from "./chain";

export function parseUnits2(s: string): bigint | null {
  const t = s.replace(/,/g, "").trim();
  if (!/^\d+(\.\d{0,2})?$/.test(t)) return null;
  const [w, f = ""] = t.split(".");
  return BigInt(w) * 100n + BigInt((f + "00").slice(0, 2));
}

export interface SealResult {
  tx: Hex;
  batchId: bigint;
  closeAt: bigint;
  bytes: number;
  validators: number;
  threshold: number;
  commitment: Hex;
}

export async function sealAndSubmit(w: WalletClient, selfKey: Uint8Array, batch: Batch, side: Side, limit: bigint, size: bigint): Promise<SealResult> {
  if (!w.account) throw new Error("Connect a wallet first");
  const [vs, agentKeyHex, bond] = await Promise.all([validatorSet(), readBook<Hex>("agentKey"), readBook<bigint>("bond")]);
  if (!vs.length) throw new Error("The P-Chain returned no validators for this L1");
  const sealed = sealOrder(ctx, { batchId: batch.id, closeAt: batch.closeAt, trader: w.account.address, side, limit, size }, vs, cfg.threshold, toBytes(agentKeyHex), selfKey);
  const tx = await w.writeContract({
    address: cfg.book,
    abi: bookAbi,
    functionName: "submitOrder",
    args: [batch.id, sealed.commitment, sealed.c.x, sealed.c.y, sealed.envelope],
    value: bond,
    account: w.account,
    chain: undefined,
  });
  const r = await client.waitForTransactionReceipt({ hash: tx });
  if (r.status !== "success") throw new Error(`submitOrder reverted (${tx})`);
  return { tx, batchId: batch.id, closeAt: batch.closeAt, bytes: (sealed.envelope.length - 2) / 2, validators: vs.length, threshold: cfg.threshold, commitment: sealed.commitment };
}

export interface EarlyAttempt {
  contract: string;
  validators: { nodeID: string; result: string; refused: boolean }[];
}

/** Try to open a batch before T: the contract must refuse, and no validator may sign. */
export async function tryOpenEarly(b: Batch): Promise<EarlyAttempt> {
  let contract = "";
  try {
    await client.simulateContract({ address: cfg.book, abi: bookAbi, functionName: "closeBatch", args: [b.id], account: "0x000000000000000000000000000000000000dEaD" });
    contract = "the call would succeed (the batch is past T)";
  } catch (e) {
    const rev = e instanceof BaseError ? e.walk((x) => x instanceof ContractFunctionRevertedError) : null;
    const name = rev instanceof ContractFunctionRevertedError ? rev.data?.errorName : undefined;
    contract = name ? `reverted with ${name}` : (e as Error).message.split("\n")[0].slice(0, 120);
  }
  const mid = messageId(batchIdentity(ctx, b.id, b.closeAt));
  const vs = await validatorStatus();
  const validators = await Promise.all(
    vs.map(async (v) => {
      if (!v.online || !v.uri) return { nodeID: v.nodeID, result: "offline", refused: true };
      try {
        await getWarpSignature(rpcOf(v.uri), mid);
        return { nodeID: v.nodeID, result: "signed", refused: false };
      } catch (e) {
        const m = (e as Error).message;
        return { nodeID: v.nodeID, result: /not found/.test(m) ? "refused: message not found" : m.slice(-80), refused: true };
      }
    }),
  );
  return { contract, validators };
}

export interface MyRow {
  batch: Batch;
  order: Order;
  mine: MyOrder;
  tx: Hex;
  fill?: { base: bigint; quote: bigint };
}

export async function myOrders(address: Hex, selfKey: Uint8Array, batches: Batch[]): Promise<MyRow[]> {
  const rows: MyRow[] = [];
  for (const b of batches) {
    if (b.orderCount === 0) continue;
    const [orders, sealed] = await Promise.all([getOrders(b.id), getSealed(b.id)]);
    for (const s of sealed) {
      if (s.trader.toLowerCase() !== address.toLowerCase()) continue;
      const mine = openMine(selfKey, s.envelope);
      if (!mine) continue;
      const order = orders[s.index];
      const filled = b.state === 3 && order.status !== 3 && inCross({ index: s.index, side: mine.side, limit: mine.limit }, b.price);
      const fill = filled ? fillFor(mine.side, mine.size, b.price, b.buyTotal, b.sellTotal) : undefined;
      rows.push({ batch: b, order, mine, tx: s.tx, fill });
    }
  }
  return rows;
}

export const sideLabel = (s: number) => (s === BUY ? "Buy" : "Sell");
export { getBatch };
