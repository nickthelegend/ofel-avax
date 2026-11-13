// The desk: Eidolon's trading terminal layout on Ofel's data. A night market bar, the chart, the sealed book in the
// centre, the block-order ticket on the right and tabbed tables below. Every number is read live from the Ofel L1,
// Avalanche Fuji (Chainlink, P-Chain) or a public exchange named on screen.
import { useEffect, useMemo, useState } from "react";
import { bytesToHex } from "warplock";
import { cfg } from "../lib/config";
import { checkSignatures, getOrders, getSealed, recentBatches, validatorStatus, type Batch, type ValidatorStatus } from "../lib/chain";
import { useLive, useNow } from "../lib/hooks";
import { countdown, short, units, utc } from "../lib/format";
import { tryOpenEarly, type EarlyAttempt } from "../lib/orders";
import { fetchCandles, INTERVALS, type Interval } from "../lib/candles";
import { chainlinkAvax, feedUrl, fix, ofelClears, priced, usd, type Clear } from "../lib/market";
import { DeskChart, type Ohlc } from "../components/CandleChart";
import { Ticket, type TicketDraft } from "../components/Ticket";
import { DeskTabs } from "../components/DeskTabs";
import { Hash, Icon, Link, Pair, Skel, State, useMedia } from "../components/ui";

// Where the AES-GCM ciphertext starts in a stored envelope, in hex chars: "0x", the ABI head (64 bytes) and length word
// (32), then warplock's 3-byte head, 3 key shares of 133 bytes and the 12-byte IV. Previewing from here shows bytes that
// differ per order (the start of every envelope is the same header and validator IDs).
const CT_HEX = 2 + 2 * (96 + 3 + 3 * 133 + 12);

const IVS: Interval[] = ["1m", "5m", "15m", "1h"];

export function Desk() {
  const wide = useMedia("(min-width: 1200px)");
  const now = useNow();
  const batches = useLive(() => recentBatches(12), [], 3000);
  const current = batches.data?.[0];
  const vals = useLive(validatorStatus, [], 8000);
  const allClears = useLive(ofelClears, [current?.id, current?.state], 5000);
  const clears = { data: allClears.data?.filter(priced), error: allClears.error };
  const ref = useLive(() => chainlinkAvax(24), [], 60000);
  const [iv, setIv] = useState<Interval>(() => {
    try {
      return (localStorage.getItem("ofel.iv") as Interval) || "5m";
    } catch {
      return "5m";
    }
  });
  const candles = useLive(() => fetchCandles("AVAX", iv, 300), [iv], 10000);
  const [draft, setDraft] = useState<TicketDraft>({ side: 1, limit: null });
  const [refreshKey, setRefreshKey] = useState(0);
  const lastClear = clears.data?.at(-1);

  useEffect(() => {
    try {
      localStorage.setItem("ofel.iv", iv);
    } catch {
      /* storage blocked */
    }
  }, [iv]);

  return (
    <main className={`term ${wide ? "term-wide" : ""}`} id="main">
      <MarketBar current={current} now={now} vals={vals.data} valsErr={vals.error} lastClear={lastClear} refPrice={ref.data} refErr={ref.error} candles={candles.data} iv={iv} setIv={setIv} l1Err={batches.error} />
      <ChartPanel iv={iv} candles={candles.data} candlesErr={candles.error} rounds={ref.data?.rounds ?? []} clears={clears.data ?? []} draft={draft} />
      <BookPanel batch={current} prev={batches.data?.[1]} now={now} vals={vals.data} refreshKey={refreshKey} />
      <Ticket batch={current} lastClear={lastClear} refPrice={ref.data?.price} onDraft={setDraft} onSealed={() => setRefreshKey((k) => k + 1)} />
      <DeskTabs batches={batches.data} clears={clears.data} clearsErr={clears.error} lastClear={lastClear} refreshKey={refreshKey} />
    </main>
  );
}

