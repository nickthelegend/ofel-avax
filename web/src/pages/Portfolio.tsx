// Your side of the desk: private balances (eERC, decrypted only in this browser), your orders decrypted with a key
// derived from your wallet signature, fills at each batch's one price, P&L marked at the last clear, and settlement.
import { useState } from "react";
import { BUY } from "@ofel/core";
import { cfg } from "../lib/config";
import { batchesWithOrders } from "../lib/chain";
import { eercFor, isRegistered, privateBalance } from "../lib/eerc";
import { useLive } from "../lib/hooks";
import { units } from "../lib/format";
import { myOrders, type MyRow } from "../lib/orders";
import { claimBond, payIn, payInLeg, payInOnChain } from "../lib/settle";
import { fix, ofelClears, priced, type Clear } from "../lib/market";
import { useWallet } from "../lib/wallet";
import { erc20Abi } from "viem";
import { client } from "../lib/chain";
import { Amount, BaseDisc, Hash, Icon, Link, Skel, State, StatusPill, UsdcDisc } from "../components/ui";

/** A test wallet signs locally, so its orders and balances decrypt without a prompt; a browser wallet asks first. */
function useAutoUnlock(): [boolean, () => void] {
  const w = useWallet();
  const [asked, setAsked] = useState(false);
  return [w.isTest || w.label?.includes("(QA)") || asked, () => setAsked(true)];
}

function ConnectState({ what }: { what: string }) {
  const w = useWallet();
  return (
    <State kind="setup" title={`Connect to see your ${what}`} action={cfg.faucet ? <button className="btn btn-primary btn-sm" onClick={() => w.connectTest()}>Start with a test wallet</button> : undefined}>
      They are encrypted on chain and decrypted only in your browser.
    </State>
  );
}

