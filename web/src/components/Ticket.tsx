// The block-order ticket: side, size, limit, one Seal button, then the order's life on chain step by step
// (sealed → batch closes → validators open it → one price → private settlement).
import { useEffect, useState } from "react";
import { BUY, SELL, type Side } from "@ofel/core";
import { cfg } from "../lib/config";
import { getBatch, type Batch } from "../lib/chain";
import { useLive, useNow } from "../lib/hooks";
import { countdown, short, units, utc } from "../lib/format";
import { myOrders, parseUnits2, sealAndSubmit, type SealResult } from "../lib/orders";
import { claimBond, payIn, payInLeg, payInOnChain } from "../lib/settle";
import { useWallet } from "../lib/wallet";
import type { Clear } from "../lib/market";
import { SetupSteps, useSetupState } from "./Setup";
import { Hash, Icon, Pair } from "./ui";

export interface TicketDraft {
  side: Side;
  limit: number | null;
}

const PRESETS = [100, 500, 1000, 2500];
// Starting limits per side: a buyer's cap sits above the house's ask and a seller's floor below its bid.
const DEFAULT_LIMIT = { [BUY]: "31.50", [SELL]: "31.20" } as Record<Side, string>;
const SIZE_STEP = 100;
const LIMIT_STEP = 0.05;

type Saved = Omit<SealResult, "batchId" | "closeAt"> & { batchId: string; closeAt: string };
const keyOf = (a?: string) => `ofel.lastSeal.${cfg.network}.${a?.toLowerCase()}`;
function loadSeal(a?: string): SealResult | undefined {
  try {
    const s = a && localStorage.getItem(keyOf(a));
    if (!s) return undefined;
    const x = JSON.parse(s) as Saved;
    return { ...x, batchId: BigInt(x.batchId), closeAt: BigInt(x.closeAt) };
  } catch {
    return undefined;
  }
}
function saveSeal(a: string, r: SealResult) {
  try {
    localStorage.setItem(keyOf(a), JSON.stringify({ ...r, batchId: r.batchId.toString(), closeAt: r.closeAt.toString() }));
  } catch {
    /* storage blocked: the status lasts for this page only */
  }
}

