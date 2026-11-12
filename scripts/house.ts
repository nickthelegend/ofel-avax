// Ofel house liquidity: a counterparty for anyone trying the desk alone.
// The house cannot read anyone's order (they are sealed). It only sees, like everyone, that a wallet sealed
// something into the open batch. It then seals its own two-sided quote, blind: buy at OFEL_HOUSE_BID and sell at
// OFEL_HOUSE_ASK (bid < ask, so it never fills itself). After the batch clears it pays its filled legs in to the
// clearing agent with private eERC transfers, exactly like any trader, and reclaims its bonds.
//   node --env-file=../.env.fuji house.ts         (needs OFEL_HOUSE_PK with OFEL gas and private eERC balances)
import { BUY, SELL, fillFor, openMine, sealOrder, selfKeyFromSignature, selfKeyMessage, encryptedErcAbi, type Side } from "@ofel/core";
import { decodeFunctionData, parseAbiItem, toBytes, type Abi, type Hex } from "viem";
import { BOOK, bookAbi, ctx, batchCount, getBatch, getEnvelopes, getOrders, validators, type BatchView } from "./lib/book.ts";
import { deployment, log, publicClient, walletFor } from "./lib/env.ts";
import { eercFor, privateBalance, privateTransfer } from "./lib/eerc.ts";

const BID = BigInt(process.env.OFEL_HOUSE_BID ?? 3130); // tUSDC per tAVAX, 2 decimals
const ASK = BigInt(process.env.OFEL_HOUSE_ASK ?? 3140);
const SIZE = BigInt(process.env.OFEL_HOUSE_SIZE ?? 100_000); // 1,000.00 tAVAX per side
const MIN_LEFT = Number(process.env.OFEL_HOUSE_MIN_LEFT ?? 6); // seconds before T below which it does not quote
if (BID >= ASK) throw new Error("OFEL_HOUSE_BID must be below OFEL_HOUSE_ASK, or the house fills itself");

const house = walletFor("OFEL_HOUSE_PK");
const me = house.account.address.toLowerCase();
// Wallets the house never answers: itself, the clearing agent, and the scripted e2e traders.
const ignore = new Set([me, deployment.agent.toLowerCase(), ...(process.env.OFEL_HOUSE_IGNORE ?? "").toLowerCase().split(",").filter(Boolean)]);
const selfKey = selfKeyFromSignature(await house.signMessage({ message: selfKeyMessage(ctx.chainId, BOOK) }));
const eerc = await eercFor(house);
if (!(await registered(house.account.address))) {
  const r = await eerc.register();
  if (r.transactionHash) await publicClient.waitForTransactionReceipt({ hash: r.transactionHash as Hex });
  log("house registered with eERC", r.transactionHash ?? "already");
}
log("house", `${house.account.address} quotes ${Number(BID) / 100} / ${Number(ASK) / 100} for ${Number(SIZE) / 100} tAVAX`);

async function registered(user: Hex): Promise<boolean> {
  return (await publicClient.readContract({
    address: deployment.registrar,
    abi: [{ type: "function", name: "isUserRegistered", stateMutability: "view", inputs: [{ name: "user", type: "address" }], outputs: [{ type: "bool" }] }],
    functionName: "isUserRegistered",
    args: [user],
  })) as boolean;
}

const nowS = () => Date.now() / 1000;
const quoted = new Set<string>();

async function quote(b: BatchView) {
  const agentKey = toBytes((await publicClient.readContract({ address: BOOK, abi: bookAbi, functionName: "agentKey" })) as Hex);
  const bond = (await publicClient.readContract({ address: BOOK, abi: bookAbi, functionName: "bond" })) as bigint;
  const vs = await validators();
  for (const [side, limit] of [[BUY, BID], [SELL, ASK]] as [Side, bigint][]) {
    const s = sealOrder(ctx, { batchId: b.id, closeAt: b.closeAt, trader: house.account.address, side, limit, size: SIZE }, vs, 2, agentKey, selfKey);
    const hash = await house.writeContract({ address: BOOK, abi: bookAbi, functionName: "submitOrder", args: [b.id, s.commitment, s.c.x, s.c.y, s.envelope], value: bond, chain: undefined });
    const r = await publicClient.waitForTransactionReceipt({ hash });
    log(`batch ${b.id} house ${side === BUY ? "bid" : "ask"} sealed`, `${r.status} ${hash}`);
  }
}

