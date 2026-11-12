// Shared config for Ofel scripts: live L1 endpoints from .env, addresses from deployments/<net>.json.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, defineChain, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const ROOT = fileURLToPath(new URL("../../", import.meta.url));

export function need(k: string): string {
  const v = process.env[k];
  if (!v) throw new Error(`Setup required: ${k} is not set (see .env.example)`);
  return v;
}

export const NET = process.env.OFEL_NETWORK ?? "local";
export const deployment = JSON.parse(readFileSync(`${ROOT}deployments/${NET}.json`, "utf8")) as Record<string, Hex>;

export const BLOCKCHAIN_ID = need("OFEL_BLOCKCHAIN_ID");
export const SUBNET_ID = need("OFEL_SUBNET_ID");
export const PCHAIN_URL = need("OFEL_PCHAIN_URL");
export const VALIDATOR_URIS = need("OFEL_VALIDATOR_URIS").split(",");
export const rpcOf = (uri: string) => `${uri}/ext/bc/${BLOCKCHAIN_ID}/rpc`;
export const RPC = process.env.OFEL_L1_RPC ?? rpcOf(VALIDATOR_URIS[0]);

export const chain = defineChain({
  id: Number(process.env.OFEL_CHAIN_ID ?? 77077),
  name: "Ofel L1",
  nativeCurrency: { name: "OFEL", symbol: "OFEL", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});

export const publicClient = createPublicClient({ chain, transport: http(RPC) });
export function walletFor(pkVar: string) {
  const account = privateKeyToAccount(need(pkVar) as Hex);
  return createWalletClient({ chain, transport: http(RPC), account });
}

export const circuitDir = `${ROOT}web/public/circuits`;
export const circuitURLs = {
  register: { wasm: `${circuitDir}/registration/registration.wasm`, zkey: `${circuitDir}/registration/circuit_final.zkey` },
  transfer: { wasm: `${circuitDir}/transfer/transfer.wasm`, zkey: `${circuitDir}/transfer/transfer.zkey` },
  withdraw: { wasm: `${circuitDir}/withdraw/withdraw.wasm`, zkey: `${circuitDir}/withdraw/circuit_final.zkey` },
  mint: { wasm: `${circuitDir}/mint/mint.wasm`, zkey: `${circuitDir}/mint/mint.zkey` },
  burn: { wasm: `${circuitDir}/burn/burn.wasm`, zkey: `${circuitDir}/burn/burn.zkey` },
};

export const log = (k: string, v: unknown) =>
  console.log(`${k.padEnd(30)} ${typeof v === "string" ? v : JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x))}`);
