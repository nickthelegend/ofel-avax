// Live end-to-end run on an Ofel L1, local or Fuji (no mocks). Spawns the clearing agent, then:
//   1. two traders seal orders; the explorer (tx input) shows only ciphertext
//   2. opening early fails: contract TooEarly + every validator refuses to sign
//   3. at T the batch clears at one price; totals proven against Pedersen commitments;
//      both traders settle privately in eERC; the auditor decrypts every leg
//   4. one validator is stopped; the next batch still opens with 2 of 3 signatures and clears
// Every tx hash is recorded in deployments/<net>.json under "e2e".
import { spawn, execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import {
  BUY,
  SELL,
  batchIdentity,
  fillFor,
  openMine,
  sealOrder,
  selfKeyFromSignature,
  selfKeyMessage,
  type Side,
} from "@ofel/core";
import { BaseError, ContractFunctionRevertedError, toBytes, type Hex } from "viem";
import { getWarpSignature, messageId } from "warplock";
import { BOOK, bookAbi, ctx, batchCount, getBatch, getEnvelopes, getOrders, validatorEndpoints, validators } from "./lib/book.ts";
import { deployment, log, NET, publicClient, ROOT, rpcOf, VALIDATOR_URIS, walletFor } from "./lib/env.ts";
import { eercFor, privateBalance, privateTransfer } from "./lib/eerc.ts";

const BATCH = Number(process.env.OFEL_E2E_BATCH_SECONDS ?? 45);
const record: Record<string, unknown> = { startedAt: new Date().toISOString(), batchSeconds: BATCH };
let checks = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  assert.ok(cond, `${name} ${detail}`);
  checks++;
  log(`✓ ${name}`, detail);
};

// ------------------------------------------------------------------ agent
const agentLog: string[] = [];
// OFEL_E2E_AGENT_LOGS: follow an agent that already runs (the hosted one on the VPS) instead of spawning one,
// e.g. "ssh -i ~/.ssh/hackathon_vps root@201.18.198.162 docker logs -f --since 1s ofel-l1-agent-1".
const remoteAgent = process.env.OFEL_E2E_AGENT_LOGS;
const agent = remoteAgent
  ? spawn("sh", ["-c", remoteAgent])
  : spawn(process.execPath, [`--env-file=${process.env.OFEL_ENV_FILE ?? "../.env"}`, "agent.ts"], {
      cwd: `${ROOT}scripts`,
      env: { ...process.env, OFEL_BATCH_SECONDS: String(BATCH) },
    });
agent.stdout.on("data", (d) => agentLog.push(...String(d).split("\n").filter((l) => l && !l.startsWith("[EERC]"))));
agent.stderr.on("data", (d) => agentLog.push(...String(d).split("\n").filter((l) => l && !/Experimental|ExperimentalWarning/.test(l))));
const stopAgent = () => agent.kill();
process.on("exit", stopAgent);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor<T>(what: string, fn: () => Promise<T | undefined>, timeoutMs = 240_000): Promise<T> {
  const t = Date.now();
  while (Date.now() - t < timeoutMs) {
    const v = await fn();
    if (v !== undefined) return v;
    await sleep(2000);
  }
  throw new Error(`timed out waiting for ${what}\nagent log:\n${agentLog.slice(-20).join("\n")}`);
}

// ----------------------------------------------------------------- traders
const alice = walletFor("OFEL_ALICE_PK");
const bob = walletFor("OFEL_BOB_PK");
const agentWallet = walletFor("OFEL_AGENT_PK");
const selfKeys = new Map<string, Uint8Array>();
for (const w of [alice, bob]) selfKeys.set(w.account.address, selfKeyFromSignature(await w.signMessage({ message: selfKeyMessage(ctx.chainId, BOOK) })));

async function freshOpenBatch(minLeft: number) {
  return waitFor("an open batch", async () => {
    const id = await batchCount();
    if (id === 0n) return undefined;
    const b = await getBatch(id);
    const left = Number(b.closeAt) - Date.now() / 1000;
    return b.state === 1 && left >= minLeft ? b : undefined;
  });
}