// ------------------------------------------------------------- settlement
const transferEvent = parseAbiItem("event PrivateTransfer(address indexed from, address indexed to, uint256[7] auditorPCT, address indexed auditorAddress)");
const tokenIds = new Map<bigint, Hex>();
for (const t of [deployment.tAVAX, deployment.tUSDC] as Hex[]) {
  tokenIds.set((await publicClient.readContract({ address: deployment.encryptedERC, abi: encryptedErcAbi as Abi, functionName: "tokenIds", args: [t] })) as bigint, t);
}

/** Tokens the house already paid in to the agent since this batch cleared (survives restarts: read from chain). */
async function paidSince(fromBlock: bigint): Promise<Set<Hex>> {
  const logs = await publicClient.getLogs({ address: deployment.encryptedERC, event: transferEvent, args: { from: house.account.address, to: deployment.agent }, fromBlock, toBlock: "latest" });
  const out = new Set<Hex>();
  for (const l of logs) {
    const tx = await publicClient.getTransaction({ hash: l.transactionHash });
    const call = decodeFunctionData({ abi: encryptedErcAbi as Abi, data: tx.input });
    const t = tokenIds.get(call.args?.[1] as bigint);
    if (t) out.add(t);
  }
  return out;
}

const clearedEvent = parseAbiItem("event BatchCleared(uint256 indexed batchId, uint64 price, uint64 buyTotal, uint64 sellTotal, uint32 filled)");

async function settle(b: BatchView) {
  const mine = (await getOrders(b.id)).filter((o) => o.trader.toLowerCase() === me);
  if (!mine.length) return;
  for (const o of mine.filter((o) => o.status === 4 || o.status === 6)) {
    const h = await house.writeContract({ address: BOOK, abi: bookAbi, functionName: "claimBond", args: [b.id, o.index], chain: undefined });
    await publicClient.waitForTransactionReceipt({ hash: h });
    log(`batch ${b.id} house claimBond ${o.index}`, h);
  }
  const filled = mine.filter((o) => o.status === 5);
  if (!filled.length) return;
  const [c] = await publicClient.getLogs({ address: BOOK, event: clearedEvent, args: { batchId: b.id }, fromBlock: 0n, toBlock: "latest" });
  if (!c) return;
  const paid = await paidSince(c.blockNumber);
  const envs = await getEnvelopes(b.id);
  for (const o of filled) {
    const m = openMine(selfKey, envs.get(o.index)!.envelope);
    if (!m) continue;
    const f = fillFor(m.side, m.size, b.price, b.buyTotal, b.sellTotal);
    const token = (m.side === BUY ? deployment.tUSDC : deployment.tAVAX) as Hex;
    if (paid.has(token)) continue;
    const amount = m.side === BUY ? f.quote : f.base;
    const tx = await privateTransfer(eerc, house.account.address, deployment.agent, token, amount, `ofel:${b.id}:${o.index}:in`);
    log(`batch ${b.id} house pay-in ${o.index}`, `${amount} ${m.side === BUY ? "tUSDC" : "tAVAX"} units ${tx}`);
  }
}

async function tick() {
  const n = await batchCount();
  for (let id = n; id >= 1n && id > n - 6n; id--) {
    const b = await getBatch(id);
    try {
      if (b.state === 1 && Number(b.closeAt) - nowS() > MIN_LEFT && !quoted.has(String(id))) {
        const orders = await getOrders(id);
        if (orders.some((o) => o.trader.toLowerCase() === me)) quoted.add(String(id));
        else if (orders.some((o) => !ignore.has(o.trader.toLowerCase()))) {
          quoted.add(String(id));
          await quote(b);
        }
      } else if (b.state === 3) await settle(b);
    } catch (e) {
      log(`batch ${id} house`, `error: ${(e as Error).message.split("\n")[0].slice(0, 240)}`);
    }
  }
}

const [a, u] = await Promise.all([privateBalance(eerc, house.account.address, deployment.tAVAX as Hex), privateBalance(eerc, house.account.address, deployment.tUSDC as Hex)]);
log("house inventory", `${Number(a.decrypted) / 100} tAVAX, ${Number(u.decrypted) / 100} tUSDC (private)`);
for (;;) {
  try {
    await tick();
  } catch (e) {
    log("house tick", `error: ${(e as Error).message.split("\n")[0].slice(0, 240)}`);
  }
  await new Promise((r) => setTimeout(r, 2500));
}
