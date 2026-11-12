// Off-chain mirror of OfelBook's clearing rule, used by the agent and the public audit.
import { BUY } from "./order.ts";

export interface RevealedLimit {
  index: number;
  side: number;
  limit: bigint;
}

/** Midpoint of the last crossing pair (bids high→low vs asks low→high). 0n if nothing crosses. */
export function clearingPrice(orders: RevealedLimit[]): bigint {
  const bids = orders.filter((o) => o.side === BUY).map((o) => o.limit).sort((a, b) => (a > b ? -1 : a < b ? 1 : 0));
  const asks = orders.filter((o) => o.side !== BUY).map((o) => o.limit).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  let k = 0;
  while (k < bids.length && k < asks.length && bids[k] >= asks[k]) k++;
  if (k === 0) return 0n;
  return (bids[k - 1] + asks[k - 1]) / 2n;
}

export function inCross(o: RevealedLimit, price: bigint): boolean {
  return price !== 0n && (o.side === BUY ? o.limit >= price : o.limit <= price);
}

/** Same as OfelBook.fillFor. base in 0.01 units, quote in cents. */
export function fillFor(side: number, size: bigint, price: bigint, buyTotal: bigint, sellTotal: bigint): { base: bigint; quote: bigint } {
  const mine = side === BUY ? buyTotal : sellTotal;
  const other = side === BUY ? sellTotal : buyTotal;
  const base = mine <= other ? size : (size * other) / mine;
  return { base, quote: (base * price) / 100n };
}