async function place(w: typeof alice, batchId: bigint, closeAt: bigint, side: Side, limit: bigint, size: bigint) {
  const agentKey = toBytes((await publicClient.readContract({ address: BOOK, abi: bookAbi, functionName: "agentKey" })) as Hex);
  const vs = await validators();
  const s = sealOrder(ctx, { batchId, closeAt, trader: w.account.address, side, limit, size }, vs, 2, agentKey, selfKeys.get(w.account.address)!);
  const bond = (await publicClient.readContract({ address: BOOK, abi: bookAbi, functionName: "bond" })) as bigint;
  const hash = await w.writeContract({ address: BOOK, abi: bookAbi, functionName: "submitOrder", args: [batchId, s.commitment, s.c.x, s.c.y, s.envelope], value: bond, chain: undefined });
  const r = await publicClient.waitForTransactionReceipt({ hash });
  ok(`${side === BUY ? "buy" : "sell"} order sealed`, r.status === "success", hash);
  return { hash, size, limit };
}

function word(n: bigint) {
  return n.toString(16).padStart(64, "0");
}

async function runBatch(label: string, opts: { early: boolean; expectSigners?: number }) {
  const b = await freshOpenBatch(25);
  log(`— ${label}`, `batch ${b.id}, closes in ${Math.round(Number(b.closeAt) - Date.now() / 1000)} s`);
  const a = await place(alice, b.id, b.closeAt, BUY, 3150n, 125_000n); // buy 1,250.00 tAVAX @ <= 31.50
  const s = await place(bob, b.id, b.closeAt, SELL, 3120n, 90_000n); // sell 900.00 tAVAX @ >= 31.20
  const rec: Record<string, unknown> = { batchId: b.id.toString(), orders: [a.hash, s.hash] };

  // 1. What the explorer shows: the tx input carries no plaintext size or limit word.
  for (const h of [a.hash, s.hash]) {
    const tx = await publicClient.getTransaction({ hash: h });
    const input = tx.input.slice(10).toLowerCase();
    ok("tx input holds only ciphertext", ![word(125_000n), word(90_000n), word(3150n), word(3120n)].some((w) => input.includes(w)), `${(input.length / 2) | 0} B`);
  }

  if (opts.early) {
    // 2. Early open: the contract refuses, and no validator will sign a message that does not exist.
    try {
      await publicClient.simulateContract({ address: BOOK, abi: bookAbi, functionName: "closeBatch", args: [b.id], account: alice.account, blockOverrides: { time: BigInt(Math.floor(Date.now() / 1000)) } as never });
      ok("closeBatch before T reverts", false);
    } catch (e) {
      const rev = e instanceof BaseError ? e.walk((x) => x instanceof ContractFunctionRevertedError) : null;
      const name = rev instanceof ContractFunctionRevertedError ? rev.data?.errorName : undefined;
      ok("closeBatch before T reverts", name === "TooEarly", `error ${name}`);
    }
    const mid = messageId(batchIdentity(ctx, b.id, b.closeAt));
    for (const [nodeID, uri] of await validatorEndpoints()) {
      let refused = false;
      try {
        await getWarpSignature(rpcOf(uri), mid);
      } catch (e) {
        refused = /not found/.test((e as Error).message);
      }
      ok(`validator ${nodeID.slice(0, 14)} refuses to sign before T`, refused);
    }
    const mine = openMine(selfKeys.get(alice.account.address)!, (await getEnvelopes(b.id)).get(0)!.envelope);
    ok("trader reads own sealed order before T", mine?.size === 125_000n, `${Number(mine?.size) / 100} @ ${Number(mine?.limit) / 100}`);
  }

  // 3. Clear at T.
  const cleared = await waitFor("clearing", async () => {
    const x = await getBatch(b.id);
    return x.state === 3 ? x : undefined;
  });
  ok("batch cleared at one price", cleared.price === 3135n, `price ${Number(cleared.price) / 100}`);
  ok("totals proven against commitments", cleared.buyTotal === 125_000n && cleared.sellTotal === 90_000n, `buy ${cleared.buyTotal} sell ${cleared.sellTotal}`);
  const opened = agentLog.filter((l) => l.includes(`batch ${b.id} opened`)).at(-1) ?? "";
  if (opts.expectSigners) ok(`opened with ${opts.expectSigners} validator signatures`, opened.includes(`with ${opts.expectSigners}/3`), opened.replace(/\s+/g, " "));
  const orders = await getOrders(b.id);
  ok("both orders filled", orders.every((o) => o.status === 5));
  rec.cleared = { price: cleared.price.toString(), buyTotal: cleared.buyTotal.toString(), sellTotal: cleared.sellTotal.toString() };

  // Settlement in eERC.
  const pay: Hex[] = [];
  for (const [w, side] of [[alice, BUY], [bob, SELL]] as const) {
    const idx = orders.find((o) => o.trader.toLowerCase() === w.account.address.toLowerCase())!.index;
    const m = openMine(selfKeys.get(w.account.address)!, (await getEnvelopes(b.id)).get(idx)!.envelope)!;
    const f = fillFor(side, m.size, cleared.price, cleared.buyTotal, cleared.sellTotal);
    const e = await eercFor(w);
    pay.push(await privateTransfer(e, w.account.address, deployment.agent, side === BUY ? deployment.tUSDC : deployment.tAVAX, side === BUY ? f.quote : f.base, `ofel:${b.id}:${idx}:in`));
    ok(`${side === BUY ? "buyer" : "seller"} paid in privately`, true, `${side === BUY ? Number(f.quote) / 100 + " tUSDC" : Number(f.base) / 100 + " tAVAX"} ${pay.at(-1)}`);
  }
  rec.payIns = pay;
  await waitFor("settlement", async () => ((await getOrders(b.id)).every((o) => o.status === 6) ? true : undefined));
  ok("agent paid out and marked both settled", true);
  rec.payouts = agentLog.filter((l) => l.includes(`batch ${b.id} order`) && l.includes("payout")).map((l) => l.split(" ").at(-1));
  const claims: Hex[] = [];
  for (const w of [alice, bob]) {
    const idx = orders.find((o) => o.trader.toLowerCase() === w.account.address.toLowerCase())!.index;
    const h = await w.writeContract({ address: BOOK, abi: bookAbi, functionName: "claimBond", args: [b.id, idx], chain: undefined });
    await publicClient.waitForTransactionReceipt({ hash: h });
    claims.push(h);
  }
  ok("bonds returned", true, claims.join(" "));
  rec.bondClaims = claims;
  return rec;
}

