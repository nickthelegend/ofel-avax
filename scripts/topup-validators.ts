// Fuji P-Chain top-up for the Ofel L1 validators (called by scripts/topup-validators.sh):
//   1. export the deployer's C-Chain AVAX to its P-Chain address (ExportTx on C), keeping OFEL_KEEP_C for gas,
//   2. import every pending C->P UTXO on the P-Chain (ImportTx),
//   3. split the P-Chain AVAX over the L1 validators with IncreaseL1ValidatorBalanceTx so their balances end up equal,
//      keeping OFEL_KEEP_P for P-Chain fees; then print each validator's runway.
// Key: OFEL_DEPLOYER_PK (gitignored .env.fuji), never printed. Public Fuji API only (no avalanche-cli, no shim).
// OFEL_DRY_RUN=1 prints the plan and sends nothing.
import { readFileSync, writeFileSync } from "node:fs";
import { addTxSignatures, Context, evm, pvm, secp256k1, utils } from "@avalabs/avalanchejs";
import { createPublicClient, http, type Hex } from "viem";
import { avalancheFuji } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

const API = process.env.OFEL_FUJI_API ?? "https://api.avax-test.network";
const C_RPC = process.env.FUJI_RPC ?? "https://avalanche-fuji-c-chain-rpc.publicnode.com";
const KEEP_C = BigInt(Math.round(Number(process.env.OFEL_KEEP_C ?? "0.01") * 1e9)); // nAVAX
const KEEP_P = BigInt(Math.round(Number(process.env.OFEL_KEEP_P ?? "0.002") * 1e9));
const FEE_PER_S = 512n; // nAVAX per second per L1 validator on Fuji (platform.getValidatorFeeState, at the minimum)
const DRY = !!process.env.OFEL_DRY_RUN;

const fuji = JSON.parse(readFileSync(`${ROOT}deployments/fuji.json`, "utf8"));
const SUBNET_ID: string = fuji.l1.subnetID;
const pk = process.env.OFEL_DEPLOYER_PK;
if (!pk) throw new Error("Setup required: OFEL_DEPLOYER_PK is not set (gitignored .env.fuji)");
const keyBytes = utils.hexToBuffer(pk);
const pAddrBytes = secp256k1.publicKeyBytesToAddress(secp256k1.getPublicKey(keyBytes));
const P_ADDR = `P-${utils.formatBech32("fuji", pAddrBytes)}`;
const C_ADDR = privateKeyToAccount(pk as Hex).address;
if (P_ADDR !== fuji.deployer.pChain || C_ADDR.toLowerCase() !== fuji.deployer.cChain.toLowerCase())
  throw new Error(`OFEL_DEPLOYER_PK is not the Ofel deployer (${fuji.deployer.pChain})`);

const ctx = await Context.getContextFromURI(API);
const pApi = new pvm.PVMApi(API);
const cApi = new evm.EVMApi(API);
const c = createPublicClient({ chain: avalancheFuji, transport: http(C_RPC) });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const avax = (n: bigint) => (Number(n) / 1e9).toFixed(6);
const txs: Record<string, string>[] = [];

async function pCommitted(txID: string) {
  for (let i = 0; i < 60; i++) {
    const s = await pApi.getTxStatus({ txID });
    if (s.status === "Committed") return;
    if (s.status === "Dropped") throw new Error(`P-Chain tx ${txID} dropped: ${JSON.stringify(s)}`);
    await sleep(2000);
  }
  throw new Error(`P-Chain tx ${txID} not committed after 2 minutes`);
}

// ------------------------------------------------------------------ 1. C -> P export
const cWei = await c.getBalance({ address: C_ADDR });
const cNavax = cWei / 10n ** 9n;
const baseFee = await cApi.getBaseFee(); // wei
const exportFee = evm.estimateExportCost(ctx, baseFee / 10n ** 9n, 1n, ctx.pBlockchainID, utils.hexToBuffer(C_ADDR), [pAddrBytes], 0n);
const exportAmt = cNavax - KEEP_C - exportFee;
console.log(`C-Chain ${C_ADDR}: ${avax(cNavax)} AVAX`);
if (exportAmt > 1_000_000n) {
  console.log(`ExportTx C -> P: ${avax(exportAmt)} AVAX (fee ~${avax(exportFee)}, keeping ${avax(KEEP_C)} on C)`);
  if (!DRY) {
    const nonce = BigInt(await c.getTransactionCount({ address: C_ADDR }));
    const tx = evm.newExportTxFromBaseFee(ctx, baseFee / 10n ** 9n, exportAmt, ctx.pBlockchainID, utils.hexToBuffer(C_ADDR), [pAddrBytes], nonce);
    await addTxSignatures({ unsignedTx: tx, privateKeys: [keyBytes] });
    const { txID } = await cApi.issueSignedTx(tx.getSignedTx());
    console.log(`  C export ${txID}`);
    txs.push({ kind: "ExportTx C->P", txID, amountAvax: avax(exportAmt) });
    // The public API has no avax.getAtomicTxStatus; wait until the exported UTXO shows up for the P-Chain instead.
    for (let i = 0; i < 60; i++) {
      const { utxos } = await pApi.getUTXOs({ addresses: [P_ADDR], sourceChain: "C" });
      if (utxos.length) break;
      await sleep(2000);
    }
  }
} else console.log("  nothing to export");

