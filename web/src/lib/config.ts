// Live deployment the desk reads. Addresses and endpoints come from deployments/<network>.json,
// written by the deploy script; nothing here is invented.
import local from "../../../deployments/local.json";
import fujiL1 from "../../../deployments/fuji-l1.json";
import fujiStatus from "../../../deployments/fuji.json";
import { defineChain, type Hex } from "viem";

type Deployment = typeof local & { e2e?: unknown; faucet?: string; house?: string; api?: string };
const NETWORKS: Record<string, Deployment> = { local, "fuji-l1": fujiL1 as unknown as Deployment };

export const NETWORK = (import.meta.env.VITE_OFEL_NETWORK as string | undefined) ?? "local";
const dep = NETWORKS[NETWORK];
if (!dep) throw new Error(`Setup required: no deployments/${NETWORK}.json bundled`);

export const cfg = {
  network: NETWORK,
  networkLabel: NETWORK === "local" ? "Ofel L1 · local network" : NETWORK === "fuji-l1" ? "Ofel L1 · Fuji" : `Ofel L1 · ${NETWORK}`,
  fuji: NETWORK === "fuji-l1",
  chainId: dep.chainId,
  networkID: dep.networkID,
  subnetID: dep.subnetID,
  blockchainID: dep.blockchainID,
  blockchainIdHex: dep.blockchainIdHex as Hex,
  threshold: dep.threshold,
  validatorURIs: dep.validatorURIs,
  pchain: dep.pchain,
  /** P-Chain endpoints in order: the public mirror first (the official endpoint rate-limits busy clients), then the
   * deployment's own. Both serve the same Fuji P-Chain. */
  pchains: dep.pchain.includes("avax-test.network") ? ["https://avalanche-fuji-p-chain-rpc.publicnode.com", dep.pchain] : [dep.pchain],
  rpc: `${dep.validatorURIs[0]}/ext/bc/${dep.blockchainID}/rpc`,
  book: dep.ofelBook as Hex,
  eerc: dep.encryptedERC as Hex,
  registrar: dep.registrar as Hex,
  tAVAX: dep.tAVAX as Hex,
  tUSDC: dep.tUSDC as Hex,
  agent: dep.agent as Hex,
  e2e: (dep as Deployment).e2e as Record<string, unknown> | undefined,
  faucet: dep.faucet as Hex | undefined,
  house: dep.house as Hex | undefined,
  api: dep.api,
  /** First batch whose house quote follows Chainlink AVAX/USD; earlier batches cleared against a fixed ~31 tUSDC quote. */
  repricedFrom: BigInt(((dep as unknown as { houseQuote?: { pricedFromBatch?: string } }).houseQuote?.pricedFromBatch) ?? "0"),
  /** Avalanche Explorer pages for P-Chain transactions (the L1's own EVM txs have no hosted explorer). */
  pTx: (id: string) => `https://subnets-test.avax.network/p-chain/tx/${id}`,
  l1Page: `https://subnets-test.avax.network/subnets/${dep.subnetID}`,
  conversionTx: NETWORK === "fuji-l1" ? fujiStatus.pChainTxs.find((t) => t.kind === "ConvertSubnetToL1Tx")?.txID : undefined,
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
