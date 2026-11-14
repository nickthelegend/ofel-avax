// A real mempool-reading sandwich bot for the demo pool on the local Anvil fork of Fuji.
// It polls the node's pending-transaction filter, decodes every pending swapExactIn to the pool (the calldata is
// public: token in, amount in, minimum out), and when it sees a buy it computes the largest front-run that still lets
// the victim's own slippage limit pass, then sends:
//   front-run: buy first, fee 1 gwei above the victim's (Anvil orders the block by fee)
//   back-run:  sell what it bought, fee 1 gwei below the victim's, next nonce
// so the block reads front-run, victim, back-run. JSON lines on stdout.
//   node scripts/sandwich/bot.ts
import { decodeFunctionData, parseGwei, type Hex } from "viem";
import { POOL, amountOut, fmt, line, loadDeployment, pub, walletOf } from "./common.ts";

const d = loadDeployment();
const w = walletOf("bot");
const me = w.account.address.toLowerCase();
const seen = new Set<string>();
const TOKEN_BAL = [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }] as const;

const filter = (await pub.request({ method: "eth_newPendingTransactionFilter" as never })) as Hex;
line({ event: "bot watching mempool", pool: d.pool, bot: w.account.address, filter });

async function onPending(hash: Hex) {
  if (seen.has(hash)) return;
  seen.add(hash);
  const tx = await pub.getTransaction({ hash }).catch(() => undefined);
  if (!tx || !tx.to || tx.to.toLowerCase() !== d.pool.toLowerCase() || tx.from.toLowerCase() === me) return;
  let call;
  try {
    call = decodeFunctionData({ abi: POOL.abi, data: tx.input });
  } catch {
    return;
  }
  if (call.functionName !== "swapExactIn") return;
  const [tokenIn, vIn, vMin] = call.args as [Hex, bigint, bigint, Hex];
  const buy = tokenIn.toLowerCase() === d.tUSDC.toLowerCase();
  line({ event: "pending swap read from mempool", hash, from: tx.from, side: buy ? "BUY tAVAX" : "SELL tAVAX", amountIn: fmt(vIn), minOut: fmt(vMin), tipGwei: Number(tx.maxPriorityFeePerGas ?? 0n) / 1e9 });
  if (!buy) return line({ event: "skip", reason: "demo bot only sandwiches buys" });

  const [r0, r1] = (await Promise.all(["reserve0", "reserve1"].map((fn) => pub.readContract({ address: d.pool, abi: POOL.abi, functionName: fn })))) as bigint[];
  const cash = (await pub.readContract({ address: d.tUSDC, abi: TOKEN_BAL, functionName: "balanceOf", args: [w.account.address] })) as bigint;
  // Largest front-run x (tUSDC) such that the victim still gets >= its minOut (0.2% safety margin).
  const victimGets = (x: bigint) => {
    const b = amountOut(x, r1, r0);
    return { b, v: amountOut(vIn, r1 + x, r0 - b) };
  };
  const need = vMin + vMin / 500n;
  let lo = 0n;
  let hi = cash;
  for (let i = 0; i < 80 && hi - lo > 10n ** 15n; i++) {
    const mid = (lo + hi) / 2n;
    if (victimGets(mid).v >= need) lo = mid;
    else hi = mid;
  }
  const x = lo;
  const { b: avaxOut, v: victimOut } = victimGets(x);
  const back = amountOut(avaxOut, r0 - avaxOut - victimOut, r1 + x + vIn);
  if (x === 0n || back <= x) return line({ event: "skip", reason: "no profitable sandwich inside the victim's slippage limit" });

  // Anvil's fee ordering ranks pending txs by max fee per gas (nonce order kept per sender): front-run above the
  // victim's, back-run below it.
  const vTip = tx.maxPriorityFeePerGas ?? parseGwei("1");
  const vMax = tx.maxFeePerGas ?? tx.gasPrice ?? parseGwei("30");
  const gwei = parseGwei("1");
  const nonce = await pub.getTransactionCount({ address: w.account.address, blockTag: "pending" });
  const front = await w.writeContract({ address: d.pool, abi: POOL.abi, functionName: "swapExactIn", args: [d.tUSDC, x, 0n, w.account.address], nonce, gas: 200_000n, maxPriorityFeePerGas: vTip + gwei, maxFeePerGas: vMax + gwei, chain: undefined });
  const backH = await w.writeContract({ address: d.pool, abi: POOL.abi, functionName: "swapExactIn", args: [d.tAVAX, avaxOut, 0n, w.account.address], nonce: nonce + 1, gas: 200_000n, maxPriorityFeePerGas: vTip > gwei ? vTip - gwei : 1n, maxFeePerGas: vMax - gwei, chain: undefined });
  line({ event: "sandwich sent", victim: hash, frontRun: front, backRun: backH, frontRunTUSDC: fmt(x), expectedTAVAX: fmt(avaxOut), expectedBackTUSDC: fmt(back), expectedProfitTUSDC: fmt(back - x) });
  const [rf, rv, rb] = await Promise.all([front, hash, backH].map((h) => pub.waitForTransactionReceipt({ hash: h })));
  line({ event: "block", block: rv.blockNumber, order: [rf, rv, rb].map((r) => ({ tx: r.transactionHash, index: r.transactionIndex, block: r.blockNumber, status: r.status })) });
  const after = (await pub.readContract({ address: d.tUSDC, abi: TOKEN_BAL, functionName: "balanceOf", args: [w.account.address] })) as bigint;
  line({ event: "bot result", profitTUSDC: fmt(after - cash), sameBlock: rf.blockNumber === rv.blockNumber && rv.blockNumber === rb.blockNumber, sandwiched: rf.transactionIndex < rv.transactionIndex && rv.transactionIndex < rb.transactionIndex });
}

const ONCE = process.argv.includes("--once");
let done = false;
for (;;) {
  const hashes = (await pub.request({ method: "eth_getFilterChanges" as never, params: [filter] as never })) as Hex[];
  for (const h of hashes) {
    try {
      const before = seen.size;
      await onPending(h);
      if (ONCE && seen.size > before) {
        const tx = await pub.getTransaction({ hash: h }).catch(() => undefined);
        if (tx?.to?.toLowerCase() === d.pool.toLowerCase() && tx.from.toLowerCase() !== me) done = true;
      }
    } catch (e) {
      line({ event: "error", hash: h, error: (e as Error).message.split("\n")[0] });
    }
  }
  if (done) break;
  await new Promise((r) => setTimeout(r, 100));
}
process.exit(0);
