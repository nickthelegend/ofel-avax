// Ofel house liquidity: a counterparty for anyone trying the desk alone.
// The house cannot read anyone's order (they are sealed). It only sees, like everyone, that a wallet sealed
// something into the open batch. It then seals a blind ladder of its own: 3-5 orders per side, random whole-tAVAX
// sizes, limits spread within OFEL_HOUSE_SPREAD_BPS (default 15 = 0.15%) of the live AVAX/USD price from Chainlink's
// Fuji feed (a stale or unreadable feed means no quote, never a guessed one). Some of its bids sit above some of its
// asks, so house orders also fill against each other: every batch then mixes several orders on each side and the
// public totals never equal one trader's size (see @ofel/core ladder.ts for the blind check). After the batch clears it
// pays its filled legs in to the clearing agent with private eERC transfers, one per order, exactly like any trader,
// and reclaims its bonds.
//   node --env-file=../.env.fuji house.ts         (needs OFEL_HOUSE_PK with OFEL gas and private eERC balances)
import { BUY, SELL, fillFor, houseLadder, inCross, ladderBand, openMine, sealOrder, selfKeyFromSignature, selfKeyMessage, encryptedErcAbi, type Side } from "@ofel/core";
import { createPublicClient, decodeFunctionData, erc20Abi, http, parseAbiItem, toBytes, type Abi, type Hex } from "viem";
import { avalancheFuji } from "viem/chains";
import { BOOK, bookAbi, ctx, batchCount, getBatch, getEnvelopes, getOrders, validators, type BatchView } from "./lib/book.ts";
import { BASE, deployment, log, market, publicClient, walletFor } from "./lib/env.ts";
import { withLock } from "./lib/lock.ts";
import { eercFor, privateBalance, privateTransfer } from "./lib/eerc.ts";

const SPREAD_BPS = BigInt(process.env.OFEL_HOUSE_SPREAD_BPS ?? 15);
const MAX_AGE_S = Number(process.env.OFEL_HOUSE_MAX_AGE_S ?? 3600); // older Chainlink answer = no quote
const FEED = (process.env.OFEL_AVAX_USD_FEED ?? market?.feed ?? "0x5498BB86BC934c8D34FDA08E81D444153d0D06aD") as Hex; // Chainlink <base>/USD, Fuji
const FEED_LABEL = market?.feedLabel ?? "Chainlink AVAX / USD (Fuji)";
const fuji = createPublicClient({ chain: avalancheFuji, transport: http(process.env.OFEL_FUJI_RPC ?? "https://avalanche-fuji-c-chain-rpc.publicnode.com") });
const feedAbi = [{ type: "function", name: "latestRoundData", stateMutability: "view", inputs: [], outputs: [{ type: "uint80" }, { type: "int256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint80" }] }] as const;

