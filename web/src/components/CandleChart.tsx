// The desk chart, drawn as SVG (the approach Kumi's candles use): two panes on one time axis, each with its own scale,
// because they are two different markets.
//  - top: real AVAX-USD exchange candles (source in the legend) and Chainlink's AVAX/USD feed on Fuji (dashed);
//  - bottom: the Ofel L1's tAVAX/tUSDC book: each batch's clearing price (markers carry the batch number), held until
//    the next clear, and the limit you are typing in the ticket.
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

/** Value held from each point until the next, sampled per visible candle (a last-price step line). */
function held(points: { ts: number; price: number }[], visible: Candle[], sec: number): (number | null)[] {
  const sorted = [...points].sort((a, b) => a.ts - b.ts);
  let j = 0;
  let cur: number | null = null;
  return visible.map((c) => {
    while (j < sorted.length && sorted[j].ts < c.t + sec) cur = sorted[j++].price;
    return cur;
  });
}

function stepPath(vals: (number | null)[], x: (i: number) => number, y: (v: number) => number, step: number): string {
  let d = "";
  let prev: number | null = null;
  vals.forEach((v, i) => {
    if (v == null) return;
    const x0 = x(i) - step / 2;
    const x1 = x(i) + step / 2;
    if (prev == null) d += `M${x0.toFixed(1)} ${y(v).toFixed(1)}`;
    else if (v !== prev) d += `L${x0.toFixed(1)} ${y(prev).toFixed(1)}L${x0.toFixed(1)} ${y(v).toFixed(1)}`;
    d += `L${x1.toFixed(1)} ${y(v).toFixed(1)}`;
    prev = v;
  });
  return d;
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
  const link = useMemo(() => held(rounds.map((r) => ({ ts: r.ts, price: r.price })), vis, sec), [rounds, vis, sec]);
  const ofel = useMemo(() => held(clears.map((c) => ({ ts: c.ts, price: c.price })), vis, sec), [clears, vis, sec]);
  const first = vis[0]?.t ?? 0;
  const last = vis.at(-1)?.t ?? 0;
  const marks = useMemo(() => {
    const seen = new Set<number>();
    return [...clears]
      .reverse()
      .filter((c) => c.ts >= first && c.ts < last + sec)
      .filter((c) => {
        const t = bucketOf(c.ts, sec);
        if (seen.has(t)) return false;
        seen.add(t);
        return true;
      })
      .map((c) => ({ i: vis.findIndex((k) => k.t === bucketOf(c.ts, sec)), c }))
      .filter((m) => m.i >= 0)
      .sort((a, b) => a.i - b.i);
  }, [clears, vis, first, last, sec]);

  const { w, h } = size;
  const axis = compact ? 44 : 62;
  const bottomAxis = compact ? 16 : 22;
  const plotW = Math.max(0, w - axis);
  const topH = Math.round((h - bottomAxis) * (compact ? 0.64 : 0.66));
  const gap = 8;
  const botTop = topH + gap;
  const botH = Math.max(0, h - bottomAxis - botTop);
  const step = vis.length ? plotW / vis.length : 0;
  const body = Math.max(1.5, step * 0.62);
  const x = (i: number) => i * step + step / 2;

  const topR = rangeOf(vis, link.filter((v): v is number => v != null), 0.08);
  const yT = (p: number) => 6 + (1 - (p - topR.min) / (topR.max - topR.min || 1)) * (topH - 12);
  const ofelVals = ofel.filter((v): v is number => v != null);
  const showLimit = !!limit && limit > 0 && ofelVals.length > 0 && Math.abs(limit - ofelVals[ofelVals.length - 1]) < ofelVals[ofelVals.length - 1] * 0.25;
  const bVals = [...ofelVals, ...(showLimit ? [limit!] : [])];
  const bLo = bVals.length ? Math.min(...bVals) : 0;
  const bHi = bVals.length ? Math.max(...bVals) : 1;
  const bPad = Math.max((bHi - bLo) * 0.35, 0.12);
  const yB = (p: number) => botTop + 6 + (1 - (p - (bLo - bPad)) / (bHi - bLo + 2 * bPad || 1)) * (botH - 12);

  const sel = hover !== null ? vis[hover] : undefined;
  useEffect(() => {
    onHover?.(sel ? { t: sel.t, o: sel.o, h: sel.h, l: sel.l, c: sel.c } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel?.t]);

  const lastC = vis.at(-1);
  const lastLink = link.at(-1);
  const lastOfel = ofel.at(-1);
  const tag = (y: number, text: string, cls: string) => (
    <g className={`cc-tag ${cls}`}>
      <rect x={plotW + 2} y={y - 9} width={axis - 4} height={18} rx={5} />
      <text x={plotW + 8} y={y + 4}>{text}</text>
    </g>
  );
  const timeIdx = vis.length ? [0, 0.25, 0.5, 0.75, 1].map((f) => Math.min(vis.length - 1, Math.round(f * (vis.length - 1)))) : [];

  return (
    <div className="chart-wrap" ref={box}>
      {w > 0 && h > 0 && vis.length > 0 && (
        <svg
          className="cc"
          width={w}
          height={h}
          viewBox={`0 0 ${w} ${h}`}
          role="img"
          aria-label={`AVAX-USD candles with Chainlink, and Ofel tAVAX/tUSDC clearing prices`}
          onMouseMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const px = e.clientX - r.left;
            setHover(px < plotW && step ? Math.min(vis.length - 1, Math.max(0, Math.floor(px / step))) : null);
          }}
          onMouseLeave={() => setHover(null)}
        >
          {/* top pane: grid and price ticks */}
          {priceTicks(topR.min, topR.max, compact ? 3 : 5).map((t) => (
            <g key={`t${t}`}>
              <line x1={0} x2={plotW} y1={yT(t)} y2={yT(t)} className="cc-grid" />
              <text x={plotW + 8} y={yT(t) + 4} className="cc-axis">{fmt(t, compact ? 2 : 3)}</text>
            </g>
          ))}
          {vis.map((c, i) => {
            const up = c.c >= c.o;
            return (
              <g key={c.t} className={up ? "cc-up" : "cc-down"} opacity={hover !== null && hover !== i ? 0.6 : 1}>
                <line x1={x(i)} x2={x(i)} y1={yT(c.h)} y2={yT(c.l)} className="cc-wick" />
                <rect x={x(i) - body / 2} y={Math.min(yT(c.o), yT(c.c))} width={body} height={Math.max(1.2, Math.abs(yT(c.c) - yT(c.o)))} rx={Math.min(1.5, body / 3)} className="cc-body" />
              </g>
            );
          })}
          <path d={stepPath(link, x, yT, step)} className="cc-link" />
          {lastC && <line x1={0} x2={plotW} y1={yT(lastC.c)} y2={yT(lastC.c)} className="cc-last" />}
          {lastC && !compact && tag(yT(lastC.c), fmt(lastC.c, 3), "cc-tag-ink")}
          {lastLink != null && !compact && Math.abs(yT(lastLink) - yT(lastC?.c ?? 0)) > 19 && tag(yT(lastLink), fmt(lastLink, 3), "cc-tag-link")}

          {/* bottom pane: Ofel's own book */}
          <line x1={0} x2={w} y1={topH + gap / 2} y2={topH + gap / 2} className="cc-sep" />
          {!compact && (
            <text x={6} y={botTop + 14} className="cc-pane">tAVAX / tUSDC · Ofel L1</text>
          )}
          {ofelVals.length > 0 ? (
            <>
              {priceTicks(bLo - bPad, bHi + bPad, compact ? 2 : 3).map((t) => (
                <g key={`b${t}`}>
                  <line x1={0} x2={plotW} y1={yB(t)} y2={yB(t)} className="cc-grid" />
                  <text x={plotW + 8} y={yB(t) + 4} className="cc-axis">{fmt(t, 2)}</text>
                </g>
              ))}
              <path d={stepPath(ofel, x, yB, step)} className="cc-ofel" />
              {marks.map(({ i, c }, k) => (
                <g key={c.batchId.toString()} className="cc-mark">
                  <circle cx={x(i)} cy={yB(c.price)} r={compact ? 3 : 4.5} />
                  {!compact && (k === marks.length - 1 || x(marks[k + 1].i) - x(i) > 36) && <text x={x(i)} y={yB(c.price) + 17} textAnchor="middle">#{c.batchId.toString()}</text>}
                  <title>{`Batch #${c.batchId} cleared at ${fmt(c.price, 2)} tUSDC`}</title>
                </g>
              ))}
              {showLimit && (
                <>
                  <line x1={0} x2={plotW} y1={yB(limit!)} y2={yB(limit!)} className="cc-limit" />
                  {!compact && w >= 560 && <text x={plotW - 6} y={yB(limit!) - 5} textAnchor="end" className="cc-limit-t">{limitLabel ?? "Your limit"}</text>}
                  {tag(yB(limit!), fmt(limit!, 2), "cc-tag-ink")}
                </>
              )}
              {lastOfel != null && (!showLimit || Math.abs(yB(lastOfel) - yB(limit!)) > 19) && tag(yB(lastOfel), fmt(lastOfel, 2), "cc-tag-ofel")}
            </>
          ) : (
            <text x={plotW / 2} y={botTop + botH / 2 + 4} textAnchor="middle" className="cc-axis">No Ofel batch has crossed in this window</text>
          )}

          {/* time axis and crosshair */}
          {timeIdx.map((i, k) => (
            <text key={k} x={Math.min(plotW - 18, Math.max(18, x(i)))} y={h - 5} textAnchor="middle" className="cc-axis">{hm(vis[i].t)}</text>
          ))}
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={0} y2={h - bottomAxis} className="cc-cross" />}
        </svg>
      )}
    </div>
  );
}
