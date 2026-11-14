// The victim: an ordinary public swap on the demo pool. Buys tAVAX with tUSDC (default 31,000 tUSDC, about 1,000
// tAVAX) with a 3% slippage limit, priority fee 2 gwei. Prints the quote it saw before sending and what it got.
//   node scripts/sandwich/victim.ts [tUSDC=31000]
import { parseGwei, parseUnits, decodeEventLog } from "viem";
import { POOL, amountOut, fmt, line, loadDeployment, pub, walletOf } from "./common.ts";

const d = loadDeployment();
const amountIn = parseUnits(process.argv[2] ?? "31000", 18);
const w = walletOf("victim");
const read = (fn: string) => pub.readContract({ address: d.pool, abi: POOL.abi, functionName: fn }) as Promise<bigint>;

// Send right after a block lands, as any wallet does at a random moment: the next block is ~4 s away.
const start = await pub.getBlockNumber();
await new Promise<void>((res) => {
  const t = setInterval(async () => ((await pub.getBlockNumber()) > start ? (clearInterval(t), res()) : undefined), 150);
});
const [r0, r1] = await Promise.all([read("reserve0"), read("reserve1")]);
const quoted = amountOut(amountIn, r1, r0);
const minOut = (quoted * 97n) / 100n;
const block = await pub.getBlock();
const tip = parseGwei("2");
const hash = await w.writeContract({
  address: d.pool,
  abi: POOL.abi,
  functionName: "swapExactIn",
  args: [d.tUSDC, amountIn, minOut, w.account.address],
  maxPriorityFeePerGas: tip,
  maxFeePerGas: (block.baseFeePerGas ?? 0n) * 3n + tip + parseGwei("10"),
  gas: 200_000n,
  chain: undefined,
});
line({ event: "victim sent", hash, tUSDCIn: fmt(amountIn), quotedTAVAX: fmt(quoted), quotedPrice: (Number(amountIn) / Number(quoted)).toFixed(4), minOutTAVAX: fmt(minOut), tipGwei: 2 });
const r = await pub.waitForTransactionReceipt({ hash });
if (r.status !== "success") {
  line({ event: "victim reverted", hash, block: r.blockNumber });
  process.exit(1);
}
let got = 0n;
for (const l of r.logs) {
  try {
    const ev = decodeEventLog({ abi: POOL.abi, data: l.data, topics: l.topics });
    if (ev.eventName === "Swap") got = (ev.args as { amountOut: bigint }).amountOut;
  } catch {}
}
const lostTAVAX = quoted - got;
line({
  event: "victim filled",
  hash,
  block: r.blockNumber,
  positionInBlock: r.transactionIndex,
  gotTAVAX: fmt(got),
  quotedTAVAX: fmt(quoted),
  paidPrice: (Number(amountIn) / Number(got)).toFixed(4),
  quotedPrice: (Number(amountIn) / Number(quoted)).toFixed(4),
  lostTAVAX: fmt(lostTAVAX),
  lostTUSDCAtQuote: fmt((lostTAVAX * amountIn) / quoted),
});
