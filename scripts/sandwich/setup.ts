// Deploys the demo pool on the local Anvil fork of Fuji: two test tokens (tAVAX, tUSDC, no value), a constant-product
// pool seeded at 8 tUSDC per tAVAX (100,000 / 800,000), near Chainlink AVAX/USD on Fuji, and balances + approvals for the victim and the bot.
//   node scripts/sandwich/setup.ts
import { writeFileSync } from "node:fs";
import { maxUint256, parseUnits, type Hex } from "viem";
import { ANVIL_RPC, DEPLOYMENT, POOL, TOKEN, accountOf, line, pub, walletOf } from "./common.ts";

const chainId = await pub.getChainId().catch(() => {
  throw new Error(`Setup required: no Anvil fork at ${ANVIL_RPC}. Start it with scripts/sandwich/anvil.sh`);
});
if (chainId !== 43113) throw new Error(`Expected the Fuji fork (chain 43113) at ${ANVIL_RPC}, got chain ${chainId}`);

const dep = walletOf("deployer");
const me = dep.account.address;
async function deploy(abi: typeof TOKEN.abi, bytecode: Hex, args: unknown[]): Promise<Hex> {
  const hash = await dep.deployContract({ abi, bytecode, args } as never);
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success" || !r.contractAddress) throw new Error(`deploy failed ${hash}`);
  return r.contractAddress;
}
async function call(address: Hex, abi: typeof TOKEN.abi, functionName: string, args: unknown[], who: "deployer" | "victim" | "bot" = "deployer") {
  const w = walletOf(who);
  const hash = await w.writeContract({ address, abi, functionName, args, chain: undefined } as never);
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`${functionName} reverted ${hash}`);
}

const e = (n: number) => parseUnits(String(n), 18);
const tAVAX = await deploy(TOKEN.abi, TOKEN.bytecode, ["Test AVAX (demo pool)", "tAVAX", 18, me]);
const tUSDC = await deploy(TOKEN.abi, TOKEN.bytecode, ["Test USDC (demo pool)", "tUSDC", 18, me]);
const pool = await deploy(POOL.abi, POOL.bytecode, [tAVAX, tUSDC]);
await call(tAVAX, TOKEN.abi, "mint", [me, e(100_000)]);
await call(tUSDC, TOKEN.abi, "mint", [me, e(800_000)]);
await call(tAVAX, TOKEN.abi, "approve", [pool, maxUint256]);
await call(tUSDC, TOKEN.abi, "approve", [pool, maxUint256]);
await call(pool, POOL.abi, "seed", [e(100_000), e(800_000)]);
const victim = accountOf("victim").address;
const bot = accountOf("bot").address;
await call(tUSDC, TOKEN.abi, "mint", [victim, e(100_000)]);
await call(tUSDC, TOKEN.abi, "mint", [bot, e(200_000)]);
for (const who of ["victim", "bot"] as const) {
  await call(tAVAX, TOKEN.abi, "approve", [pool, maxUint256], who);
  await call(tUSDC, TOKEN.abi, "approve", [pool, maxUint256], who);
}
const forkBlock = (await pub.request({ method: "anvil_nodeInfo" as never }).catch(() => undefined)) as { forkConfig?: { forkBlockNumber?: number } } | undefined;
const out = {
  network: "Local Anvil fork of Avalanche Fuji C-Chain (block time 4 s, fee-ordered mempool, Anvil public dev accounts)",
  chainId,
  rpc: ANVIL_RPC,
  forkedFrom: process.env.FUJI_RPC ?? "https://avalanche-fuji-c-chain-rpc.publicnode.com",
  forkBlock: String(forkBlock?.forkConfig?.forkBlockNumber ?? "unknown"),
  tAVAX,
  tUSDC,
  pool,
  victim,
  bot,
  deployer: me,
};
writeFileSync(DEPLOYMENT, JSON.stringify(out, null, 2) + "\n");
line({ event: "setup", ...out });