// ------------------------------------------------------------------ private balances
export function PrivateBalances({ lastClear }: { lastClear?: Clear }) {
  const w = useWallet();
  const [unlocked, unlock] = useAutoUnlock();
  const bal = useLive(
    async () => {
      if (!w.client || !w.address || !unlocked) return undefined;
      if (!(await isRegistered(w.address))) return { registered: false as const };
      const e = await eercFor(w.client);
      // Every market's base asset plus tUSDC. A token the eERC has not seen yet (no deposit so far) reads as zero.
      const assets = [...cfg.markets.map((m) => ({ id: m.id, sym: m.base, token: m.token, decimals: m.decimals })), { id: "USDC", sym: "tUSDC", token: cfg.tUSDC, decimals: 6 }];
      const rows = await Promise.all(
        assets.map(async (x) => {
          const [priv, pub] = await Promise.all([
            privateBalance(e, w.address!, x.token).catch(() => ({ decrypted: 0n, encrypted: [0n] })),
            client.readContract({ address: x.token, abi: erc20Abi, functionName: "balanceOf", args: [w.address!] }) as Promise<bigint>,
          ]);
          return { ...x, priv, pub };
        }),
      );
      return { registered: true as const, rows };
    },
    [w.address, unlocked],
    10000,
  );
  if (!w.address) return <ConnectState what="balances" />;
  if (!unlocked)
    return (
      <State kind="setup" art="key" title="Your balances are encrypted, even here" action={<button className="btn btn-primary btn-sm" onClick={unlock}>Decrypt in this browser</button>}>
        Decrypting asks your wallet for one signature.
      </State>
    );
  if (bal.error) return <State kind="error" title="Can't read the private balance">{bal.error}</State>;
  if (!bal.data)
    return (
      <div className="bal-grid">
        <Skel h={84} />
        <Skel h={84} />
      </div>
    );
  if (!bal.data.registered) return <State kind="setup" title="No private balance yet">Seal your first order: the ticket gets test funds and registers this wallet's eERC key.</State>;
  const cur = bal.data.rows.find((r) => r.id === cfg.market.id);
  const usdc = bal.data.rows.find((r) => r.id === "USDC");
  const value = lastClear && cur && usdc ? (Number(cur.priv.decrypted) / 100) * lastClear.price + Number(usdc.priv.decrypted) / 100 : null;
  const pubFmt = (v: bigint, d: number) => (Number(v) / 10 ** d).toLocaleString("en-US", { maximumFractionDigits: 2 });
  return (
    <div className="bal-grid bal-grid-n" data-film="balances">
      {bal.data.rows.map((r) => (
        <div className="bal" key={r.id}>
          {r.id === "USDC" ? <UsdcDisc size={34} /> : <BaseDisc id={r.id} size={34} />}
          <div>
            <span className="label">{r.sym} · private</span>
            <b><Amount v={r.priv.decrypted} /></b>
            <code className="dim">on chain: {r.priv.encrypted[0] ? `${r.priv.encrypted[0].toString(16).slice(0, 18)}…` : "no eERC balance yet"}</code>
            <small className="dim">public wallet: {pubFmt(r.pub, r.decimals)}</small>
          </div>
        </div>
      ))}
      <div className="bal bal-sum">
        <div>
          <span className="label">tUSDC + {cfg.base} at the last clear</span>
          <b className="num">{value != null ? `${fix(value)} tUSDC` : "—"}</b>
          <small className="dim">{lastClear ? `${cfg.base} at ${fix(lastClear.price)}, batch #${lastClear.batchId}` : "no clear yet"}</small>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ orders, fills, P&L
function SettleCell({ r, onDone }: { r: MyRow; onDone: () => void }) {
  const w = useWallet();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const sent = useLive(() => (w.address && r.order.status === 5 ? payInOnChain(w.address, r.batch.id) : Promise.resolve(undefined)), [w.address, r.order.status], 6000);
  const run = async (f: () => Promise<unknown>) => {
    setBusy(true);
    setErr(undefined);
    try {
      await f();
      onDone();
      sent.refresh();
    } catch (e) {
      setErr((e as Error).message.split("\n")[0].slice(0, 160));
    } finally {
      setBusy(false);
    }
  };
  if (r.order.status === 4 || r.order.status === 6)
    return (
      <span className="acts-in">
        <button className="btn btn-ghost btn-xs" disabled={busy} onClick={() => run(() => claimBond(w.client!, r.batch.id, r.order.index))}>
          {busy ? "Claiming…" : "Claim bond"}
        </button>
        {err && <small className="down">{err}</small>}
      </span>
    );
  if (r.order.status !== 5 || !r.fill) return <span className="dim small">—</span>;
  if (sent.data) return <span className="dim small">paid in <Hash v={sent.data} /></span>;
  const leg = payInLeg(r)!;
  return (
    <span className="acts-in">
      <button className="btn btn-accent btn-xs" disabled={busy} onClick={() => run(() => payIn(w.client!, w.address!, r))}>
        {busy ? "Proving…" : `Pay ${units(leg.amount)} ${leg.sym}`}
      </button>
      {err && <small className="down">{err}</small>}
    </span>
  );
}

function PnlSummary({ rows, mark }: { rows: MyRow[]; mark?: Clear }) {
  // Only fills on the market-priced book are marked; fills against the old fixed test quote would distort the P&L.
  const fills = rows.filter((r) => r.fill && priced({ batchId: r.batch.id }));
  const old = rows.filter((r) => r.fill && !priced({ batchId: r.batch.id })).length;
  const bought = fills.filter((r) => r.mine.side === BUY).reduce((s, r) => s + Number(r.fill!.base) / 100, 0);
  const sold = fills.filter((r) => r.mine.side !== BUY).reduce((s, r) => s + Number(r.fill!.base) / 100, 0);
  const pnl = mark ? fills.reduce((s, r) => s + (Number(r.fill!.base) / 100) * (r.mine.side === BUY ? mark.price - Number(r.batch.price) / 100 : Number(r.batch.price) / 100 - mark.price), 0) : null;
  const tone = pnl == null || Math.abs(pnl) < 0.005 ? "" : pnl > 0 ? "up" : "down";
  return (
    <div className="wl-sum" data-film="pnl">
      <div><span className="label">Orders</span><b className="num">{rows.length}</b></div>
      <div><span className="label">Filled</span><b className="num">{fills.length}</b></div>
      <div><span className="label">Bought</span><b className="num up">{fix(bought)}</b></div>
      <div><span className="label">Sold</span><b className="num down">{fix(sold)}</b></div>
      <div className="wl-net">
        <span className="label">P&amp;L at last clear</span>
        <b className={`num ${tone}`}>{pnl == null ? "—" : `${pnl > 0.005 ? "+" : pnl < -0.005 ? "−" : ""}${fix(Math.abs(pnl))} tUSDC`}</b>
      </div>
      {mark && <p className="form-note">Fills marked at batch #{mark.batchId.toString()}'s {fix(mark.price)} tUSDC. Sizes come from your own decrypted orders; the chain never shows them.{old ? ` ${old} fill${old === 1 ? "" : "s"} from before batch #${cfg.repricedFrom} (old fixed test quote) listed below but not marked.` : ""}</p>}
    </div>
  );
}

export function MyOrdersTable({ refreshKey = 0, lastClear }: { refreshKey?: number; lastClear?: Clear }) {
  const w = useWallet();
  const [unlocked, unlock] = useAutoUnlock();
  const [k, setK] = useState(0);
  const batches = useLive(() => batchesWithOrders(15), [refreshKey], 6000);
  const rows = useLive(
    async () => (w.address && batches.data && unlocked ? myOrders(w.address, await w.selfKey(), batches.data) : undefined),
    [w.address, unlocked, k, refreshKey, batches.data?.map((b) => `${b.id}:${b.state}:${b.revealedCount}`).join(",")],
    0,
  );
  const st = useLive(() => (lastClear ? Promise.resolve(lastClear) : ofelClears().then((c) => c.filter(priced).at(-1))), [lastClear?.batchId], 0);
  if (!w.address) return <ConnectState what="orders" />;
  if (!unlocked)
    return (
      <State kind="setup" art="key" title="Your orders are sealed, even here" action={<button className="btn btn-primary btn-sm" onClick={unlock}>Decrypt my orders</button>}>
        The key is derived from one wallet signature and stays in this browser.
      </State>
    );
  if (rows.error) return <State kind="error" title="Can't decrypt your orders">{rows.error}</State>;
  if (!rows.data)
    return (
      <div className="skels">
        <Skel h={40} />
        <Skel h={40} />
      </div>
    );
  if (!rows.data.length) return <State kind="empty" art="empty" title="No orders from this wallet yet">Seal one with the ticket; it shows up here, readable only by you.</State>;
  return (
    <>
      <PnlSummary rows={rows.data} mark={st.data} />
      <table className="tbl" data-film="my-orders">
        <thead>
          <tr>
            <th>Batch</th>
            <th>Side</th>
            <th>Size <i>{cfg.base}</i></th>
            <th className="hide-sm">Limit <i>tUSDC</i></th>
            <th>Fill</th>
            <th className="hide-sm">Notional <i>tUSDC</i></th>
            <th>Status</th>
            <th className="acts" />
          </tr>
        </thead>
        <tbody>
          {rows.data.map((r) => (
            <tr key={r.tx}>
              <td className="mono"><Link to={`/batches/${r.batch.id}`}>#{r.batch.id.toString()}</Link></td>
              <td><span className={`spill spill-${r.mine.side === BUY ? "up" : "down"}`}><Icon name={r.mine.side === BUY ? "up" : "down"} size={12} />{r.mine.side === BUY ? "Buy" : "Sell"}</span></td>
              <td className="mono">{units(r.mine.size)}</td>
              <td className="mono hide-sm">{units(r.mine.limit)}</td>
              <td className="mono">{r.fill ? <>{units(r.fill.base)} <small>@ {units(r.batch.price)}</small></> : <span className="dim">—</span>}</td>
              <td className="mono hide-sm">{r.fill ? units(r.fill.quote) : "—"}</td>
              <td><StatusPill s={r.order.status} /></td>
              <td className="acts"><SettleCell r={r} onDone={() => setK((x) => x + 1)} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

export function Portfolio() {
  const clears = useLive(ofelClears, [], 30000);
  const last = clears.data?.filter(priced).at(-1);
  return (
    <main className="order" id="main">
      <header className="board-head">
        <span className="kicker">Portfolio</span>
        <h1>Your book, readable only by you</h1>
        <p>Private balances and fills at each batch's one price. The chain shows a transfer, never the amount.</p>
      </header>
      <section className="order-sec">
        <h2>Private balances</h2>
        <div className="pnl pad">
          <PrivateBalances lastClear={last} />
        </div>
      </section>
      <section className="order-sec">
        <h2>Orders, fills and settlement</h2>
        <div className="pnl">
          <div className="tbl-wrap">
            <MyOrdersTable lastClear={last} />
          </div>
        </div>
      </section>
    </main>
  );
}
