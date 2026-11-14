// The same sandwich bot pointed at Ofel. Read-only and keyless: it watches the REAL Ofel L1 on Fuji (public RPC) for
// pending submitOrder transactions and for orders already sealed in the open batch, and tries to read what a sandwich
// needs: side and size. All it gets is a hash commitment, a Pedersen point and a ciphertext sealed to the Warp message
// the batch emits at its close, so it has nothing to trade on. JSON lines on stdout.
//   node scripts/sandwich/bot-ofel.ts [--book 0x…] [--seconds 60]
import { readFileSync } from "node:fs";
import { createPublicClient, decodeFunctionData, http, type Abi, type Hex } from "viem";
import { ROOT, line } from "./common.ts";

const dep = JSON.parse(readFileSync(`${ROOT}deployments/fuji-l1.json`, "utf8"));
const arg = (k: string) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : undefined);
const BOOK = (arg("--book") ?? dep.ofelBook) as Hex;
const RPC = process.env.OFEL_L1_RPC ?? `${dep.validatorURIs[0]}/ext/bc/${dep.blockchainID}/rpc`;
const SECONDS = Number(arg("--seconds") ?? 60);
const abiJ = JSON.parse(readFileSync(`${ROOT}packages/ofel/src/abi/OfelBook.json`, "utf8"));
const abi = (Array.isArray(abiJ) ? abiJ : abiJ.abi) as Abi;
const l1 = createPublicClient({ transport: http(RPC) });

const seen = new Set<string>();
function report(src: string, tx: Hex, trader: Hex, input: Hex, closeAt?: bigint) {
  const call = decodeFunctionData({ abi, data: input });
  if (call.functionName !== "submitOrder") return;
  const [batchId, commitment, cx, cy, envelope] = call.args as [bigint, Hex, bigint, bigint, Hex];
  const left = closeAt ? Number(closeAt) - Math.floor(Date.now() / 1000) : undefined;
  line({
    event: `Ofel order read from ${src}`,
    tx,
    trader,
    batch: batchId,
    fieldsInCalldata: ["batchId", "commitment", "cx", "cy", "envelope"],
    commitment,
    sizeCommitment: `(${cx.toString(16).slice(0, 10)}…, ${cy.toString(16).slice(0, 10)}…) Pedersen on BN254`,
    envelopeBytes: (envelope.length - 2) / 2,
    envelopeHead: envelope.slice(0, 34) + "…",
    side: "unreadable: inside the ciphertext, sealed to the batch's close message",
    size: "unreadable: a Pedersen commitment, and the agent's copy is inside the same seal",
    closesInSeconds: left,
    decision: "cannot read side or size before the close: no front-run, no back-run, no trade",
  });
}

let filter: Hex | undefined;
try {
  filter = (await l1.request({ method: "eth_newPendingTransactionFilter" as never })) as Hex;
} catch (e) {
  line({ event: "mempool filter not offered by this RPC; reading sealed orders from blocks instead", error: (e as Error).message.split("\n")[0] });
}
const n = (await l1.readContract({ address: BOOK, abi, functionName: "batchCount" })) as bigint;
const b = (await l1.readContract({ address: BOOK, abi, functionName: "getBatch", args: [n] })) as { closeAt: bigint; state: number; orderCount: number };
line({ event: "bot watching Ofel", rpc: RPC, book: BOOK, openBatch: n, state: ["None", "Open", "Closed", "Cleared"][b.state], orders: b.orderCount, closeAt: new Date(Number(b.closeAt) * 1000).toISOString() });

const head = await l1.getBlockNumber();
let from = head > 400n ? head - 400n : 0n;
const end = Date.now() + SECONDS * 1000;
while (Date.now() < end) {
  if (filter) {
    const hs = ((await l1.request({ method: "eth_getFilterChanges" as never, params: [filter] as never }).catch(() => [])) as Hex[]) ?? [];
    for (const h of hs) {
      if (seen.has(h)) continue;
      const tx = await l1.getTransaction({ hash: h }).catch(() => undefined);
      if (tx?.to?.toLowerCase() !== BOOK.toLowerCase()) continue;
      seen.add(h);
      try { report("the L1 mempool (pending)", h, tx.from, tx.input, b.closeAt); } catch {}
    }
  }
  const to = await l1.getBlockNumber();
  if (to >= from) {
    const logs = await l1.getContractEvents({ address: BOOK, abi, eventName: "OrderSealed", fromBlock: from, toBlock: to });
    for (const l of logs) {
      if (seen.has(l.transactionHash)) continue;
      seen.add(l.transactionHash);
      const tx = await l1.getTransaction({ hash: l.transactionHash });
      const bid = (l as unknown as { args: { batchId: bigint } }).args.batchId;
      const bb = (await l1.readContract({ address: BOOK, abi, functionName: "getBatch", args: [bid] })) as { closeAt: bigint; state: number };
      try { report(bb.state === 1 ? "a block (batch still open)" : "a block (batch already closed)", l.transactionHash, tx.from, tx.input, bb.state === 1 ? bb.closeAt : undefined); } catch {}
    }
    from = to + 1n;
  }
  await new Promise((r) => setTimeout(r, 1000));
}
process.exit(0);