try {
  log("network", `${NET}, book ${BOOK}`);
  record.batchA = await runBatch("batch with all validators", { early: true, expectSigners: 3 });

  // Auditor: decrypts every private leg with the eERC auditor key.
  const eg = await eercFor(agentWallet);
  const seen = await eg.auditorDecrypt();
  ok("auditor decrypts the private legs", seen.length >= 4, seen.slice(-4).map((x) => `${x.type} ${x.amount}`).join(", "));
  const pub = await privateBalance(await eercFor(alice), alice.account.address, deployment.tAVAX);
  ok("buyer's private tAVAX balance includes the fill", pub.decrypted >= 90_000n, `${Number(pub.decrypted) / 100} tAVAX`);

  // 4. One validator offline.
  // Stop a validator that is not the one serving this suite's (and the agent's) RPC.
  const eps = await validatorEndpoints();
  const down = [...eps].reverse().find(([, uri]) => uri !== VALIDATOR_URIS[0])![0];
  execFileSync(`${ROOT}scripts/validator.sh`, ["stop", down]);
  log("validator stopped", down);
  record.validatorStopped = down;
  try {
    record.batchB = await runBatch("batch with one validator offline", { early: false, expectSigners: 2 });
  } finally {
    execFileSync(`${ROOT}scripts/validator.sh`, ["start", down]);
    log("validator restarted", down);
  }
  record.checks = checks;
  record.finishedAt = new Date().toISOString();
  const path = `${ROOT}deployments/${NET}.json`;
  const dep = JSON.parse(readFileSync(path, "utf8"));
  dep.e2e = record;
  writeFileSync(path, JSON.stringify(dep, null, 2) + "\n");
  log("PASS", `${checks} live checks; tx hashes recorded in deployments/${NET}.json`);
} catch (e) {
  console.error("FAIL:", (e as Error).message);
  console.error(agentLog.slice(-25).join("\n"));
  process.exitCode = 1;
} finally {
  stopAgent();
  setTimeout(() => process.exit(), 500);
}