// ------------------------------------------------------------------ 2. import on P
{
  const { utxos } = await pApi.getUTXOs({ addresses: [P_ADDR], sourceChain: "C" });
  if (utxos.length) {
    console.log(`ImportTx on P: ${utxos.length} pending C->P UTXO(s)`);
    if (!DRY) {
      const feeState = await pApi.getFeeState();
      const tx = pvm.e.newImportTx({ feeState, fromAddressesBytes: [pAddrBytes], sourceChainId: ctx.cBlockchainID, toAddressesBytes: [pAddrBytes], utxos }, ctx);
      await addTxSignatures({ unsignedTx: tx, privateKeys: [keyBytes] });
      const { txID } = await pApi.issueSignedTx(tx.getSignedTx());
      await pCommitted(txID);
      console.log(`  P import ${txID}`);
      txs.push({ kind: "ImportTx C->P", txID });
    }
  }
}

// ------------------------------------------------------------------ 3. equalise validator balances
async function pBalance(): Promise<bigint> {
  const { utxos } = await pApi.getUTXOs({ addresses: [P_ADDR] });
  return utxos.reduce((s, u) => s + ((u.output as { amount?: () => bigint }).amount?.() ?? 0n), 0n);
}
async function rpc(method: string, params: unknown) {
  const r = await fetch(`${API}/ext/bc/P`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  }).then((x) => x.json());
  if (!r.result) throw new Error(`${method} failed: ${JSON.stringify(r.error)}`);
  return r.result;
}
// getCurrentValidators on the public API can serve a cached answer for minutes; getL1Validator reads the current state.
async function l1Validators() {
  const list = (await rpc("platform.getCurrentValidators", { subnetID: SUBNET_ID })).validators as { nodeID: string; validationID: string }[];
  return Promise.all(
    list.map(async (v) => {
      const cur = await rpc("platform.getL1Validator", { validationID: v.validationID });
      return { nodeID: v.nodeID, validationID: v.validationID, balance: cur.balance as string, bal: BigInt(cur.balance) };
    }),
  );
}

const pBal = await pBalance();
const vs = await l1Validators();
// Each IncreaseL1ValidatorBalanceTx costs a small dynamic fee; reserve KEEP_P for all of them.
const avail = pBal > KEEP_P ? pBal - KEEP_P : 0n;
console.log(`P-Chain ${P_ADDR}: ${avax(pBal)} AVAX, ${avax(avail)} to spread over ${vs.length} validators`);
const target = (vs.reduce((s, v) => s + v.bal, 0n) + avail) / BigInt(vs.length);
const add = new Map(vs.map((v) => [v.validationID, target > v.bal ? target - v.bal : 0n]));
let over = [...add.values()].reduce((s, x) => s + x, 0n) - avail;
for (const v of [...vs].sort((a, b) => Number(a.bal - b.bal))) {
  if (over <= 0n) break;
  const a = add.get(v.validationID)!;
  const cut = a < over ? a : over;
  add.set(v.validationID, a - cut);
  over -= cut;
}
for (const v of vs) {
  const amt = add.get(v.validationID)!;
  if (amt < 1_000_000n) continue; // < 0.001 AVAX is not worth a tx
  console.log(`IncreaseL1ValidatorBalance ${v.nodeID}: ${avax(v.bal)} + ${avax(amt)} AVAX`);
  if (DRY) continue;
  const { utxos } = await pApi.getUTXOs({ addresses: [P_ADDR] });
  const feeState = await pApi.getFeeState();
  const tx = pvm.e.newIncreaseL1ValidatorBalanceTx({ balance: amt, feeState, fromAddressesBytes: [pAddrBytes], utxos, validationId: v.validationID }, ctx);
  await addTxSignatures({ unsignedTx: tx, privateKeys: [keyBytes] });
  const { txID } = await pApi.issueSignedTx(tx.getSignedTx());
  await pCommitted(txID);
  console.log(`  ${txID}`);
  txs.push({ kind: "IncreaseL1ValidatorBalanceTx", nodeID: v.nodeID, validationID: v.validationID, txID, amountAvax: avax(amt) });
}

// ------------------------------------------------------------------ runway (+ record)
// The public API is load-balanced and can answer from a node a few blocks behind: wait until it shows the increases.
const expected = new Map(vs.map((v) => [v.validationID, v.bal + (txs.some((t) => t.validationID === v.validationID) ? add.get(v.validationID)! : 0n) - 600_000n]));
let after = await l1Validators();
for (let i = 0; i < 30 && after.some((v) => v.bal < (expected.get(v.validationID) ?? 0n)); i++) {
  await sleep(3000);
  after = await l1Validators();
}
const now = Date.now();
const runway = after.map((v) => {
  const end = new Date(now + Number((v.bal / FEE_PER_S) * 1000n));
  console.log(`${v.nodeID}  ${avax(v.bal)} AVAX  runs out ~${end.toISOString().slice(0, 16).replace("T", " ")} UTC (${(Number(v.bal / FEE_PER_S) / 86400).toFixed(1)} days at ${FEE_PER_S} nAVAX/s)`);
  return { nodeID: v.nodeID, validationID: v.validationID, balanceAvax: avax(v.bal), runsOutUtc: end.toISOString(), measuredAt: new Date(now).toISOString() };
});
if (!DRY) {
  const f = JSON.parse(readFileSync(`${ROOT}deployments/fuji.json`, "utf8"));
  f.validatorBalances = runway;
  if (txs.length) f.topups = [...(f.topups ?? []), { at: new Date(now).toISOString(), txs }];
  writeFileSync(`${ROOT}deployments/fuji.json`, JSON.stringify(f, null, 2) + "\n");
}
