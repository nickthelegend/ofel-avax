// The house's sealed quote ladder. The house is blind: it never knows the side, size or limit of the order it answers.
// So instead of one buy and one sell (which made a lone trader's size equal the batch total), it splits its liquidity
// into several sealed orders per side, random whole-tAVAX sizes, limits spread within ±spread around the Chainlink
// price. The ladder is drawn again until it passes a blind check: a far-limit outside order of `depth` on EITHER side
// fills in full, at least `minPerSide` orders fill on each side of the batch, and the price stays inside the band.
// The house's own top bids sit above its lowest asks, so some house orders cross each other: that is what keeps any
// one trader's size out of the public totals in a quiet batch.
import { BUY, SELL, type Side } from "./order.ts";
import { clearingPrice, fillFor, inCross, type RevealedLimit } from "./clearing.ts";

export interface LadderOrder {
  side: Side;
  /** 0.01 tUSDC per tAVAX */
  limit: bigint;
  /** 0.01 tAVAX units, always a whole tAVAX */
  size: bigint;
}

export interface LadderOptions {
  /** Chainlink answer, 8 decimals */
  answer: bigint;
  spreadBps?: bigint;
  minOrders?: number;
  maxOrders?: number;
  /** whole tAVAX */
  minSize?: number;
  maxSize?: number;
  /** whole tAVAX an outside order on either side must be able to fill in full */
  depth?: number;
  minPerSide?: number;
  rand?: () => number;
  tries?: number;
}

export interface LadderCheck {
  price: bigint;
  buys: number;
  sells: number;
  outsideFill: bigint;
}

/** Band of whole-cent limits inside ±spreadBps of the answer. */
export function ladderBand(answer: bigint, spreadBps: bigint): { lo: bigint; hi: bigint } {
  const lo = (answer * (10_000n - spreadBps) + 10_000n * 1_000_000n - 1n) / 10_000n / 1_000_000n; // rounded up
  const hi = (answer * (10_000n + spreadBps)) / 10_000n / 1_000_000n; // rounded down
  if (lo <= hi) return { lo, hi };
  const mid = (answer + 500_000n) / 1_000_000n;
  return { lo: mid, hi: mid };
}

/** Clear the ladder against one far-limit outside order, exactly as OfelBook would. */
export function checkLadder(ladder: LadderOrder[], outside: { side: Side; size: bigint; limit: bigint }): LadderCheck {
  const all = [...ladder, outside].map((o, index) => ({ index, ...o }));
  const price = clearingPrice(all as RevealedLimit[]);
  const filled = all.filter((o) => inCross(o, price));
  const buyTotal = filled.filter((o) => o.side === BUY).reduce((s, o) => s + o.size, 0n);
  const sellTotal = filled.filter((o) => o.side === SELL).reduce((s, o) => s + o.size, 0n);
  const me = filled.find((o) => o.index === ladder.length);
  return {
    price,
    buys: filled.filter((o) => o.side === BUY).length,
    sells: filled.filter((o) => o.side === SELL).length,
    outsideFill: me ? fillFor(me.side, me.size, price, buyTotal, sellTotal).base : 0n,
  };
}

export function houseLadder(o: LadderOptions): LadderOrder[] {
  const spread = o.spreadBps ?? 15n;
  const [minN, maxN] = [o.minOrders ?? 3, o.maxOrders ?? 5];
  const [minS, maxS] = [o.minSize ?? 150, o.maxSize ?? 900];
  const depth = BigInt(o.depth ?? 1000) * 100n;
  const minPerSide = o.minPerSide ?? 2;
  const rand = o.rand ?? Math.random;
  const { lo, hi } = ladderBand(o.answer, spread);
  const int = (a: number, b: number) => a + Math.floor(rand() * (b - a + 1));
  const limit = () => lo + BigInt(int(0, Number(hi - lo)));
  for (let t = 0; t < (o.tries ?? 2000); t++) {
    const ladder: LadderOrder[] = [];
    for (const side of [BUY, SELL] as Side[]) {
      const n = int(minN, maxN);
      for (let i = 0; i < n; i++) ladder.push({ side, limit: limit(), size: BigInt(int(minS, maxS)) * 100n });
    }
    const ok = ([BUY, SELL] as Side[]).every((side) => {
      const c = checkLadder(ladder, { side, size: depth, limit: side === BUY ? hi * 2n : 1n });
      return c.price >= lo && c.price <= hi && c.outsideFill === depth && c.buys >= minPerSide && c.sells >= minPerSide;
    });
    if (!ok) continue;
    for (let i = ladder.length - 1; i > 0; i--) {
      const j = int(0, i);
      [ladder[i], ladder[j]] = [ladder[j], ladder[i]];
    }
    return ladder;
  }
  throw new Error(`no ladder within ±${Number(spread) / 100}% passes the blind check (band ${lo}..${hi})`);
}
