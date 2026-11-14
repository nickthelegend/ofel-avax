// Ofel clearing agent (also the eERC auditor). Runs against the live L1:
//   open batch -> close at T (Warp message) -> collect validator signatures -> open envelopes ->
//   reveal -> open size blobs -> prove totals against Pedersen commitments -> clear ->
//   match eERC pay-ins -> pay out -> markSettled.
// Closing and revealing are permissionless (anyone can do them); clearing and settlement need the
// agent, because only it can read sizes (from T onward, never before).
import {
  addBlinds,
  agentKeyMessage,
  agentPublicKey,
  agentSecretFromSignature,
  BUY,
  clearingPrice,
  fillFor,
  inCross,
  openAgentBlob,
  openOrder,
  opens,
  type OpenedOrder,
} from "@ofel/core";
import { decodeFunctionData, parseAbiItem, toHex, type Abi, type Hex } from "viem";
import { encryptedErcAbi } from "@ofel/core";
import { BOOK, bookAbi, collectSignatures, ctx, getBatch, getEnvelopes, getOrders, batchCount, STATE, validators, type BatchView } from "./lib/book.ts";
import { BASE, deployment, log, publicClient, walletFor } from "./lib/env.ts";
import { withLock } from "./lib/lock.ts";
import { eercFor, privateBalance, privateTransfer } from "./lib/eerc.ts";
import { startApi } from "./lib/api.ts";

const BATCH_SECONDS = BigInt(process.env.OFEL_BATCH_SECONDS ?? 120);
const AUTO_OPEN = (process.env.OFEL_AUTO_OPEN ?? "1") === "1";
const ONCE = process.argv.includes("--once");
const MAX_SIZE = 1n << 40n;

const agent = walletFor("OFEL_AGENT_PK");
const me = agent.account.address;
const eerc = await eercFor(agent);
const sig = await agent.signMessage({ message: agentKeyMessage(ctx.chainId, BOOK) });
const agentSecret = agentSecretFromSignature(sig);
const agentPub = toHex(agentPublicKey(agentSecret));

// Calls that depend on block.timestamp skip eth_call simulation: the local L1 only makes blocks
// when there are transactions, so "latest" can be minutes old while the next block is "now".
const TIME_GATED = new Set(["closeBatch", "clear", "sweepBond"]);

async function send(functionName: string, args: unknown[]): Promise<Hex> {
  return withLock("agent", () => sendNow(functionName, args));
}

async function sendNow(functionName: string, args: unknown[]): Promise<Hex> {
  let hash: Hex;
  if (TIME_GATED.has(functionName)) {
    hash = await agent.writeContract({ address: BOOK, abi: bookAbi, functionName, args, gas: 3_000_000n, chain: undefined } as never);
  } else {
    const { request } = await publicClient.simulateContract({ address: BOOK, abi: bookAbi, functionName, args, account: agent.account });
    hash = await agent.writeContract(request as never);
  }
  const r = await publicClient.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`${functionName} reverted in ${hash}`);
  return hash;
}

// The book must encrypt size blobs to the key this wallet derives.
const onChainKey = (await publicClient.readContract({ address: BOOK, abi: bookAbi, functionName: "agentKey" })) as Hex;
if (onChainKey.toLowerCase() !== agentPub.toLowerCase()) {
  log("setAgentKey", await send("setAgentKey", [agentPub]));
}
log("agent", `${BASE} market ${BOOK}: ${me} key ${agentPub.slice(0, 18)}…`);
if (process.env.OFEL_API_PORT) startApi(Number(process.env.OFEL_API_PORT), me);

const nowS = () => BigInt(Math.floor(Date.now() / 1000));

// ------------------------------------------------------------------ batches

async function ensureOpenBatch(latest: BatchView | undefined) {
  if (!AUTO_OPEN) return;
  if (latest && latest.state === 1) return;
  const closeAt = nowS() + BATCH_SECONDS;
  const h = await send("openBatch", [closeAt]);
  log("openBatch", `closes at ${new Date(Number(closeAt) * 1000).toISOString()} ${h}`);
}

async function close(b: BatchView) {
  if (nowS() < b.closeAt + 1n) return;
  const h = await send("closeBatch", [b.id]);
  log(`batch ${b.id} closeBatch`, h);
}

interface Opened extends OpenedOrder {
  size?: bigint;
  blind?: bigint;
}