/** Chainlink's AVAX/USD answer (8 decimals), refused when stale. */
async function chainlink(): Promise<{ answer: bigint; mid: number; round: bigint; age: number }> {
  const [round, answer, , updatedAt] = await fuji.readContract({ address: FEED, abi: feedAbi, functionName: "latestRoundData" });
  const age = Date.now() / 1000 - Number(updatedAt);
  if (answer <= 0n) throw new Error(`${FEED_LABEL} returned no price`);
  if (age > MAX_AGE_S) throw new Error(`${FEED_LABEL} is ${Math.round(age)} s old (max ${MAX_AGE_S}): not quoting`);
  return { answer, mid: Number(answer) / 1e8, round, age };
}
const DEPTH = Number(process.env.OFEL_HOUSE_DEPTH ?? market?.houseDepth ?? 1000); // whole tAVAX an outside order on either side fills in full
const MIN_SIZE = Number(process.env.OFEL_HOUSE_MIN_SIZE ?? market?.houseMinSize ?? 150); // whole tAVAX per house order
const MAX_SIZE = Number(process.env.OFEL_HOUSE_MAX_SIZE ?? market?.houseMaxSize ?? 900);
const UNIT = market?.unit ?? 100; // base units (0.01 of the base asset) per size step
const sz = (n: number) => (n * UNIT) / 100;
const MIN_LEFT = Number(process.env.OFEL_HOUSE_MIN_LEFT ?? 15); // seconds before T below which it does not quote

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
{
  const q = await chainlink();
  const { lo, hi } = ladderBand(q.answer, SPREAD_BPS);
  log("house", `${BASE} market ${BOOK}: ${house.account.address} seals a blind ladder, 3-5 orders per side of ${sz(MIN_SIZE)}-${sz(MAX_SIZE)} ${BASE}, limits ${Number(lo) / 100}-${Number(hi) / 100} (±${Number(SPREAD_BPS) / 100}% around ${FEED_LABEL} ${q.mid}), depth ${sz(DEPTH)} ${BASE} either side`);
}

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
  const q = await chainlink();
  const ladder = houseLadder({ answer: q.answer, spreadBps: SPREAD_BPS, minSize: MIN_SIZE, maxSize: MAX_SIZE, depth: DEPTH, unit: UNIT });
  const show = (side: number) => ladder.filter((o) => o.side === side).map((o) => `${Number(o.size) / 100}@${Number(o.limit) / 100}`).join(" ");
  log(`batch ${b.id} house ladder`, `${FEED_LABEL} ${q.mid} (round ${q.round}, ${Math.round(q.age / 60)} min old) → bids ${show(BUY)} | asks ${show(SELL)}`);
  // One nonce per order, sent back to back, so the whole ladder lands in a block or two before the close.
  await withLock("house", async () => {
  let nonce = await publicClient.getTransactionCount({ address: house.account.address, blockTag: "pending" });
  const sent: { side: Side; hash: Hex }[] = [];
  for (const o of ladder) {
    if (Number(b.closeAt) - nowS() < 4) break;
    const s = sealOrder(ctx, { batchId: b.id, closeAt: b.closeAt, trader: house.account.address, side: o.side, limit: o.limit, size: o.size }, vs, 2, agentKey, selfKey);
    const hash = await house.writeContract({ address: BOOK, abi: bookAbi, functionName: "submitOrder", args: [b.id, s.commitment, s.c.x, s.c.y, s.envelope], value: bond, nonce: nonce++, chain: undefined });
    sent.push({ side: o.side, hash });
  }
  for (const { side, hash } of sent) {
    const r = await publicClient.waitForTransactionReceipt({ hash });
    log(`batch ${b.id} house ${side === BUY ? "bid" : "ask"} sealed`, `${r.status} ${hash}`);
  }
  });
}

// ------------------------------------------------------------- settlement
const transferEvent = parseAbiItem("event PrivateTransfer(address indexed from, address indexed to, uint256[7] auditorPCT, address indexed auditorAddress)");
const tokenIds = new Map<bigint, Hex>();
for (const t of [deployment.tAVAX, deployment.tUSDC] as Hex[]) {
  tokenIds.set((await publicClient.readContract({ address: deployment.encryptedERC, abi: encryptedErcAbi as Abi, functionName: "tokenIds", args: [t] })) as bigint, t);
}

/** How many pay-ins of each token the house already sent the agent since this batch cleared (read from chain, so a
 *  restart never pays twice). The house pays each token's legs in ascending order of amount, so these are the first ones. */
async function paidSince(fromBlock: bigint): Promise<Map<Hex, number>> {
  const logs = await publicClient.getLogs({ address: deployment.encryptedERC, event: transferEvent, args: { from: house.account.address, to: deployment.agent }, fromBlock, toBlock: "latest" });
  const out = new Map<Hex, number>();
  for (const l of logs) {
    const tx = await publicClient.getTransaction({ hash: l.transactionHash });
    const call = decodeFunctionData({ abi: encryptedErcAbi as Abi, data: tx.input });
    const t = tokenIds.get(call.args?.[1] as bigint);
    if (t) out.set(t, (out.get(t) ?? 0) + 1);
  }
  return out;
}

const clearedEvent = parseAbiItem("event BatchCleared(uint256 indexed batchId, uint64 price, uint64 buyTotal, uint64 sellTotal, uint32 filled)");

