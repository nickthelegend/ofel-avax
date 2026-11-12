// The desk chart, drawn as SVG (the approach Kumi's candles use). One price scale, because since batch
// cfg.repricedFrom the house quotes around Chainlink's AVAX/USD, so Ofel's tAVAX/tUSDC clears sit on the same
// prices as the market:
//  - real AVAX-USD exchange candles (source in the legend);
//  - Chainlink's AVAX/USD feed on Fuji as a thin step line behind them (it moves only when a round updates);
//  - each Ofel batch clearing price as a marker on the candle it cleared in, with its batch number;
//  - the limit you are typing in the ticket.
import { useEffect, useMemo, useRef, useState } from "react";
import { bucketOf, priceTicks, rangeOf, type Candle, type Round } from "../lib/candles";
import type { Clear } from "../lib/market";

export interface Ohlc {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

const fmt = (v: number, dp: number) => v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
const hm = (t: number) => new Date(t * 1000).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });

/** Chainlink as a step path: flat between rounds, one vertical step at each round's update time. */
function roundsPath(rounds: Round[], first: number, last: number, sec: number, xAt: (t: number) => number, y: (v: number) => number): string {
  const sorted = [...rounds].sort((a, b) => a.ts - b.ts);
  const before = sorted.filter((r) => r.ts < first).at(-1);
  const inside = sorted.filter((r) => r.ts >= first && r.ts < last + sec);
  const pts = [...(before ? [{ ts: first, price: before.price }] : []), ...inside];
  if (!pts.length) return "";
  let d = `M${xAt(pts[0].ts).toFixed(1)} ${y(pts[0].price).toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) d += `H${xAt(pts[i].ts).toFixed(1)}V${y(pts[i].price).toFixed(1)}`;
  return d + `H${xAt(last + sec).toFixed(1)}`;
}

export function DeskChart({
  candles,
  sec,
  rounds,
  clears,
  limit,
  limitLabel,
  compact = false,
  onHover,
}: {
  candles: Candle[];
  sec: number;
  rounds: Round[];
  clears: Clear[];
  limit?: number | null;
  limitLabel?: string;
  compact?: boolean;
  onHover?: (c: Ohlc | null) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.round(e.contentRect.width), h: Math.round(e.contentRect.height) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = compact || (size.w > 0 && size.w < 560) ? 48 : 90;
  const vis = useMemo(() => candles.slice(-n), [candles, n]);
  const first = vis[0]?.t ?? 0;
  const last = vis.at(-1)?.t ?? 0;
  const marks = useMemo(() => {
    const byBucket = new Map<number, Clear>();
    for (const c of clears) if (c.ts >= first && c.ts < last + sec) byBucket.set(bucketOf(c.ts, sec), c); // latest per candle
    return [...byBucket.entries()].map(([t, c]) => ({ i: vis.findIndex((k) => k.t === t), c })).filter((m) => m.i >= 0).sort((a, b) => a.i - b.i);
  }, [clears, vis, first, last, sec]);

  const { w, h } = size;
  const axis = compact ? 44 : 62;
  const bottomAxis = compact ? 16 : 22;
  const plotW = Math.max(0, w - axis);
  const plotH = Math.max(0, h - bottomAxis);
  const step = vis.length ? plotW / vis.length : 0;
  const body = Math.max(1.5, step * 0.62);
  const x = (i: number) => i * step + step / 2;
  const xAt = (t: number) => ((t - first) / sec) * step;

  const roundsIn = rounds.filter((r) => r.ts >= first - 3 * 3600).map((r) => r.price);
  const markPrices = marks.map((m) => m.c.price);
  const lastC = vis.at(-1);
  // The typed limit joins the scale only when it is near the market (a typo far away should not squash the candles).
  const showLimit = !!limit && limit > 0 && !!lastC && Math.abs(limit - lastC.c) < lastC.c * 0.05;
  const r = rangeOf(vis, [...roundsIn, ...markPrices, ...(showLimit ? [limit!] : [])], 0.08);
  const y = (p: number) => 6 + (1 - (p - r.min) / (r.max - r.min || 1)) * (plotH - 12);

  const sel = hover !== null ? vis[hover] : undefined;
  useEffect(() => {
    onHover?.(sel ? { t: sel.t, o: sel.o, h: sel.h, l: sel.l, c: sel.c } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel?.t]);

  const lastRound = [...rounds].sort((a, b) => a.ts - b.ts).at(-1);
  const tags: { y: number; text: string; cls: string }[] = [];
  if (lastC) tags.push({ y: y(lastC.c), text: fmt(lastC.c, 3), cls: "cc-tag-ink" });
  if (showLimit) tags.push({ y: y(limit!), text: fmt(limit!, 2), cls: "cc-tag-limit" });
  if (lastRound && !compact) tags.push({ y: y(lastRound.price), text: fmt(lastRound.price, 3), cls: "cc-tag-link" });
  const placed: typeof tags = [];
  for (const t of tags) if (placed.every((p) => Math.abs(p.y - t.y) > 19)) placed.push(t);
  const timeIdx = vis.length ? [0, 0.25, 0.5, 0.75, 1].map((f) => Math.min(vis.length - 1, Math.round(f * (vis.length - 1)))) : [];
  const labelled = new Set(marks.filter((m, k) => k === marks.length - 1 || x(marks[k + 1].i) - x(m.i) > 34).map((m) => m.i));

  return (
    <div className="chart-wrap" ref={box}>
      {w > 0 && h > 0 && vis.length > 0 && (
        <svg
          className="cc"
          width={w}
          height={h}
          viewBox={`0 0 ${w} ${h}`}
          role="img"
          aria-label="AVAX-USD candles with the Chainlink feed and Ofel batch clearing prices"
          onMouseMove={(e) => {
            const b = e.currentTarget.getBoundingClientRect();
            const px = e.clientX - b.left;
            setHover(px < plotW && step ? Math.min(vis.length - 1, Math.max(0, Math.floor(px / step))) : null);
          }}
          onMouseLeave={() => setHover(null)}
        >
          {priceTicks(r.min, r.max, compact ? 3 : 5).map((t) => (
            <g key={t}>
              <line x1={0} x2={plotW} y1={y(t)} y2={y(t)} className="cc-grid" />
              <text x={plotW + 8} y={y(t) + 4} className="cc-axis">{fmt(t, compact ? 2 : 3)}</text>
            </g>
          ))}
          {/* Chainlink behind the candles */}
          <path d={roundsPath(rounds, first, last, sec, xAt, y)} className="cc-link" />
          {vis.map((c, i) => {
            const up = c.c >= c.o;
            return (
              <g key={c.t} className={up ? "cc-up" : "cc-down"} opacity={hover !== null && hover !== i ? 0.6 : 1}>
                <line x1={x(i)} x2={x(i)} y1={y(c.h)} y2={y(c.l)} className="cc-wick" />
                <rect x={x(i) - body / 2} y={Math.min(y(c.o), y(c.c))} width={body} height={Math.max(1.2, Math.abs(y(c.c) - y(c.o)))} rx={Math.min(1.5, body / 3)} className="cc-body" />
              </g>
            );
          })}
          {lastC && <line x1={0} x2={plotW} y1={y(lastC.c)} y2={y(lastC.c)} className="cc-last" />}
          {showLimit && (
            <>
              <line x1={0} x2={plotW} y1={y(limit!)} y2={y(limit!)} className="cc-limit" />
              {!compact && w >= 560 && <text x={8} y={y(limit!) - 5} className="cc-limit-t">{limitLabel ?? "Your limit"}</text>}
            </>
          )}
          {marks.map(({ i, c }) => (
            <g key={c.batchId.toString()} className="cc-mark">
              <circle cx={x(i)} cy={y(c.price)} r={compact ? 3.5 : 5} />
              {!compact && labelled.has(i) && <text x={x(i)} y={y(c.price) - 10} textAnchor="middle">#{c.batchId.toString()}</text>}
              <title>{`Ofel batch #${c.batchId} cleared at ${fmt(c.price, 2)} tUSDC per tAVAX`}</title>
            </g>
          ))}
          {placed.map((t) => (
            <g key={t.cls} className={`cc-tag ${t.cls}`}>
              <rect x={plotW + 2} y={t.y - 9} width={axis - 4} height={18} rx={5} />
              <text x={plotW + 8} y={t.y + 4}>{t.text}</text>
            </g>
          ))}
          {timeIdx.map((i, k) => (
            <text key={k} x={Math.min(plotW - 18, Math.max(18, x(i)))} y={h - 5} textAnchor="middle" className="cc-axis">{hm(vis[i].t)}</text>
          ))}
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={0} y2={plotH} className="cc-cross" />}
        </svg>
      )}
    </div>
  );
}
