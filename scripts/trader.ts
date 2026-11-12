// Trader CLI against the live L1 (same flow as the web desk).
//   node trader.ts order  alice buy  3150 125000     # limit in cents, size in 0.01 base units
//   node trader.ts peek   <batchId>                  # try to open early (must fail twice)
//   node trader.ts mine   alice
//   node trader.ts settle alice <batchId>
//   node trader.ts claim  alice <batchId>
import { BUY, SELL, batchIdentity, fillFor, openMine, sealOrder, selfKeyFromSignature, selfKeyMessage } from "@ofel/core";
import { parseEther, toBytes, type Hex } from "viem";
import { cb58Encode, getWarpSignature, messageId } from "warplock";
import { BOOK, bookAbi, ctx, getBatch, getEnvelopes, getOrders, batchCount, STATUS, validators, validatorEndpoints } from "./lib/book.ts";
import { deployment, log, publicClient, rpcOf, walletFor } from "./lib/env.ts";
import { eercFor, privateTransfer } from "./lib/eerc.ts";

const [cmd, a1, a2, a3, a4] = process.argv.slice(2);
const who = (n: string) => {
  if (!["alice", "bob"].includes(n)) throw new Error(`unknown trader "${n}" (alice|bob)`);
  return walletFor(`OFEL_${n.toUpperCase()}_PK`);
};
async function selfKey(w: ReturnType<typeof who>) {
  return selfKeyFromSignature(await w.signMessage({ message: selfKeyMessage(ctx.chainId, BOOK) }));
}
const out: Record<string, unknown> = {};

if (cmd === "order") {
  const w = who(a1);
  const side = a2 === "buy" ? BUY : a2 === "sell" ? SELL : (() => { throw new Error("side must be buy|sell"); })();
  const limit = BigInt(a3);
  const size = BigInt(a4);
  const id = await batchCount();
  const b = await getBatch(id);
  if (b.state !== 1) throw new Error(`batch ${id} is not open`);
  const agentKey = toBytes((await publicClient.readContract({ address: BOOK, abi: bookAbi, functionName: "agentKey" })) as Hex);
  const vs = await validators();
  const threshold = Number((deployment as Record<string, unknown>).threshold ?? 2);
  const s = sealOrder(ctx, { batchId: id, closeAt: b.closeAt, trader: w.account.address, side, limit, size }, vs, threshold, agentKey, await selfKey(w));
  const bond = (await publicClient.readContract({ address: BOOK, abi: bookAbi, functionName: "bond" })) as bigint;
  const hash = await w.writeContract({ address: BOOK, abi: bookAbi, functionName: "submitOrder", args: [id, s.commitment, s.c.x, s.c.y, s.envelope], value: bond, chain: undefined });
  const r = await publicClient.waitForTransactionReceipt({ hash });
  log(`sealed ${a2} order in batch ${id}`, `${hash} (${r.status}), ${(s.envelope.length - 2) / 2} B ciphertext, bond ${Number(bond) / 1e18} OFEL`);
  log("sealed to", `${vs.length} validators, any ${threshold} open it after ${new Date(Number(b.closeAt) * 1000).toISOString()}`);
  Object.assign(out, { batchId: id.toString(), tx: hash });
} else if (cmd === "peek") {
  const id = BigInt(a1 ?? (await batchCount()));
  const b = await getBatch(id);
  try {
    await publicClient.simulateContract({ address: BOOK, abi: bookAbi, functionName: "closeBatch", args: [id], account: walletFor("OFEL_ALICE_PK").account });
    log("closeBatch early", "UNEXPECTEDLY SUCCEEDED");
  } catch (e) {
    log("closeBatch early", `rejected by the contract: ${(e as { shortMessage?: string }).shortMessage?.split("\n").slice(0, 2).join(" ") ?? (e as Error).message.slice(0, 120)}`);
  }
  const mid = messageId(batchIdentity(ctx, id, b.closeAt));
  for (const [nodeID, uri] of await validatorEndpoints()) {
    try {
      await getWarpSignature(rpcOf(uri), mid);
      log(`signature ${nodeID.slice(0, 14)}`, b.state === 1 ? "UNEXPECTED: signed before close" : "signed (batch is closed)");
    } catch (e) {
      log(`signature ${nodeID.slice(0, 14)}`, `refused: ${(e as Error).message.split(": ").slice(-2).join(": ").slice(0, 100)}`);
    }
  }
  log("message", cb58Encode(mid));
} else if (cmd === "mine") {
  const w = who(a1);
  const key = await selfKey(w);
  const n = await batchCount();
  for (let id = 1n; id <= n; id++) {
    const b = await getBatch(id);
    const envs = await getEnvelopes(id);
    for (const o of await getOrders(id)) {
      if (o.trader.toLowerCase() !== w.account.address.toLowerCase()) continue;
      const m = openMine(key, envs.get(o.index)!.envelope);
      if (!m) continue;
      const f = b.state === 3 && o.status >= 5 ? fillFor(m.side, m.size, b.price, b.buyTotal, b.sellTotal) : undefined;
      log(`batch ${id} #${o.index} ${STATUS[o.status]}`, `${m.side === BUY ? "BUY" : "SELL"} ${Number(m.size) / 100} @ ${Number(m.limit) / 100}${f ? ` -> filled ${Number(f.base) / 100} @ ${Number(b.price) / 100} = ${Number(f.quote) / 100} tUSDC` : ""}`);
    }
  }
} else if (cmd === "settle") {
  const w = who(a1);
  const id = BigInt(a2);
  const b = await getBatch(id);
  if (b.state !== 3) throw new Error(`batch ${id} is not cleared yet`);
  const key = await selfKey(w);
  const envs = await getEnvelopes(id);
  const e = await eercFor(w);
  for (const o of await getOrders(id)) {
    if (o.trader.toLowerCase() !== w.account.address.toLowerCase() || o.status !== 5) continue;
    const m = openMine(key, envs.get(o.index)!.envelope)!;
    const f = fillFor(m.side, m.size, b.price, b.buyTotal, b.sellTotal);
    const token = m.side === BUY ? deployment.tUSDC : deployment.tAVAX;
    const amount = m.side === BUY ? f.quote : f.base;
    const t = Date.now();
    const h = await privateTransfer(e, w.account.address, deployment.agent, token, amount, `ofel:${id}:${o.index}:in`);
    log(`pay-in batch ${id} #${o.index}`, `${Number(amount) / 100} ${m.side === BUY ? "tUSDC" : "tAVAX"} privately (eERC) ${h} (${Date.now() - t} ms)`);
    Object.assign(out, { payIn: h });
  }
} else if (cmd === "claim") {
  const w = who(a1);
  const id = BigInt(a2);
  for (const o of await getOrders(id)) {
    if (o.trader.toLowerCase() !== w.account.address.toLowerCase() || (o.status !== 4 && o.status !== 6)) continue;
    const h = await w.writeContract({ address: BOOK, abi: bookAbi, functionName: "claimBond", args: [id, o.index], chain: undefined });
    await publicClient.waitForTransactionReceipt({ hash: h });
    log(`claimBond batch ${id} #${o.index}`, h);
  }
} else {
  console.log("usage: trader.ts order|peek|mine|settle|claim …");
}
if (process.env.OFEL_JSON_OUT) console.log(`JSON ${JSON.stringify(out)}`);
void parseEther;
process.exit(0);