async function settle(b: BatchView) {
  const mine = (await getOrders(b.id)).filter((o) => o.trader.toLowerCase() === me);
  if (!mine.length) return;
  for (const o of mine.filter((o) => o.status === 4 || o.status === 6)) {
    const h = await withLock("house", async () => {
      const h = await house.writeContract({ address: BOOK, abi: bookAbi, functionName: "claimBond", args: [b.id, o.index], chain: undefined });
      await publicClient.waitForTransactionReceipt({ hash: h });
      return h;
    });
    log(`batch ${b.id} house claimBond ${o.index}`, h);
  }
  if (!mine.some((o) => o.status === 5)) return; // nothing of ours left to pay in
  // Every house order that filled (still Filled, or already Settled / bond back): paid ones come first in the order below.
  const filled = mine.filter((o) => o.status >= 5 && inCross(o, b.price));
  const [c] = await publicClient.getLogs({ address: BOOK, event: clearedEvent, args: { batchId: b.id }, fromBlock: 0n, toBlock: "latest" });
  if (!c) return;
  const paid = await paidSince(c.blockNumber);
  const envs = await getEnvelopes(b.id);
  const all = await getOrders(b.id);
  if (!filled.length) return;
  // Pro-rata fills round down per order, so the hub could end a few cents short of a leg it owes. Each house pay-in
  // carries a small rounding margin (one tick per filled order in the batch) so every leg can always be paid out.
  const margin = BigInt(c.args.filled ?? 0) * (b.price / 100n + 2n);
  const legs = filled
    .map((o) => {
      const m = openMine(selfKey, envs.get(o.index)!.envelope);
      if (!m) return undefined;
      const f = fillFor(m.side, m.size, b.price, b.buyTotal, b.sellTotal);
      return { index: o.index, side: m.side, token: (m.side === BUY ? deployment.tUSDC : deployment.tAVAX) as Hex, amount: (m.side === BUY ? f.quote : f.base) + margin };
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
    .sort((x, y) => (x.amount < y.amount ? -1 : x.amount > y.amount ? 1 : x.index - y.index));
  // Sides are public after the reveal: pay first the token the other traders' filled orders wait for.
  const othersBuy = all.some((o) => o.status !== 3 && o.trader.toLowerCase() !== me && o.side === BUY && inCross(o, b.price));
  const first = (othersBuy ? deployment.tAVAX : deployment.tUSDC) as Hex;
  for (const token of [first, first === deployment.tAVAX ? deployment.tUSDC : deployment.tAVAX] as Hex[]) {
    const mineOf = legs.filter((l) => l.token === token);
    for (const l of mineOf.slice(paid.get(token) ?? 0)) {
      const tx = await withLock("house", () => privateTransfer(eerc, house.account.address, deployment.agent, token, l.amount, `ofel:${b.id}:${l.index}:in`));
      log(`batch ${b.id} house pay-in ${l.index}`, `${l.amount} ${l.side === BUY ? "tUSDC" : BASE} units ${tx}`);
    }
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

// Inventory: any public test assets the house holds (minted by the deployer) go into its private eERC balance first.
await withLock("house", async () => {
  for (const t of [deployment.tAVAX, deployment.tUSDC] as Hex[]) {
    const pub = (await publicClient.readContract({ address: t, abi: erc20Abi, functionName: "balanceOf", args: [house.account.address] })) as bigint;
    if (pub === 0n) continue;
    let h = await house.writeContract({ address: t, abi: erc20Abi, functionName: "approve", args: [deployment.encryptedERC, pub], chain: undefined });
    await publicClient.waitForTransactionReceipt({ hash: h });
    const d = await eerc.deposit(pub, t, 2n);
    await publicClient.waitForTransactionReceipt({ hash: d.transactionHash as Hex });
    log("house deposit into eERC", `${pub} raw units of ${t} ${d.transactionHash}`);
  }
});
const [a, u] = await Promise.all([privateBalance(eerc, house.account.address, deployment.tAVAX as Hex), privateBalance(eerc, house.account.address, deployment.tUSDC as Hex)]);
log("house inventory", `${Number(a.decrypted) / 100} ${BASE}, ${Number(u.decrypted) / 100} tUSDC (private)`);
for (;;) {
  try {
    await tick();
  } catch (e) {
    log("house tick", `error: ${(e as Error).message.split("\n")[0].slice(0, 240)}`);
  }
  await new Promise((r) => setTimeout(r, 2500));
}
