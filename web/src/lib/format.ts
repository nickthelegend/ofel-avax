import type { Hex } from "viem";

/** 0.01-unit integers (eERC decimals 2, prices in cents) to a grouped string. */
export function units(v: bigint, opts: { dp?: number } = {}): string {
  const dp = opts.dp ?? 2;
  const neg = v < 0n;
  const a = neg ? -v : v;
  const whole = (a / 100n).toLocaleString("en-US");
  const frac = (a % 100n).toString().padStart(2, "0").slice(0, dp);
  return `${neg ? "−" : ""}${whole}${dp ? "." + frac : ""}`;
}

export function short(h: string | undefined, n = 4): string {
  if (!h) return "";
  return h.length <= 2 * n + 4 ? h : `${h.slice(0, n + 2)}…${h.slice(-n)}`;
}

export function utc(ts: bigint | number): string {
  const d = new Date(Number(ts) * 1000);
  return d.toISOString().slice(11, 19) + " UTC";
}

export function countdown(secs: number): string {
  if (secs <= 0) return "00:00";
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function ago(ts: bigint | number, now = Date.now() / 1000): string {
  const d = Math.max(0, Math.round(now - Number(ts)));
  if (d < 60) return `${d}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  return `${Math.floor(d / 3600)}h ago`;
}

export function bytesLen(hex: Hex): number {
  return (hex.length - 2) / 2;
}
