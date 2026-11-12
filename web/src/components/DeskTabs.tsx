// The desk's bottom tables: your orders (with P&L), the tape of recent clears, batches, private balances, auditor.
import { useEffect, useState, type ReactNode } from "react";
import type { Batch } from "../lib/chain";
import { cfg } from "../lib/config";
import { useNow } from "../lib/hooks";
import { ago, countdown, units, utc } from "../lib/format";
import { fix, type Clear } from "../lib/market";
import { useWallet } from "../lib/wallet";
import { MyOrdersTable, PrivateBalances } from "../pages/Portfolio";
import { AuditView } from "../pages/Auditor";
import { BatchState, Icon, Link, Skel, State, go } from "./ui";

type Tab = "orders" | "clears" | "batches" | "balances" | "auditor";
const TABS: Tab[] = ["orders", "clears", "batches", "balances", "auditor"];
const fromHash = (): Tab => {
  const h = window.location.hash.replace("#", "") as Tab;
  return TABS.includes(h) ? h : "orders";
};

export function DeskTabs({ batches, clears, clearsErr, lastClear, refreshKey }: { batches?: Batch[]; clears?: Clear[]; clearsErr?: string; lastClear?: Clear; refreshKey: number }) {
  const w = useWallet();
  const [tab, setTab] = useState<Tab>(fromHash);
  useEffect(() => {
    const on = () => setTab(fromHash());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const pick = (t: Tab) => {
    window.history.replaceState(null, "", `${window.location.pathname}#${t}`);
    setTab(t);
  };
  const crossed = clears?.length;
  const tabs: [Tab, string, ReactNode][] = [
    ["orders", "Your orders", null],
    ["clears", "Recent clears", crossed ?? null],
    ["batches", "Batches", batches ? batches.length : null],
    ["balances", "Private balances", null],
    ["auditor", "Auditor", null],
  ];
  return (
    <section className="pnl bottom" aria-label="Orders, clears, batches, balances and auditor" data-film="tabs">
      <header className="pnl-tabs btabs" role="tablist">
        {tabs.map(([k, l, n]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={`pnl-tab ${tab === k ? "on" : ""}`} onClick={() => pick(k)} data-film={`tab-${k}`}>
            {l}
            {n != null && <small>{n}</small>}
          </button>
        ))}
        <span className="pnl-note">{w.address ? `${w.label ?? "Wallet"}` : "Not connected"}</span>
      </header>
      <div className="tbl-wrap">
        {tab === "orders" && <MyOrdersTable refreshKey={refreshKey} lastClear={lastClear} />}
        {tab === "clears" && <Tape clears={clears} err={clearsErr} />}
        {tab === "batches" && <BatchList batches={batches} />}
        {tab === "balances" && <div className="pad"><PrivateBalances lastClear={lastClear} /></div>}
        {tab === "auditor" && <AuditView />}
      </div>
    </section>
  );
}

function Tape({ clears, err }: { clears?: Clear[]; err?: string }) {
  const [all, setAll] = useState(false);
  if (err) return <State kind="error" title="Can't read the clears">{err}</State>;
  if (!clears)
    return (
      <div className="skels">
        <Skel h={36} />
        <Skel h={36} />
      </div>
    );
  if (!clears.length) return <State kind="empty" art="scale" title="No batch has crossed at market prices yet">The house follows Chainlink from batch #{cfg.repricedFrom.toString()}; the first clear from then on lands here. Older clears are in the Batches tab.</State>;
  const rows = [...clears].reverse();
  return (
    <>
      <table className="tbl" data-film="tape">
        <thead>
          <tr>
            <th>Cleared</th>
            <th>Batch</th>
            <th>Price <i>tUSDC</i></th>
            <th>Matched <i>tAVAX</i></th>
            <th className="hide-sm">Buy total</th>
            <th className="hide-sm">Sell total</th>
            <th>Fills</th>
            <th className="hide-sm">Single sizes</th>
          </tr>
        </thead>
        <tbody>
          {(all ? rows : rows.slice(0, 8)).map((c, i) => {
            const prev = rows[i + 1];
            const dir = prev ? (c.price > prev.price ? "up" : c.price < prev.price ? "down" : "") : "";
            return (
              <tr key={c.batchId.toString()} className="clickable" onClick={() => go(`/batches/${c.batchId}`)}>
                <td className="mono">{utc(c.ts).slice(0, 8)}<small>{ago(c.ts)}</small></td>
                <td className="mono"><Link to={`/batches/${c.batchId}`}>#{c.batchId.toString()}</Link></td>
                <td className={`mono ${dir}`}><b>{fix(c.price)}</b></td>
                <td className="mono">{units(c.buyTotal < c.sellTotal ? c.buyTotal : c.sellTotal)}</td>
                <td className="mono hide-sm">{units(c.buyTotal)}</td>
                <td className="mono hide-sm">{units(c.sellTotal)}</td>
                <td className="mono">{c.filled}</td>
                <td className="hide-sm"><span className="st st-live"><i />never public</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length > 8 && (
        <button className="btn btn-ghost btn-xs more" onClick={() => setAll((a) => !a)}>
          {all ? "Show fewer" : `Show all ${rows.length} clears`}
        </button>
      )}
      <p className="form-note pad-x">After the close each order's side and limit open on chain; sizes stay commitments. Only the batch totals are proven and public. Clears from batch #{cfg.repricedFrom.toString()} on, when the house started quoting around Chainlink; earlier ones are in the Batches tab.</p>
    </>
  );
}

function BatchList({ batches }: { batches?: Batch[] }) {
  const now = useNow();
  if (!batches)
    return (
      <div className="skels">
        <Skel h={36} />
        <Skel h={36} />
      </div>
    );
  if (!batches.length) return <State kind="empty" art="eclipse" title="No batches yet">The clearing agent opens the first one.</State>;
  return (
    <table className="tbl" data-film="batches">
      <thead>
        <tr>
          <th>Batch</th>
          <th>State</th>
          <th>Orders</th>
          <th className="hide-sm">Revealed</th>
          <th>Price <i>tUSDC</i></th>
          <th className="hide-sm">Closes</th>
          <th className="acts" />
        </tr>
      </thead>
      <tbody>
        {batches.map((b) => {
          const left = Number(b.closeAt) - now;
          return (
            <tr key={b.id.toString()} className="clickable" onClick={() => go(`/batches/${b.id}`)}>
              <td className="mono">#{b.id.toString()}</td>
              <td><BatchState state={b.state} price={b.price} /></td>
              <td className="mono">{b.orderCount}</td>
              <td className="mono hide-sm">{b.state >= 2 ? `${b.revealedCount}/${b.orderCount}` : "sealed"}</td>
              <td className="mono">{b.state === 3 && b.price > 0n ? units(b.price) : <span className="dim">—</span>}</td>
              <td className="mono hide-sm">{utc(b.closeAt).slice(0, 8)}<small>{b.state === 1 && left > 0 ? `in ${countdown(left)}` : ago(b.closeAt, now)}</small></td>
              <td className="acts"><Icon name="arrow" size={14} /></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
