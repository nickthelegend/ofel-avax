// Records the tx hashes of a batch driven from the web desk into deployments/<net>.json ("webRun").
import { readFileSync, writeFileSync } from "node:fs";
import { parseAbiItem } from "viem";
import { getBatch, getEnvelopes, getOrders } from "./lib/book.ts";
import { deployment, NET, publicClient, ROOT } from "./lib/env.ts";

const id = BigInt(process.argv[2]);
const b = await getBatch(id);
const envs = await getEnvelopes(id);
const orders = await getOrders(id);
const t = parseAbiItem("event PrivateTransfer(address indexed from, address indexed to, uint256[7] auditorPCT, address indexed auditorAddress)");
const c = parseAbiItem("event BatchCleared(uint256 indexed batchId, uint64 price, uint64 buyTotal, uint64 sellTotal, uint32 filled)");
const [cl] = await publicClient.getLogs({ address: deployment.ofelBook, event: c, args: { batchId: id }, fromBlock: 0n });
const legs = await publicClient.getLogs({ address: deployment.encryptedERC, event: t, fromBlock: cl.blockNumber, toBlock: "latest" });
const rec = {
  batchId: id.toString(),
  via: "web desk (QA build, local signers) for sealing and pay-ins; clearing agent for close/reveal/clear/payouts",
  orders: [...envs.values()].map((e) => e.tx),
  price: b.price.toString(),
  statuses: orders.map((o) => o.status),
  clearTx: cl.transactionHash,
  eercLegs: legs.slice(0, 4).map((l) => ({ from: l.args.from, to: l.args.to, tx: l.transactionHash })),
};
const path = `${ROOT}deployments/${NET}.json`;
const dep = JSON.parse(readFileSync(path, "utf8"));
dep.webRun = rec;
writeFileSync(path, JSON.stringify(dep, null, 2) + "\n");
console.log(JSON.stringify(rec, null, 1));
process.exit(0);
