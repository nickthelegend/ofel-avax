// Settlement from the browser: after a batch clears, a filled trader pays its leg in to the clearing agent with a
// private eERC transfer (Groth16 proof made here), and the agent pays the other leg out. A trader whose order did not
// fill (or settled) claims the bond back.
import { BUY } from "@ofel/core";
import { parseAbiItem, type Hex, type WalletClient } from "viem";
import { cfg } from "./config";
import { bookAbi, client } from "./chain";
import { eercFor, privateTransfer } from "./eerc";
import type { MyRow } from "./orders";

const clearedEvent = parseAbiItem("event BatchCleared(uint256 indexed batchId, uint64 price, uint64 buyTotal, uint64 sellTotal, uint32 filled)");
const transferEvent = parseAbiItem("event PrivateTransfer(address indexed from, address indexed to, uint256[7] auditorPCT, address indexed auditorAddress)");

/** The private transfer this wallet sent the agent after the batch cleared, if any. */
export async function payInOnChain(me: Hex, batchId: bigint): Promise<Hex | undefined> {
  const [c] = await client.getLogs({ address: cfg.book, event: clearedEvent, args: { batchId }, fromBlock: 0n, toBlock: "latest" });
  if (!c) return undefined;
  const ts = await client.getLogs({ address: cfg.eerc, event: transferEvent, args: { from: me, to: cfg.agent }, fromBlock: c.blockNumber, toBlock: "latest" });
  return ts[0]?.transactionHash;
}

export function payInLeg(r: MyRow): { token: Hex; amount: bigint; sym: string } | undefined {
  if (!r.fill) return undefined;
  return r.mine.side === BUY ? { token: cfg.tUSDC, amount: r.fill.quote, sym: "tUSDC" } : { token: cfg.tAVAX, amount: r.fill.base, sym: "tAVAX" };
}

export async function payIn(w: WalletClient, me: Hex, r: MyRow): Promise<Hex> {
  const leg = payInLeg(r);
  if (!leg) throw new Error("This order has no fill to settle");
  const e = await eercFor(w);
  return privateTransfer(e, me, cfg.agent, leg.token, leg.amount, `ofel:${r.batch.id}:${r.order.index}:in`);
}

export async function claimBond(w: WalletClient, batchId: bigint, index: number): Promise<Hex> {
  if (!w.account) throw new Error("Connect a wallet first");
  const h = await w.writeContract({ address: cfg.book, abi: bookAbi, functionName: "claimBond", args: [batchId, index], account: w.account, chain: undefined });
  const r = await client.waitForTransactionReceipt({ hash: h });
  if (r.status !== "success") throw new Error(`claimBond reverted (${h})`);
  return h;
}
