// Shared setup for the sandwich demo. Runs ONLY against a local Anvil fork of the Fuji C-Chain (chain 43113, port
// 8546). The accounts are Anvil's built-in dev accounts from its public test mnemonic: they hold nothing anywhere else.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, defineChain, http, type Abi, type Hex } from "viem";
import { mnemonicToAccount } from "viem/accounts";

export const ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const ANVIL_RPC = process.env.SANDWICH_RPC ?? "http://127.0.0.1:8546";
export const DEPLOYMENT = `${ROOT}deployments/sandwich-local.json`;

export const anvilFuji = defineChain({
  id: 43113,
  name: "Local Anvil fork of Fuji C-Chain",
  nativeCurrency: { name: "AVAX", symbol: "AVAX", decimals: 18 },
  rpcUrls: { default: { http: [ANVIL_RPC] } },
});

// Anvil's public dev mnemonic (printed by anvil itself on start). Never used on a real network.
const DEV_MNEMONIC = "test test test test test test test test test test test junk";
export const ROLES = { deployer: 0, victim: 1, bot: 2 } as const;
export const accountOf = (role: keyof typeof ROLES) => mnemonicToAccount(DEV_MNEMONIC, { addressIndex: ROLES[role] });

export const pub = createPublicClient({ chain: anvilFuji, transport: http(ANVIL_RPC), pollingInterval: 250 });
export const walletOf = (role: keyof typeof ROLES) => createWalletClient({ chain: anvilFuji, transport: http(ANVIL_RPC), account: accountOf(role) });

function artifact(name: string): { abi: Abi; bytecode: Hex } {
  const j = JSON.parse(readFileSync(`${ROOT}contracts/out/${name}.sol/${name}.json`, "utf8"));
  return { abi: j.abi, bytecode: j.bytecode.object };
}
export const POOL = artifact("DemoPool");
export const TOKEN = artifact("OfelTestToken");

export interface SandwichDeployment {
  network: string;
  chainId: number;
  rpc: string;
  forkedFrom: string;
  forkBlock: string;
  tAVAX: Hex;
  tUSDC: Hex;
  pool: Hex;
  victim: Hex;
  bot: Hex;
  deployer: Hex;
}
export function loadDeployment(): SandwichDeployment {
  if (!existsSync(DEPLOYMENT)) throw new Error("Setup required: run scripts/sandwich/setup.ts first (no deployments/sandwich-local.json)");
  return JSON.parse(readFileSync(DEPLOYMENT, "utf8"));
}

/** x*y=k out with the pool's 0.3% fee (same integer math as DemoPool.getAmountOut). */
export function amountOut(amountIn: bigint, rIn: bigint, rOut: bigint): bigint {
  const inFee = amountIn * 997n;
  return (inFee * rOut) / (rIn * 1000n + inFee);
}

export const fmt = (v: bigint, dp = 2) => (Number(v) / 1e18).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
export const line = (o: Record<string, unknown>) => console.log(JSON.stringify({ t: new Date().toISOString(), ...o }, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