/** Open every envelope with the validators' signatures. Returns null if the threshold is not met yet. */
async function openAll(b: BatchView): Promise<Map<number, Opened> | null> {
  const rep = await collectSignatures(b);
  for (const f of rep.failures) log(`batch ${b.id} validator`, `${f.nodeID.slice(0, 14)} unavailable: ${f.error.slice(0, 80)}`);
  const vs = await validators();
  const envs = await getEnvelopes(b.id);
  const out = new Map<number, Opened>();
  for (const [i, { envelope }] of envs) {
    try {
      out.set(i, openOrder(envelope, rep.identity, vs, rep.signatures));
    } catch (e) {
      if ((e as Error).name === "NotEnoughSignaturesError" || (e as Error).message.includes("needed to open")) {
        log(`batch ${b.id}`, `waiting: ${(e as Error).message}`);
        return null;
      }
      log(`batch ${b.id} order ${i}`, `envelope does not open: ${(e as Error).message}`);
    }
  }
  log(`batch ${b.id} opened`, `${out.size}/${envs.size} envelopes with ${rep.signatures.size}/${vs.length} validator signatures`);
  return out;
}

async function revealAndClear(b: BatchView) {
  const opened = await openAll(b);
  if (!opened) return;
  const orders = await getOrders(b.id);
  const reveals = orders
    .filter((o) => o.status === 1 && opened.has(o.index))
    .map((o) => {
      const x = opened.get(o.index)!;
      return { index: o.index, side: x.side, limit: x.limit, salt: x.salt, agentBlobHash: x.agentBlobHash };
    });
  if (reveals.length) log(`batch ${b.id} revealOrders`, await send("revealOrders", [b.id, reveals]));

  const after = await getOrders(b.id);
  const unrevealed = after.filter((o) => o.status === 1).length;
  if (unrevealed && nowS() < b.closedAt + 20n) return; // reveal window still open

  // Sizes: only the agent can read them, and only now that the batch is closed.
  const voids: number[] = [];
  const reasons: number[] = [];
  const live: { index: number; side: number; limit: bigint; size: bigint; blind: bigint }[] = [];
  for (const o of after.filter((o) => o.status === 2)) {
    const x = opened.get(o.index);
    if (!x) continue;
    try {
      const { size, blind } = openAgentBlob(agentSecret, x.agentBlob);
      if (!opens({ x: o.cx, y: o.cy }, size, blind)) throw Object.assign(new Error("commitment mismatch"), { code: 2 });
      if (size <= 0n || size >= MAX_SIZE) throw Object.assign(new Error("size out of range"), { code: 3 });
      live.push({ index: o.index, side: o.side, limit: o.limit, size, blind });
    } catch (e) {
      voids.push(o.index);
      reasons.push((e as { code?: number }).code ?? 1);
      log(`batch ${b.id} void ${o.index}`, (e as Error).message);
    }
  }
  const price = clearingPrice(live);
  const filled = live.filter((o) => inCross(o, price));
  const buys = filled.filter((o) => o.side === BUY);
  const sells = filled.filter((o) => o.side !== BUY);
  const buyTotal = buys.reduce((s, o) => s + o.size, 0n);
  const sellTotal = sells.reduce((s, o) => s + o.size, 0n);
  const h = await send("clear", [b.id, voids, reasons, buyTotal, addBlinds(buys.map((o) => o.blind)), sellTotal, addBlinds(sells.map((o) => o.blind))]);
  log(`batch ${b.id} clear`, `price ${price} buyTotal ${buyTotal} sellTotal ${sellTotal} filled ${filled.length} ${h}`);
}

// --------------------------------------------------------------- settlement

const transferEvent = parseAbiItem("event PrivateTransfer(address indexed from, address indexed to, uint256[7] auditorPCT, address indexed auditorAddress)");
const usedPayIns = new Set<string>();
let tokenIds: Map<bigint, Hex> | undefined;

async function tokenOf(id: bigint): Promise<Hex | undefined> {
  if (!tokenIds) {
    tokenIds = new Map();
    for (const t of [deployment.tAVAX, deployment.tUSDC]) {
      const tid = (await publicClient.readContract({ address: deployment.encryptedERC, abi: encryptedErcAbi as Abi, functionName: "tokenIds", args: [t] })) as bigint;
      tokenIds.set(tid, t);
    }
  }
  return tokenIds.get(id);
}