export function Ticket({ batch, lastClear, onDraft, onSealed }: { batch?: Batch; lastClear?: Clear; onDraft: (d: TicketDraft) => void; onSealed: () => void }) {
  const w = useWallet();
  const now = useNow();
  const setup = useSetupState();
  const [side, setSide] = useState<Side>(BUY);
  const [size, setSize] = useState("1250");
  const [limit, setLimit] = useState(DEFAULT_LIMIT[BUY]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const [done, setDone] = useState<SealResult | undefined>(() => loadSeal(w.address));
  useEffect(() => setDone(loadSeal(w.address)), [w.address]);

  const sizeU = parseUnits2(size);
  const limitU = parseUnits2(limit);
  useEffect(() => onDraft({ side, limit: limitU ? Number(limitU) / 100 : null }), [side, limitU, onDraft]);

  const pickSide = (x: Side) => {
    setSide(x);
    if (limit === DEFAULT_LIMIT[side]) setLimit(DEFAULT_LIMIT[x]);
  };
  const left = batch ? Number(batch.closeAt) - now : 0;
  const open = batch?.state === 1 && left > 2;
  const notional = sizeU && limitU ? (sizeU * limitU) / 100n : 0n;
  const needsSetup = !!w.address && !!setup.r.data && !setup.ready;
  const can = !!w.client && open && !needsSetup && !!sizeU && sizeU > 0n && !!limitU && limitU > 0n && !busy;
  const n = Number(size.replace(/,/g, "")) || 0;
  const lim = Number(limit) || 0;

  async function submit() {
    if (!batch || !w.client || !sizeU || !limitU || !w.address) return;
    setBusy(true);
    setErr(undefined);
    try {
      const k = await w.selfKey();
      const r = await sealAndSubmit(w.client, k, batch, side, limitU, sizeU);
      saveSeal(w.address, r);
      setDone(r);
      onSealed();
    } catch (e) {
      setErr((e as Error).message.split("\n")[0].slice(0, 240));
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="pnl form" aria-label="Order ticket" data-film="ticket">
      <div className="form-head">
        <Pair size={30} />
        <div>
          <b>Block order · tAVAX</b>
          <small>{batch ? `Batch #${batch.id} · sealed until ${utc(batch.closeAt)}` : "Waiting for the next batch"}</small>
        </div>
      </div>
      <div className="form-body">
        <div className="updown" role="radiogroup" aria-label="Side">
          {([BUY, SELL] as const).map((s) => (
            <button key={s} role="radio" aria-checked={side === s} className={`ud ud-${s === BUY ? "up" : "down"} ${side === s ? "on" : ""}`} onClick={() => pickSide(s)} data-film={s === BUY ? "side-buy" : "side-sell"}>
              <span>
                <Icon name={s === BUY ? "up" : "down"} size={16} />
                {s === BUY ? "Buy" : "Sell"}
              </span>
              <small>{s === BUY ? "pay at most" : "receive at least"}</small>
            </button>
          ))}
        </div>
        <label className="fld">
          <span>Size</span>
          <div className="fld-in">
            <button type="button" className="step" aria-label={`${SIZE_STEP} tAVAX less`} onClick={() => setSize(String(Math.max(0, n - SIZE_STEP)))}>−</button>
            <input id="size" inputMode="decimal" value={size} onChange={(e) => setSize(e.target.value)} aria-label="Size in tAVAX" aria-invalid={size !== "" && !sizeU} />
            <em>tAVAX</em>
            <button type="button" className="step" aria-label={`${SIZE_STEP} tAVAX more`} onClick={() => setSize(String(n + SIZE_STEP))}>+</button>
          </div>
          <div className="chips chips-4">
            {PRESETS.map((v) => (
              <button key={v} type="button" className={n === v ? "on" : ""} onClick={() => setSize(String(v))}>
                {v.toLocaleString("en-US")}
              </button>
            ))}
          </div>
        </label>
        <label className="fld">
          <span>{side === BUY ? "Limit · pay at most" : "Limit · receive at least"}</span>
          <div className="fld-in">
            <button type="button" className="step" aria-label="0.05 lower" onClick={() => setLimit(Math.max(0, lim - LIMIT_STEP).toFixed(2))}>−</button>
            <input id="limit" inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} aria-label="Limit in tUSDC per tAVAX" aria-invalid={limit !== "" && !limitU} />
            <em>tUSDC</em>
            <button type="button" className="step" aria-label="0.05 higher" onClick={() => setLimit((lim + LIMIT_STEP).toFixed(2))}>+</button>
          </div>
          {lastClear && (
            <small className="dim">
              Last clear <button type="button" className="link" onClick={() => setLimit(lastClear.price.toFixed(2))}>{lastClear.price.toFixed(2)}</button> in batch #{lastClear.batchId.toString()}
            </small>
          )}
        </label>
        <dl className="summ">
          <div>
            <dt>Notional at limit</dt>
            <dd className="num">{units(notional)} tUSDC</dd>
          </div>
          <div>
            <dt>Bond, refunded</dt>
            <dd className="num">0.10 OFEL</dd>
          </div>
          <div>
            <dt>Sealed until</dt>
            <dd className="num">{batch ? `${utc(batch.closeAt)}${open ? ` · ${countdown(left)}` : ""}` : "—"}</dd>
          </div>
          <div>
            <dt>Who sees your size</dt>
            <dd>you and the auditor</dd>
          </div>
        </dl>
        {needsSetup ? (
          <SetupSteps state={setup} />
        ) : !w.client && cfg.faucet ? (
          <button className="btn btn-primary btn-block btn-lg" onClick={() => w.connectTest()} data-film="test-wallet">
            Start with a test wallet
          </button>
        ) : (
          <button className="btn btn-primary btn-block btn-lg" disabled={!can} onClick={submit} data-film="seal">
            {busy ? (
              <>
                <i className="spin" aria-hidden /> Sealing in this browser…
              </>
            ) : !w.client ? (
              "Connect to seal an order"
            ) : !open ? (
              "Waiting for the next batch"
            ) : (
              <>
                <Icon name="lock" size={16} /> Seal {side === BUY ? "buy" : "sell"} order
              </>
            )}
          </button>
        )}
        {err && <p className="sheet-err" role="alert">{err}</p>}
        {done && <OrderStatus done={done} onClear={() => setDone(undefined)} />}
        <p className="form-note">Your size and limit are encrypted here before they leave the browser. At the close only side and limit open; size stays a commitment.</p>
      </div>
      <details className="vault-box">
        <summary className="vb-head">
          <span className="vb-title">
            <Icon name="eye" size={16} />
            Who sees what
          </span>
          <span className="dim small">public · auditor · you</span>
        </summary>
        <dl className="summ">
          <div><dt>Before the close</dt><dd>everyone: ciphertext and your bond</dd></div>
          <div><dt>After the close</dt><dd>side and limit; one price for all</dd></div>
          <div><dt>Never public</dt><dd>your size and balances</dd></div>
        </dl>
      </details>
    </aside>
  );
}

/** The order just sealed, followed live until it settles. */
function OrderStatus({ done, onClear }: { done: SealResult; onClear: () => void }) {
  const w = useWallet();
  const now = useNow();
  const [k, setK] = useState(0);
  const [busy, setBusy] = useState<string>();
  const [err, setErr] = useState<string>();
  const t = useLive(
    async () => {
      const b = await getBatch(done.batchId);
      const rows = b.state >= 2 && w.address ? await myOrders(w.address, await w.selfKey(), [b]) : [];
      const row = rows.find((r) => r.tx === done.tx);
      const paid = row && row.order.status === 5 && w.address ? await payInOnChain(w.address, b.id) : undefined;
      return { b, row, paid };
    },
    [done.tx, w.address, k],
    3500,
  );
  const b = t.data?.b;
  const row = t.data?.row;
  const st = row?.order.status ?? 1;
  const left = Number(done.closeAt) - now;
  const leg = row ? payInLeg(row) : undefined;
  const steps = [
    { k: "Sealed in this browser", d: <>{done.bytes.toLocaleString()} B · <Hash v={done.tx} /></>, ok: true },
    { k: `Batch #${done.batchId} closes`, d: b && b.state >= 2 ? utc(b.closedAt) : left > 0 ? `in ${countdown(left)}` : "closing…", ok: !!b && b.state >= 2 },
    { k: `Validators open it`, d: b && b.state >= 2 ? `${b.revealedCount}/${b.orderCount} orders revealed` : `any ${done.threshold} of ${done.validators} sign at the close`, ok: !!b && b.state >= 2 && (b.revealedCount > 0 || b.state === 3) },
    {
      k: "One price",
      d: b?.state === 3 ? (b.price > 0n ? <>cleared at <b className="num">{units(b.price)}</b>{row?.fill ? <> · you {row.mine.side === BUY ? "bought" : "sold"} <b className="num">{units(row.fill.base)}</b></> : " · your limit did not cross"}</> : "no cross: bonds come back") : "after the reveal",
      ok: b?.state === 3,
    },
    {
      k: "Settled privately",
      d: st >= 6 ? (st === 7 ? "settled · bond back" : "settled by eERC transfer") : st === 5 ? (t.data?.paid ? "paid in · waiting for the agent" : "pay your leg in") : st === 4 ? "unfilled · claim the bond" : "after the clear",
      ok: st >= 6,
    },
  ];
  const at = steps.findIndex((s) => !s.ok);

  async function act(kind: "pay" | "bond") {
    if (!w.client || !w.address || !row) return;
    setBusy(kind);
    setErr(undefined);
    try {
      if (kind === "pay") await payIn(w.client, w.address, row);
      else await claimBond(w.client, row.batch.id, row.order.index);
      setK((x) => x + 1);
    } catch (e) {
      setErr((e as Error).message.split("\n")[0].slice(0, 200));
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <div className="ostatus" aria-live="polite" data-film="order-status">
      <div className="os-h">
        <span className="label">Your order · batch #{done.batchId.toString()}</span>
        <button className="link" onClick={onClear} aria-label="Hide this order's status">hide</button>
      </div>
      <ol className="tsteps">
        {steps.map((s, i) => (
          <li key={s.k} className={s.ok ? "done" : i === at ? "now" : ""}>
            <span className="step-dot" aria-hidden>{s.ok ? <Icon name="check" size={12} /> : i === at ? <i className="pulse" /> : ""}</span>
            <div>
              <b>{s.k}</b>
              <span>{s.d}</span>
            </div>
          </li>
        ))}
      </ol>
      {st === 5 && leg && !t.data?.paid && (
        <button className="btn btn-accent btn-block" disabled={!!busy} onClick={() => act("pay")} data-film="settle">
          {busy === "pay" ? (
            <>
              <i className="spin" aria-hidden /> Proving and sending…
            </>
          ) : (
            `Settle: pay ${units(leg.amount)} ${leg.sym} privately`
          )}
        </button>
      )}
      {(st === 4 || st === 6) && (
        <button className="btn btn-ghost btn-block btn-sm" disabled={!!busy} onClick={() => act("bond")}>
          {busy === "bond" ? "Claiming…" : "Claim the 0.10 OFEL bond"}
        </button>
      )}
      {t.data?.paid && st === 5 && <small className="dim">Pay-in <Hash v={t.data.paid} /> · the agent pays {row?.mine.side === BUY ? "tAVAX" : "tUSDC"} out next</small>}
      {(err || t.error) && <p className="sheet-err" role="alert">{err ?? t.error}</p>}
      {short(done.commitment) && <small className="dim mono">size commitment {short(done.commitment, 6)}</small>}
    </div>
  );
}
