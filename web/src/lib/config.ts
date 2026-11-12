// Live deployment the desk reads. Addresses and endpoints come from deployments/<network>.json,
// written by the deploy script; nothing here is invented.
import local from "../../../deployments/local.json";
import { defineChain, type Hex } from "viem";

type Deployment = typeof local & { e2e?: unknown };
const NETWORKS: Record<string, Deployment> = { local };

export const NETWORK = (import.meta.env.VITE_OFEL_NETWORK as string | undefined) ?? "local";
const dep = NETWORKS[NETWORK];
if (!dep) throw new Error(`Setup required: no deployments/${NETWORK}.json bundled`);

export const cfg = {
  network: NETWORK,
  networkLabel: NETWORK === "local" ? "Ofel L1 · local network" : `Ofel L1 · ${NETWORK}`,
  chainId: dep.chainId,
  networkID: dep.networkID,
  subnetID: dep.subnetID,
  blockchainID: dep.blockchainID,
  blockchainIdHex: dep.blockchainIdHex as Hex,
  threshold: dep.threshold,
  validatorURIs: dep.validatorURIs,
  pchain: dep.pchain,
  rpc: `${dep.validatorURIs[0]}/ext/bc/${dep.blockchainID}/rpc`,
  book: dep.ofelBook as Hex,
  eerc: dep.encryptedERC as Hex,
  registrar: dep.registrar as Hex,
  tAVAX: dep.tAVAX as Hex,
  tUSDC: dep.tUSDC as Hex,
  agent: dep.agent as Hex,
  e2e: (dep as Deployment).e2e as Record<string, unknown> | undefined,
};

export const chain = defineChain({
  id: cfg.chainId,
  name: "Ofel L1",
  nativeCurrency: { name: "OFEL", symbol: "OFEL", decimals: 18 },
  rpcUrls: { default: { http: [cfg.rpc] } },
});

export const rpcOf = (uri: string) => `${uri}/ext/bc/${cfg.blockchainID}/rpc`;

export const circuitURLs = {
  register: { wasm: "/circuits/registration/registration.wasm", zkey: "/circuits/registration/circuit_final.zkey" },
  transfer: { wasm: "/circuits/transfer/transfer.wasm", zkey: "/circuits/transfer/transfer.zkey" },
  withdraw: { wasm: "/circuits/withdraw/withdraw.wasm", zkey: "/circuits/withdraw/circuit_final.zkey" },
  mint: { wasm: "/circuits/mint/mint.wasm", zkey: "/circuits/mint/mint.zkey" },
  burn: { wasm: "/circuits/burn/burn.wasm", zkey: "/circuits/burn/burn.zkey" },
};
