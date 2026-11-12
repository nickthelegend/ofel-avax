import { useState } from "react";
import { BUY } from "@ofel/core";
import { bytesToHex } from "warplock";
import { cfg } from "../lib/config";
import { batchesWithOrders, checkSignatures, client, getBatch, getOrders, getSealed, recentBatches, validatorStatus, type Batch } from "../lib/chain";
import { useLive, useNow } from "../lib/hooks";
import { ago, countdown, short, units, utc } from "../lib/format";
import { Amount, Empty, ErrorBox, Hash, Link, Skel } from "../components/ui";
import { StatusPill } from "./Desk";

function Steps({ b, now }: { b: Batch; now: number }) {
  const closed = b.state >= 2;
  const revealed = b.state >= 2 && b.revealedCount > 0;
  const cleared = b.state === 3;
  const items = [
    { k: "Sealing", t: b.state === 1 ? (Number(b.closeAt) > now ? `closes in ${countdown(Number(b.closeAt) - now)}` : "past T") : `${b.orderCount} orders`, done: true },
    { k: "Warp message", t: closed ? utc(b.closedAt) : `not before ${utc(b.closeAt)}`, done: closed },
    { k: "Opened", t: closed ? `${b.revealedCount}/${b.orderCount} revealed` : "sealed", done: revealed || (closed && b.orderCount === 0) },
    { k: "Cleared", t: cleared ? (b.price > 0n ? `at ${units(b.price)}` : "no cross") : "pending", done: cleared },
    { k: "Settled", t: cleared ? "eERC legs" : "pending", done: cleared },
  ];
  const nowIdx = items.findIndex((i) => !i.done);
  return (
    <div className="steps">
      {items.map((s, i) => (
        <div key={s.k} className={`step ${s.done ? "done" : i === nowIdx ? "now" : ""}`}>
          <b>{s.k}</b>
          <span className="t">{s.t}</span>
        </div>
      ))}
    </div>
  );
}

function List() {
  const now = useNow();
  const batches = useLive(async () => {
    const [head] = await recentBatches(1);
    const withOrders = await batchesWithOrders(20);
    return head && head.id !== withOrders[0]?.id ? [head, ...withOrders] : withOrders;
  }, [], 4000);
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Batches</h1>
          <p>The open batch, then every batch that received orders. Each batch seals until its close time, then the L1's validators sign it open. One price per batch, set on chain from the revealed limits.</p>
        </div>
      </div>
      <section className="panel">
        {batches.error && <div className="panel-b"><ErrorBox>{batches.error}</ErrorBox></div>}
        {!batches.data && !batches.error && <div className="panel-b stack"><Skel /><Skel /><Skel /></div>}
        {batches.data?.length === 0 && <Empty art="eclipse" title="No batches yet">The clearing agent opens the first one.</Empty>}
        {batches.data?.map((b) => (
          <Link key={b.id.toString()} to={`/batches/${b.id}`} className="batch-row">
            <div>
              <div style={{ fontSize: 18, fontWeight: 500 }}>#{b.id.toString()}</div>
              <div className="muted" style={{ fontSize: 13 }}>{utc(b.closeAt)}</div>
            </div>
            <Steps b={b} now={now} />
            <div>
              <div className="muted" style={{ fontSize: 12.5 }}>Clearing price</div>
              <div className="num" style={{ fontSize: 17 }}>{b.state === 3 ? (b.price > 0n ? <Amount v={b.price} unit="tUSDC" /> : "No cross") : "—"}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div className="muted" style={{ fontSize: 12.5 }}>Orders</div>
              <div className="num" style={{ fontSize: 17 }}>{b.orderCount}</div>
            </div>
          </Link>
        ))}
      </section>
    </div>
  );
}

