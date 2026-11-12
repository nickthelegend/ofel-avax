// Batches: the list, and one batch in full (Eidolon's round page shape): the timeline, what the chain stores for every
// order, the proven totals and each validator's unsealing signature, verified in this browser against the P-Chain.
import { useState } from "react";
import { BUY } from "@ofel/core";
import { bytesToHex } from "warplock";
import { cfg } from "../lib/config";
import { batchesWithOrders, checkSignatures, client, getBatch, getOrders, getSealed, recentBatches, validatorStatus } from "../lib/chain";
import { useLive, useNow } from "../lib/hooks";
import { ago, countdown, short, units, utc } from "../lib/format";
import { BatchState, Hash, Icon, Link, Skel, State, StatusPill, go } from "../components/ui";
import { Timeline } from "./Desk";

const ZERO = "0x0000000000000000000000000000000000000000000000000000000000000000";

function List() {
  const now = useNow();
  const batches = useLive(async () => {
    const [head] = await recentBatches(1);
    const withOrders = await batchesWithOrders(20);
    return head && head.id !== withOrders[0]?.id ? [head, ...withOrders] : withOrders;
  }, [], 4000);
  return (
    <main className="order board" id="main">
      <header className="board-head">
        <span className="kicker">Batches</span>
        <h1>Sealed until the close, one price each</h1>
        <p>The open batch and every batch that took orders, newest first. Empty batches are skipped.</p>
      </header>
      <section className="pnl" data-film="batches-page">
        {batches.error && <State kind="error" title="Can't reach the Ofel L1">{batches.error}</State>}
        {!batches.data && !batches.error && (
          <div className="skels">
            <Skel h={40} />
            <Skel h={40} />
            <Skel h={40} />
          </div>
        )}
        {batches.data?.length === 0 && <State kind="empty" art="eclipse" title="No batches yet">The clearing agent opens the first one.</State>}
        {!!batches.data?.length && (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Batch</th>
                  <th>State</th>
                  <th>Orders</th>
                  <th className="hide-sm">Revealed</th>
                  <th>Price <i>tUSDC</i></th>
                  <th className="hide-sm">Matched <i>tAVAX</i></th>
                  <th className="hide-sm">Close</th>
                  <th className="acts" />
                </tr>
              </thead>
              <tbody>
                {batches.data.map((b) => {
                  const left = Number(b.closeAt) - now;
                  return (
                    <tr key={b.id.toString()} className="clickable" onClick={() => go(`/batches/${b.id}`)}>
                      <td className="mono">
                        <Link to={`/batches/${b.id}`}>#{b.id.toString()}</Link>
                      </td>
                      <td><BatchState state={b.state} price={b.price} /></td>
                      <td className="mono">{b.orderCount}</td>
                      <td className="mono hide-sm">{b.state >= 2 ? `${b.revealedCount}/${b.orderCount}` : "sealed"}</td>
                      <td className="mono">{b.state === 3 && b.price > 0n ? <b>{units(b.price)}</b> : <span className="dim">—</span>}</td>
                      <td className="mono hide-sm">{b.state === 3 && b.price > 0n ? units(b.buyTotal < b.sellTotal ? b.buyTotal : b.sellTotal) : "—"}</td>
                      <td className="mono hide-sm">{utc(b.closeAt).slice(0, 8)}<small>{b.state === 1 && left > 0 ? `in ${countdown(left)}` : ago(b.closeAt, now)}</small></td>
                      <td className="acts"><Icon name="arrow" size={14} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

function Detail({ id }: { id: bigint }) {
  const now = useNow();
  const b = useLive(() => getBatch(id), [id], 3000);
  const orders = useLive(() => getOrders(id), [id, b.data?.state, b.data?.revealedCount, b.data?.orderCount], 0);
  const sealed = useLive(() => getSealed(id), [id, b.data?.orderCount], 0);
  const [sigs, setSigs] = useState<Awaited<ReturnType<typeof checkSignatures>>>();
  const [busy, setBusy] = useState(false);
  const [sigErr, setSigErr] = useState<string>();
  const [rawOpen, setRawOpen] = useState<string>();
  const raw = useLive(async () => (rawOpen ? (await client.getTransaction({ hash: rawOpen as `0x${string}` })).input : undefined), [rawOpen], 0);

  if (b.error)
    return (
      <main className="order" id="main">
        <State kind="error" title="Can't reach the Ofel L1">{b.error}</State>
      </main>
    );
  if (!b.data)
    return (
      <main className="order" id="main">
        <div className="skels">
          <Skel h={180} />
          <Skel h={120} />
        </div>
      </main>
    );
  const x = b.data;
  if (x.state === 0)
    return (
      <main className="order" id="main">
        <State kind="empty" art="empty" title={`Batch #${id} does not exist`} action={<Link to="/batches" className="btn btn-primary btn-sm">All batches</Link>} />
      </main>
    );
  const left = Number(x.closeAt) - now;
  const matched = x.buyTotal < x.sellTotal ? x.buyTotal : x.sellTotal;
  const okSigs = sigs?.checks.filter((c) => c.ok).length ?? 0;
  return (
    <main className="order" id="main">
      <Link to="/batches" className="back">
        <Icon name="back" size={16} /> Batches
      </Link>
      <div className="order-hero">
        <section className="pnl osum">
          <header>
            <img className="osum-art" src={x.state === 3 ? "/art/opened.webp" : "/art/hero.webp"} alt="" aria-hidden width={56} height={56} />
            <div>
              <span className="label">Ofel L1 · tAVAX / tUSDC</span>
              <h1>Batch #{x.id.toString()}</h1>
            </div>
            <BatchState state={x.state} price={x.price} />
          </header>
          <dl className="osum-grid">
            <div><dt>Sealed until</dt><dd className="num">{utc(x.closeAt)}</dd></div>
            <div><dt>Orders</dt><dd className="num">{x.orderCount}</dd></div>
            <div><dt>Closed (Warp)</dt><dd className="num">{x.state >= 2 ? utc(x.closedAt) : "—"}</dd></div>
            <div><dt>Revealed</dt><dd className="num">{x.state >= 2 ? `${x.revealedCount}/${x.orderCount}` : "sealed"}</dd></div>
            <div><dt>Cleared</dt><dd className="num">{x.state === 3 ? utc(x.clearedAt) : "—"}</dd></div>
            <div><dt>Warp message</dt><dd>{x.closeMessageId !== ZERO ? <Hash v={x.closeMessageId} /> : "—"}</dd></div>
          </dl>
        </section>
        <section className="verdict dark" data-film="verdict">
          <span className="label">{x.state === 1 ? (left > 0 ? `Seals in ${countdown(left)}` : "Past its close") : x.state === 2 ? "Closed · opening" : `Cleared ${ago(x.clearedAt, now)}`}</span>
          <p className="verdict-big">{x.state === 3 ? (x.price > 0n ? `${units(x.price)} tUSDC` : "No cross") : x.state === 2 ? "Opening" : "Sealed"}</p>
          <div className="cross">
            <div>
              <span>Buy total</span>
              <b className="num">{x.state === 3 ? units(x.buyTotal) : "sealed"}</b>
            </div>
            <i>·</i>
            <div>
              <span>Sell total</span>
              <b className="num gold">{x.state === 3 ? units(x.sellTotal) : "sealed"}</b>
            </div>
          </div>
          <p className="verdict-note">
            {x.state === 3
              ? x.price > 0n
                ? `${units(matched)} tAVAX crossed at one price. Totals are proven on chain: Σ commitments = total·G + blind·H. No single size is ever shown.`
                : "Buyers' and sellers' limits did not cross; every bond comes back."
              : "Nobody can read these orders yet, not even the auditor."}
          </p>
        </section>
      </div>

      <section className="pnl pad">
        <Timeline b={x} now={now} big />
      </section>

      <section className="order-sec">
        <h2>
          Orders as the chain stores them <small className="dim">sizes stay commitments</small>
        </h2>
        <div className="pnl">
          {orders.error && <State kind="error" title="Can't read the orders">{orders.error}</State>}
          {orders.data?.length === 0 && <State kind="empty" art="empty" title="No orders in this batch" />}
          {!!orders.data?.length && (
            <div className="tbl-wrap">
              <table className="tbl" data-film="batch-orders">
                <thead>
                  <tr>
                    <th className="hide-sm">#</th>
                    <th>Trader</th>
                    <th>Side</th>
                    <th>Limit</th>
                    <th>Size</th>
                    <th className="hide-sm">Input</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.data.map((o) => {
                    const tx = sealed.data?.find((s) => s.index === o.index)?.tx;
                    return (
                      <tr key={o.index}>
                        <td className="mono hide-sm">{o.index}</td>
                        <td><Hash v={o.trader} /></td>
                        <td>{o.side ? <span className={`spill spill-${o.side === BUY ? "up" : "down"}`}><Icon name={o.side === BUY ? "up" : "down"} size={12} />{o.side === BUY ? "Buy" : "Sell"}</span> : <span className="dim">sealed</span>}</td>
                        <td className="mono">{o.side ? units(o.limit) : <span className="dim">sealed</span>}</td>
                        <td><code className="ci-hex" title={`C = (${o.cx}, ${o.cy})`}>C {short("0x" + o.cx.toString(16), 4)}</code></td>
                        <td className="hide-sm">{tx ? <button className="btn btn-ghost btn-xs" onClick={() => setRawOpen(rawOpen === tx ? undefined : tx)}>{rawOpen === tx ? "Hide" : "Raw input"}</button> : "—"}</td>
                        <td><StatusPill s={o.status} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {rawOpen && (
            <div className="rawbox">
              <div className="sec-h">
                <b>Transaction input, exactly as any explorer shows it</b>
                <Hash v={rawOpen} n={6} />
              </div>
              <code className="ci-hex raw">{raw.data ?? "loading…"}</code>
            </div>
          )}
        </div>
      </section>

      <section className="order-sec">
        <h2>Unsealing signatures</h2>
        <div className="pnl pad sigbox">
          <p className="dim small">Each validator's BLS signature on this batch's close message, checked here against its key on the P-Chain. Any {cfg.threshold} open every order.</p>
          <button
            className="btn btn-primary btn-sm"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setSigErr(undefined);
              try {
                setSigs(await checkSignatures(x, await validatorStatus()));
              } catch (e) {
                setSigErr((e as Error).message.split("\n")[0]);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Asking validators…" : sigs ? "Check again" : "Fetch and verify signatures"}
          </button>
          {sigErr && <p className="sheet-err">{sigErr}</p>}
          {sigs && (
            <ol className="steps" data-film="signatures">
              {sigs.checks.map((c) => (
                <li key={c.nodeID} className={c.ok ? "" : "bad"}>
                  <span className="step-dot" aria-hidden>{c.ok ? <Icon name="check" size={12} /> : "!"}</span>
                  <div>
                    <p><code>{short(c.nodeID, 6)}</code> <b>{c.ok ? "signed" : "no signature"}</b></p>
                    <span>{c.detail}{c.signature ? ` · ${bytesToHex(c.signature).slice(0, 34)}…` : ""}</span>
                  </div>
                </li>
              ))}
              <li className={okSigs >= cfg.threshold ? "" : "bad"}>
                <span className="step-dot" aria-hidden>{okSigs >= cfg.threshold ? <Icon name="unlock" size={12} /> : <Icon name="lock" size={12} />}</span>
                <div>
                  <p><b>{okSigs} of {sigs.checks.length} valid · {okSigs >= cfg.threshold ? "the batch opens" : `needs ${cfg.threshold}`}</b></p>
                  <span>Message {short(sigs.messageIdHex, 6)}</span>
                </div>
              </li>
            </ol>
          )}
        </div>
      </section>
    </main>
  );
}

export function Batches({ path }: { path: string }) {
  const m = path.match(/^\/batches\/(\d+)/);
  return m ? <Detail id={BigInt(m[1])} /> : <List />;
}