/* ================================================================ market bar (night) */
function MarketBar({
  current,
  now,
  vals,
  valsErr,
  lastClear,
  refPrice,
  refErr,
  candles,
  iv,
  setIv,
  l1Err,
}: {
  current?: Batch;
  now: number;
  vals?: ValidatorStatus[];
  valsErr?: string;
  lastClear?: Clear;
  refPrice?: { price: number; updatedAt: number };
  refErr?: string;
  candles?: { candles: { t: number; c: number }[]; source: { name: string; pair: string } };
  iv: Interval;
  setIv: (i: Interval) => void;
  l1Err?: string;
}) {
  const left = current ? Number(current.closeAt) - now : 0;
  const open = current?.state === 1 && left > 0;
  const k = candles?.candles ?? [];
  const last = k.at(-1);
  const hourAgo = last ? [...k].reverse().find((c) => c.t <= last.t - 3600) : undefined;
  const chg = last && hourAgo ? ((last.c - hourAgo.c) / hourAgo.c) * 100 : null;
  const online = vals?.filter((v) => v.synced).length;
  return (
    <section className="mbar dark" aria-label="Market" data-film="market-bar">
      <div className="mb-pair">
        <Pair size={32} />
        <div>
          <b>tAVAX / tUSDC</b>
          <small>Sealed batch auction · Ofel L1</small>
        </div>
      </div>
      <div className="mb-cell">
        <span>AVAX/USD <small>· Chainlink</small></span>
        <b className="num" title={refErr}>{refPrice ? usd(refPrice.price, 3) : refErr ? "unavailable" : "…"}</b>
      </div>
      <div className={`mb-cell mb-now ${chg == null ? "" : chg >= 0 ? "up" : "down"}`}>
        <span title={candles ? `${candles.source.name} ${candles.source.pair}` : undefined}>AVAX/USD <small>· {candles ? candles.source.name : "exchange"}</small></span>
        <b className="num">
          {last ? usd(last.c, 3) : "…"}
          {chg != null && <small> {chg >= 0 ? "▲" : "▼"}{Math.abs(chg).toFixed(2)}%</small>}
        </b>
      </div>
      <div className="mb-cell mb-beat">
        <span>Last clear {lastClear && <small>· #{lastClear.batchId.toString()}</small>}</span>
        <b className="num">{lastClear ? `${fix(lastClear.price)}` : "—"}<small className="mb-unit"> tUSDC</small></b>
      </div>
      <div className={`mb-cell mb-clock ${open && left < 15 ? "late" : ""}`} aria-label={open ? `${Math.floor(left)} seconds until batch ${current?.id} seals` : undefined}>
        <span>{current ? `Batch #${current.id} ${open ? "seals in" : current.state === 1 ? "closing" : "opening next"}` : "Batch"}</span>
        <b className="num" data-film="countdown">{l1Err ? "L1 offline" : current ? (open ? countdown(left) : "00:00") : "…"}</b>
      </div>
      <div className="mb-cell mb-vals">
        <span>Validators in sync</span>
        <b className="num" title={valsErr}>{online !== undefined ? `${online}/${vals!.length}` : valsErr ? "retrying" : "…"}</b>
      </div>
      <div className="mb-mkts" role="radiogroup" aria-label="Candle interval">
        {IVS.map((x) => (
          <button key={x} role="radio" aria-checked={x === iv} className={x === iv ? "on" : ""} onClick={() => setIv(x)}>
            {x}
          </button>
        ))}
      </div>
    </section>
  );
}

/* ================================================================ chart */
function ChartPanel({ iv, candles, candlesErr, rounds, clears, draft }: { iv: Interval; candles?: Awaited<ReturnType<typeof fetchCandles>>; candlesErr?: string; rounds: { ts: number; price: number; roundId: bigint }[]; clears: Clear[]; draft: TicketDraft }) {
  const [hover, setHover] = useState<Ohlc | null>(null);
  const k = candles?.candles ?? [];
  const sel = hover ?? (k.at(-1) ? { t: k.at(-1)!.t, o: k.at(-1)!.o, h: k.at(-1)!.h, l: k.at(-1)!.l, c: k.at(-1)!.c } : null);
  const limitLabel = draft.side === 1 ? "Your limit · buy" : "Your limit · sell";
  return (
    <section className="pnl chartp" aria-label="Price chart" data-film="chart">
      <header className="pnl-tabs">
        <span className="pnl-tab on">AVAX / USD</span>
        <span className="pnl-tab on sub">Ofel clears</span>
        {sel && (
          <span className="ohlc mono hide-sm">
            O {fix(sel.o, 3)} H {fix(sel.h, 3)} L {fix(sel.l, 3)} <b className={sel.c >= sel.o ? "up" : "down"}>C {fix(sel.c, 3)}</b>
          </span>
        )}
        <span className="legend">
          <i className="lg lg-candle" />
          {candles ? candles.source.name : "Exchange"}
          <i className="lg lg-link" />
          Chainlink
          <i className="lg lg-clear" />
          Ofel clears
          {draft.limit ? (
            <>
              <i className="lg lg-limit" />
              Your limit
            </>
          ) : null}
        </span>
      </header>
      <div className="chart-box">
        {candles ? (
          <DeskChart candles={k} sec={INTERVALS[iv]} rounds={rounds} clears={clears} limit={draft.limit} limitLabel={limitLabel} onHover={setHover} />
        ) : candlesErr ? (
          <div className="chart-wait">
            <State kind="error" title="No exchange answered for AVAX candles">{candlesErr}. The sealed book and clears below are still live from the Ofel L1.</State>
          </div>
        ) : (
          <div className="chart-wait">
            <i className="pulse" /> Loading AVAX-USD {iv} candles…
          </div>
        )}
      </div>
      <p className="chart-foot mono">
        {candles ? <a href={candles.source.url} target="_blank" rel="noreferrer">{candles.source.name} {candles.source.pair}</a> : "Exchange"} {iv} candles,{" "}
        <a href={feedUrl} target="_blank" rel="noreferrer">Chainlink AVAX/USD on Fuji</a> (step line) and each Ofel batch's clearing price (dots, BatchCleared on the L1). The house quotes ±0.15% around Chainlink from batch #{cfg.repricedFrom.toString()}; earlier batches cleared at a fixed ~31 tUSDC test quote and are only in the Batches tab.
      </p>
    </section>
  );
}

/* ================================================================ the sealed book */
function BookPanel({ batch, prev, now, vals, refreshKey }: { batch?: Batch; prev?: Batch; now: number; vals?: ValidatorStatus[]; refreshKey: number }) {
  const left = batch ? Number(batch.closeAt) - now : 0;
  const isOpen = batch?.state === 1 && left > 0;
  const rows = useLive(
    async () => {
      if (!batch) return [];
      const [sealed, orders] = await Promise.all([getSealed(batch.id), getOrders(batch.id)]);
      return sealed.map((s) => ({ ...s, order: orders[s.index] }));
    },
    [batch?.id, batch?.orderCount, refreshKey],
    6000,
  );
  const [early, setEarly] = useState<EarlyAttempt & { batchId: bigint }>();
  const [trying, setTrying] = useState(false);
  useEffect(() => setEarly(undefined), [batch?.id]);
  // The batch before this one: its close message is signed (or not) right now, by each validator.
  const signed = useLive(async () => (prev && prev.state >= 2 && vals?.length ? checkSignatures(prev, vals) : undefined), [prev?.id, prev?.state, vals?.length], 20000);

  return (
    <section className="pnl bookp" aria-label="Sealed book" data-film="sealed-book">
      <header className="pnl-tabs">
        <span className="pnl-tab on">Sealed book</span>
        <span className={`auto ${isOpen ? "on" : ""}`}>
          <Icon name="lock" size={13} />
          {batch ? `#${batch.id} · ${rows.data?.length ?? batch.orderCount} sealed` : "waiting"}
        </span>
      </header>
      <div className="gp-body">
        <div className="seal dark" data-film="seal-clock">
          <div className="seal-row">
            <div>
              <span className="label">{batch ? (isOpen ? `Batch #${batch.id} seals in` : batch.state === 1 ? `Batch #${batch.id} is past its close` : `Batch #${batch.id}`) : "No batch open"}</span>
              <b className="num">{batch ? (isOpen ? countdown(left) : "00:00") : "—"}</b>
            </div>
            <img src="/art/eclipse.webp" alt="" width={64} height={64} aria-hidden />
          </div>
          <p>
            {batch ? <>Every order stays ciphertext until <b className="num">{utc(batch.closeAt)}</b>. No single validator can open it: any {cfg.threshold} of {vals?.length ?? 3} sign it open, after the close.</> : "The clearing agent opens a batch every 90 seconds."}
          </p>
        </div>

        <div className="sec-h">
          <b>What the chain sees</b>
          <span className="dim small">sizes are commitments</span>
        </div>
        {rows.error && <State kind="error" title="Can't read the book">{rows.error}</State>}
        {!rows.data && !rows.error && (
          <div className="cipher-list">
            <Skel h={36} />
            <Skel h={36} />
          </div>
        )}
        {rows.data && rows.data.length === 0 && (
          <State kind="empty" art="empty" title={`No orders in #${batch?.id ?? "—"} yet`}>The first order lands here as ciphertext.</State>
        )}
        {rows.data && rows.data.length > 0 && (
          <ol className="cipher-list" data-film="cipher-rows">
            {rows.data.map((s) => (
              <li key={s.tx}>
                <span className="ci-idx mono">{s.index}</span>
                <div className="ci-body">
                  <code className="ci-hex">{s.envelope.slice(CT_HEX, CT_HEX + 44)}…</code>
                  <span className="dim small">
                    {short(s.trader)} · {((s.envelope.length - 2) / 2).toLocaleString()} B · size C {short("0x" + (s.order?.cx ?? 0n).toString(16), 4)}
                  </span>
                </div>
                <span className={`st ${s.order?.status === 1 ? "st-live" : "st-won"}`}>
                  <i />
                  {s.order?.status === 1 ? "Sealed" : "Open"}
                </span>
              </li>
            ))}
          </ol>
        )}

        <button
          className="btn btn-ghost btn-sm btn-block"
          disabled={!batch || trying || !isOpen}
          data-film="try-open"
          onClick={async () => {
            if (!batch) return;
            setTrying(true);
            try {
              setEarly({ ...(await tryOpenEarly(batch)), batchId: batch.id });
            } finally {
              setTrying(false);
            }
          }}
        >
          <Icon name="unlock" size={15} />
          {trying ? "Asking the chain and every validator…" : isOpen ? "Try to open it now" : "Opens at the close"}
        </button>
        {early && early.batchId === batch?.id && (
          <div className="refused" role="status" data-film="refused">
            <b>Refused. It can't be read before the close.</b>
            <p>
              <code>closeBatch(#{early.batchId.toString()})</code> {early.contract}
            </p>
            {early.validators.map((v) => (
              <small key={v.nodeID} className="mono">
                {short(v.nodeID, 5)} · {v.result}
              </small>
            ))}
          </div>
        )}

        <div className="sec-h">
          <b>Batch timeline</b>
          <span className="dim small">#{batch?.id.toString() ?? "—"}</span>
        </div>
        <Timeline b={batch} now={now} />

        <div className="sec-h">
          <b>Validators signing</b>
          <span className="dim small">{prev ? `close of #${prev.id}` : ""}</span>
        </div>
        <ul className="vals" data-film="validators-signing">
          {(vals ?? []).map((v) => {
            const c = signed.data?.checks.find((x) => x.nodeID === v.nodeID);
            return (
              <li key={v.nodeID}>
                <i className={v.synced ? "live" : "off"} />
                <span className="mono">{short(v.nodeID, 5)}</span>
                <span className={`small ${c?.ok ? "up" : "dim"}`}>
                  {!v.online ? "offline" : !v.synced ? `lagging · ${v.behind ?? "?"} blocks behind` : c ? (c.ok ? "signed · BLS verified" : c.detail.startsWith("refused") ? "not signed yet" : c.detail) : signed.error ? "can't ask" : prev && prev.state < 2 ? "waiting for the close" : "asking…"}
                </span>
                {c?.signature && <code className="sig hide-sm">{bytesToHex(c.signature).slice(0, 12)}…</code>}
              </li>
            );
          })}
          {!vals && <Skel h={28} />}
        </ul>
        <Link to={batch ? `/batches/${batch.id}` : "/batches"} className="link-row">
          Batch #{batch?.id.toString() ?? "—"} in full <Icon name="arrow" size={14} />
        </Link>
      </div>
    </section>
  );
}

export function Timeline({ b, now, big = false }: { b?: Batch; now: number; big?: boolean }) {
  const steps = useMemo(() => {
    if (!b) return [];
    const closed = b.state >= 2;
    const cleared = b.state === 3;
    const left = Number(b.closeAt) - now;
    return [
      { k: "Seal", t: b.state === 1 && left <= 0 ? "past T" : `${b.orderCount} order${b.orderCount === 1 ? "" : "s"}`, done: closed },
      { k: "Warp", t: closed ? utc(b.closedAt).slice(0, 8) : "at T", done: closed },
      { k: "Open", t: closed ? `${b.revealedCount}/${b.orderCount}` : "2 of 3", done: closed && (b.revealedCount > 0 || b.orderCount === 0 || cleared) },
      { k: "Clear", t: cleared ? (b.price > 0n ? units(b.price) : "no cross") : "1 price", done: cleared },
      { k: "Settle", t: cleared ? (b.price > 0n ? "eERC legs" : "bonds back") : "private", done: cleared && b.price > 0n },
    ];
  }, [b, now]);
  const at = steps.findIndex((s) => !s.done);
  return (
    <ol className={`tline ${big ? "tline-big" : ""}`} data-film="timeline">
      {steps.map((s, i) => (
        <li key={s.k} className={s.done ? "done" : i === at ? "now" : ""}>
          <i />
          <b>{s.k}</b>
          <span className="mono">{s.t}</span>
        </li>
      ))}
    </ol>
  );
}