function Detail({ id }: { id: bigint }) {
  const now = useNow();
  const b = useLive(() => getBatch(id), [id], 3000);
  const orders = useLive(() => getOrders(id), [id, b.data?.state, b.data?.revealedCount], 0);
  const sealed = useLive(() => getSealed(id), [id, b.data?.orderCount], 0);
  const [sigs, setSigs] = useState<Awaited<ReturnType<typeof checkSignatures>>>();
  const [busy, setBusy] = useState(false);
  const [rawOpen, setRawOpen] = useState<string>();
  const raw = useLive(async () => (rawOpen ? (await client.getTransaction({ hash: rawOpen as `0x${string}` })).input : undefined), [rawOpen], 0);

  if (b.error) return <div className="page"><ErrorBox>{b.error}</ErrorBox></div>;
  if (!b.data) return <div className="page stack"><Skel /><Skel /></div>;
  const x = b.data;
  if (x.state === 0) return <div className="page"><Empty title={`Batch #${id} does not exist`}><Link to="/batches">All batches</Link></Empty></div>;
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <Link to="/batches" className="muted">← Batches</Link>
          <h1 style={{ marginTop: 6 }}>Batch #{x.id.toString()}</h1>
          <p>Sealed until {utc(x.closeAt)}. {x.state === 3 ? `Cleared ${ago(x.clearedAt, now)}.` : x.state === 2 ? "Closed; waiting for the reveal and the clear." : "Accepting sealed orders."}</p>
        </div>
        {x.state === 3 && x.price > 0n && (
          <div style={{ textAlign: "right" }}>
            <div className="muted">One price for every fill</div>
            <Amount v={x.price} unit="tUSDC" big />
          </div>
        )}
      </div>
      <section className="panel panel-b" style={{ marginBottom: 16 }}><Steps b={x} now={now} /></section>

      <div className="grid-desk" style={{ gridTemplateColumns: "minmax(0,1fr) 420px" }}>
        <section className="panel">
          <div className="panel-h"><h3>Orders as the chain stores them</h3><span className="muted" style={{ fontSize: 13 }}>Sizes are Pedersen commitments</span></div>
          {orders.error && <div className="panel-b"><ErrorBox>{orders.error}</ErrorBox></div>}
          {orders.data?.length === 0 && <Empty title="No orders in this batch" />}
          {!!orders.data?.length && (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr><th>#</th><th>Trader</th><th>Side</th><th className="r">Limit</th><th>Size</th><th>Tx</th><th className="r">Status</th></tr></thead>
                <tbody>
                  {orders.data.map((o) => {
                    const tx = sealed.data?.find((s) => s.index === o.index)?.tx;
                    return (
                      <tr key={o.index}>
                        <td className="num">{o.index}</td>
                        <td><Hash v={o.trader} /></td>
                        <td className={o.side === BUY ? "buy" : o.side ? "sell" : "faint"}>{o.side ? (o.side === BUY ? "Buy" : "Sell") : "sealed"}</td>
                        <td className="r num">{o.side ? units(o.limit) : <span className="faint">sealed</span>}</td>
                        <td><span className="cipher" title={`C = (${o.cx}, ${o.cy})`}>C {short("0x" + o.cx.toString(16), 4)}</span></td>
                        <td>{tx ? <button className="btn sm ghost" onClick={() => setRawOpen(rawOpen === tx ? undefined : tx)}>{rawOpen === tx ? "Hide input" : "Raw input"}</button> : "—"}</td>
                        <td className="r"><StatusPill s={o.status} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {rawOpen && (
            <div className="panel-b" style={{ borderTop: "1px solid var(--line)" }}>
              <div className="between" style={{ marginBottom: 8 }}>
                <b style={{ fontWeight: 500 }}>Transaction input, exactly as any explorer shows it</b>
                <Hash v={rawOpen} n={6} />
              </div>
              <div className="cipher" style={{ maxHeight: 180, overflow: "auto" }}>{raw.data ?? "loading…"}</div>
            </div>
          )}
          {x.state === 3 && (
            <div className="panel-b" style={{ borderTop: "1px solid var(--line)" }}>
              <div className="row wrap" style={{ gap: 28 }}>
                <div><div className="muted" style={{ fontSize: 12.5 }}>Buy total (proven)</div><Amount v={x.buyTotal} unit="tAVAX" /></div>
                <div><div className="muted" style={{ fontSize: 12.5 }}>Sell total (proven)</div><Amount v={x.sellTotal} unit="tAVAX" /></div>
                <div><div className="muted" style={{ fontSize: 12.5 }}>Matched</div><Amount v={x.buyTotal < x.sellTotal ? x.buyTotal : x.sellTotal} unit="tAVAX" /></div>
              </div>
              <p className="muted" style={{ margin: "12px 0 0", fontSize: 13.5 }}>
                The contract checked Σ commitments = total·G + blind·H on BN254 for each side. Totals are public; no single order's size ever is.
              </p>
            </div>
          )}
        </section>

        <section className="panel">
          <div className="panel-h"><h3>Unsealing signatures</h3><img src="/art/key.webp" alt="" width={32} height={32} /></div>
          <div className="panel-b stack">
            <div className="kv" style={{ borderTop: 0 }}><span className="muted">Warp message ID</span><Hash v={x.closeMessageId !== "0x0000000000000000000000000000000000000000000000000000000000000000" ? x.closeMessageId : undefined} n={6} /></div>
            <div className="muted" style={{ fontSize: 13.5 }}>
              Ask each validator of the L1 for its BLS signature on this batch's close message, then verify it here against the key the P-Chain records for that validator. Any {cfg.threshold} valid signatures open every order.
            </div>
            <button
              className="btn"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  setSigs(await checkSignatures(x, await validatorStatus()));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "Asking validators…" : "Fetch and verify signatures"}
            </button>
            {sigs && (
              <div className="stack" style={{ gap: 8 }}>
                <div className="kv"><span className="muted">Predicted message</span><Hash v={sigs.messageIdHex} n={6} /></div>
                {sigs.checks.map((c) => (
                  <div key={c.nodeID} className="row" style={{ alignItems: "flex-start" }}>
                    <span className={c.ok ? "dot" : c.detail === "offline" ? "dot off" : "dot wait"} style={{ marginTop: 7 }} />
                    <div style={{ minWidth: 0 }}>
                      <div className="mono" style={{ fontSize: 13 }}>{short(c.nodeID, 6)}</div>
                      <div className="muted" style={{ fontSize: 13 }}>{c.detail}</div>
                      {c.signature && <div className="cipher">{bytesToHex(c.signature).slice(0, 42)}…</div>}
                    </div>
                  </div>
                ))}
                <div className={sigs.checks.filter((c) => c.ok).length >= cfg.threshold ? "pill ok" : "pill sealed"} style={{ justifySelf: "start" }}>
                  {sigs.checks.filter((c) => c.ok).length} of {sigs.checks.length} valid · {sigs.checks.filter((c) => c.ok).length >= cfg.threshold ? "batch opens" : `needs ${cfg.threshold}`}
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

export function Batches({ path }: { path: string }) {
  const m = path.match(/^\/batches\/(\d+)/);
  return m ? <Detail id={BigInt(m[1])} /> : <List />;
}
