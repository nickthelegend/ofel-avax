// Market data for the desk header and chart. Every number is real and labelled with where it comes from:
//  - USD reference: the current market's Chainlink feed on Avalanche Fuji (AVAX/USD, BTC/USD or ETH/USD), read with
//    latestRoundData / getRoundData.
//  - Exchange candles: Coinbase Exchange (AVAX-USD, BTC-USD, ETH-USD), falling back to Binance (see candles.ts).
//  - Ofel clears: BatchCleared events from the current market's OfelBook on the Ofel L1 (tAVAX, tBTC or tETH vs tUSDC).
import { createPublicClient, http, parseAbiItem, type PublicClient } from "viem";
import { avalancheFuji } from "viem/chains";
import { cfg, type Market } from "./config";
import { client } from "./chain";
import { chainlinkRounds, type Round } from "./candles";

export const FUJI_RPC = "https://avalanche-fuji-c-chain-rpc.publicnode.com";
/** The current market's Chainlink USD feed on Avalanche Fuji (docs.chain.link, Avalanche testnet feeds). */
export const USD_FEED = cfg.market.feed;
export const feedUrl = `https://testnet.snowtrace.io/address/${USD_FEED}`;
/** "Chainlink BTC/USD" for the current market. */
export const feedName = `Chainlink ${cfg.market.id}/USD`;

export const fuji = createPublicClient({ chain: avalancheFuji, transport: http(FUJI_RPC) }) as PublicClient;

export interface Reference {
  price: number;
  updatedAt: number;
  rounds: Round[];
}

export async function chainlinkAvax(count = 24): Promise<Reference> {
  const rounds = await chainlinkRounds(fuji, USD_FEED, count);
  const last = rounds[rounds.length - 1];
  if (!last) throw new Error(`${feedName} returned no rounds`);
  return { price: last.price, updatedAt: last.ts, rounds };
}

export interface Clear {
  batchId: bigint;
  ts: number;
  price: number; // tUSDC per unit of the market's base
  priceU: bigint; // 0.01 units
  buyTotal: bigint;
  sellTotal: bigint;
  filled: number;
}

const clearedEv = parseAbiItem("event BatchCleared(uint256 indexed batchId, uint64 price, uint64 buyTotal, uint64 sellTotal, uint32 filled)");
const blockTs = new Map<bigint, number>();

/** Every batch that crossed (price > 0), oldest first, with the block time it cleared at. */
export async function ofelClears(): Promise<Clear[]> {
  const logs = await client.getLogs({ address: cfg.book, event: clearedEv, fromBlock: 0n, toBlock: "latest" });
  const crossed = logs.filter((l) => (l.args.price as bigint) > 0n);
  await Promise.all(
    crossed.map(async (l) => {
      if (!blockTs.has(l.blockNumber)) blockTs.set(l.blockNumber, Number((await client.getBlock({ blockNumber: l.blockNumber })).timestamp));
    }),
  );
  return crossed.map((l) => ({
    batchId: l.args.batchId as bigint,
    ts: blockTs.get(l.blockNumber)!,
    price: Number(l.args.price) / 100,
    priceU: l.args.price as bigint,
    buyTotal: l.args.buyTotal as bigint,
    sellTotal: l.args.sellTotal as bigint,
    filled: Number(l.args.filled),
  }));
}

/** Clears on the market-priced book (the house follows Chainlink from cfg.repricedFrom on). */
export const priced = (c: { batchId: bigint }) => c.batchId >= cfg.repricedFrom;

export const usd = (v: number | undefined | null, dp = 2) => (v == null || !Number.isFinite(v) ? "—" : `$${v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`);
export const fix = (v: number, dp = 2) => v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });

const latestAbi = [{ type: "function", name: "latestRoundData", stateMutability: "view", inputs: [], outputs: [{ type: "uint80" }, { type: "int256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint80" }] }] as const;

/** Latest answer of every market's Chainlink feed on Fuji (8 decimals), with its update time. A failed read is an error row. */
export async function marketPrices(markets: Market[]): Promise<{ id: string; price?: number; updatedAt?: number; error?: string }[]> {
  return Promise.all(
    markets.map(async (m) => {
      try {
        const [, answer, , updatedAt] = await fuji.readContract({ address: m.feed, abi: latestAbi, functionName: "latestRoundData" });
        if (answer <= 0n) return { id: m.id, error: "no answer" };
        return { id: m.id, price: Number(answer) / 1e8, updatedAt: Number(updatedAt) };
      } catch (e) {
        return { id: m.id, error: (e as Error).message.split("\n")[0].slice(0, 80) };
      }
    }),
  );
}