/** eERC transfers into the agent: amount decrypted with the auditor key, token from calldata. */
async function payInsFrom(trader: Hex, sinceBlock: bigint) {
  const logs = await publicClient.getLogs({ address: deployment.encryptedERC, event: transferEvent, args: { from: trader, to: me }, fromBlock: sinceBlock, toBlock: "latest" });
  const out: { tx: Hex; token: Hex | undefined; amount: bigint }[] = [];
  for (const l of logs) {
    const tx = await publicClient.getTransaction({ hash: l.transactionHash });
    const call = decodeFunctionData({ abi: encryptedErcAbi as Abi, data: tx.input });
    const token = await tokenOf(call.args?.[1] as bigint);
    out.push({ tx: l.transactionHash, token, amount: eerc.decryptPCT([...(l.args.auditorPCT as readonly bigint[])]) });
  }
  return out;
}

async function settle(b: BatchView) {
  const orders = (await getOrders(b.id)).filter((o) => o.status === 5);
  if (!orders.length) return;
  const opened = await openAll(b);
  if (!opened) return;
  const clearedBlock = await blockAtOrBefore(b.clearedAt);
  for (const o of orders) {
    const x = opened.get(o.index);
    if (!x) continue;
    const { size } = openAgentBlob(agentSecret, x.agentBlob);
    const fill = fillFor(o.side, size, b.price, b.buyTotal, b.sellTotal);
    const payToken = o.side === BUY ? deployment.tUSDC : deployment.tAVAX;
    const payAmount = o.side === BUY ? fill.quote : fill.base;
    const outToken = o.side === BUY ? deployment.tAVAX : deployment.tUSDC;
    const outAmount = o.side === BUY ? fill.base : fill.quote;
    const pay = (await payInsFrom(o.trader, clearedBlock)).find((p) => p.token === payToken && p.amount >= payAmount && !usedPayIns.has(p.tx));
    if (!pay) continue; // trader has not paid in yet
    const have = (await privateBalance(eerc, me, outToken)).decrypted;
    if (have < outAmount) {
      log(`batch ${b.id} order ${o.index}`, `pay-in ${pay.tx.slice(0, 10)} seen; waiting for the counterparty leg (hub holds ${have}, owes ${outAmount})`);
      continue;
    }
    usedPayIns.add(pay.tx);
    log(`batch ${b.id} order ${o.index} pay-in`, `${pay.amount} ${o.side === BUY ? "tUSDC" : BASE} units ${pay.tx}`);
    const out = await withLock("agent", () => privateTransfer(eerc, me, o.trader, outToken, outAmount, `ofel:${b.id}:${o.index}:out`));
    log(`batch ${b.id} order ${o.index} payout`, `${outAmount} ${o.side === BUY ? BASE : "tUSDC"} units ${out}`);
    log(`batch ${b.id} order ${o.index} markSettled`, await send("markSettled", [b.id, o.index]));
  }
}

async function blockAtOrBefore(ts: bigint): Promise<bigint> {
  let hi = await publicClient.getBlockNumber();
  let lo = 0n;
  while (lo < hi) {
    const mid = (lo + hi + 1n) / 2n;
    const blk = await publicClient.getBlock({ blockNumber: mid });
    if (blk.timestamp <= ts) lo = mid;
    else hi = mid - 1n;
  }
  return lo;
}

// --------------------------------------------------------------------- loop

async function tick() {
  const n = await batchCount();
  const recent: BatchView[] = [];
  for (let id = n; id >= 1n && id > n - 6n; id--) recent.push(await getBatch(id));
  for (const b of recent.reverse()) {
    try {
      if (b.state === 1) await close(b);
      else if (b.state === 2) await revealAndClear(b);
      else if (b.state === 3) await settle(b);
    } catch (e) {
      log(`batch ${b.id} (${STATE[b.state]})`, `error: ${(e as Error).message.split("\n")[0].slice(0, 300)}`);
    }
  }
  const latest = n > 0n ? await getBatch(n) : undefined;
  await ensureOpenBatch(latest);
}

do {
  try {
    await tick();
  } catch (e) {
    log("tick", `error: ${(e as Error).message.split("\n")[0].slice(0, 300)}`);
  }
  if (!ONCE) await new Promise((r) => setTimeout(r, 2500));
} while (!ONCE);
process.exit(0);
