// Market data for the desk header and chart. Every number is real and labelled with where it comes from:
//  - AVAX/USD reference: Chainlink's AVAX/USD feed on Avalanche Fuji (C-Chain), read with latestRoundData / getRoundData.
//  - Exchange candles: Coinbase Exchange AVAX-USD, falling back to Binance AVAXUSDT (see candles.ts).
//  - Ofel clears: BatchCleared events from OfelBook on the Ofel L1 (tAVAX/tUSDC, the L1's own test pair).
import { createPublicClient, http, parseAbiItem, type PublicClient } from "viem";
import { avalancheFuji } from "viem/chains";
import { cfg } from "./config";
import { client } from "./chain";
import { chainlinkRounds, type Round } from "./candles";

export const FUJI_RPC = "https://avalanche-fuji-c-chain-rpc.publicnode.com";
/** Chainlink AVAX/USD on Avalanche Fuji (docs.chain.link, Avalanche testnet feeds). */
export const AVAX_USD_FEED = "0x5498BB86BC934c8D34FDA08E81D444153d0D06aD" as const;
export const feedUrl = `https://testnet.snowtrace.io/address/${AVAX_USD_FEED}`;

export const fuji = createPublicClient({ chain: avalancheFuji, transport: http(FUJI_RPC) }) as PublicClient;

export interface Reference {
  price: number;
  updatedAt: number;
  rounds: Round[];
}

export async function chainlinkAvax(count = 24): Promise<Reference> {
  const rounds = await chainlinkRounds(fuji, AVAX_USD_FEED, count);
  const last = rounds[rounds.length - 1];
  if (!last) throw new Error("Chainlink AVAX/USD returned no rounds");
  return { price: last.price, updatedAt: last.ts, rounds };
}

export interface Clear {
  batchId: bigint;
  ts: number;
  price: number; // tUSDC per tAVAX
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
