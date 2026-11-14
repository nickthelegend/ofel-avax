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

/** One sealed-batch market: its own OfelBook and test base asset, quoted in tUSDC, settled in the same eERC. */
export interface Market {
  id: string; // AVAX, BTC, ETH
  base: string; // tAVAX, tBTC, tETH
  token: Hex;
  book: Hex;
  decimals: number;
  product: string; // Coinbase product, e.g. BTC-USD
  feed: Hex; // Chainlink USD feed on Fuji
  feedLabel: string;
  unit: number; // eERC units (0.01 base) per house size step
}
const AVAX_FEED = "0x5498BB86BC934c8D34FDA08E81D444153d0D06aD" as Hex;
const rawMarkets = (dep as unknown as { markets?: Market[] }).markets;
export const MARKETS: Market[] = rawMarkets?.length
  ? rawMarkets
  : [{ id: "AVAX", base: "tAVAX", token: dep.tAVAX as Hex, book: dep.ofelBook as Hex, decimals: 18, product: "AVAX-USD", feed: AVAX_FEED, feedLabel: "Chainlink AVAX / USD (Fuji)", unit: 100 }];

const MARKET_KEY = "ofel.market";
function pickMarket(): Market {
  let want: string | null = null;
  // The landing page always tells the tAVAX story (its sections are written for it).
  if (typeof location !== "undefined" && location.pathname === "/") return MARKETS[0];
  try {
    want = new URLSearchParams(location.search).get("m");
    if (!want) want = localStorage.getItem(MARKET_KEY);
  } catch {
    /* no storage: default market */
  }
  const m = MARKETS.find((x) => x.id.toUpperCase() === (want ?? "").toUpperCase()) ?? MARKETS[0];
  try {
    localStorage.setItem(MARKET_KEY, m.id);
  } catch {
    /* ignore */
  }
  return m;
}
export const MARKET = pickMarket();

/** Switch the desk to another market (full reload: every reader is bound to one book). */
export function switchMarket(id: string) {
  try {
    localStorage.setItem(MARKET_KEY, id);
  } catch {
    /* ignore */
  }
  const u = new URL(location.href);
  u.searchParams.set("m", id);
  location.assign(u.pathname + u.search + u.hash);
}

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
  /** The current market's book (every reader in lib/ uses this). */
  book: MARKET.book,
  market: MARKET,
  markets: MARKETS,
  eerc: dep.encryptedERC as Hex,
  registrar: dep.registrar as Hex,
  /** The current market's base asset (named tAVAX for history; tBTC / tETH on those markets). */
  tAVAX: MARKET.token,
  base: MARKET.base,
  /** The original tAVAX token (faucet asset), whatever the current market. */
  avaxToken: dep.tAVAX as Hex,
  tUSDC: dep.tUSDC as Hex,
  agent: dep.agent as Hex,
  e2e: (dep as Deployment).e2e as Record<string, unknown> | undefined,
  faucet: dep.faucet as Hex | undefined,
  house: dep.house as Hex | undefined,
  api: dep.api,
  /** First batch whose house quote follows Chainlink AVAX/USD; earlier batches cleared against a fixed ~31 tUSDC quote. */
  repricedFrom: MARKET.id !== "AVAX" ? 0n : BigInt(((dep as unknown as { houseQuote?: { pricedFromBatch?: string } }).houseQuote?.pricedFromBatch) ?? "0"),
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
