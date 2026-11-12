import { useState } from "react";
import { BUY, SELL, type Side } from "@ofel/core";
import { cfg } from "../lib/config";
import { batchesWithOrders, getSealed, lastClearedBatch, recentBatches, sealedCountOf, validatorStatus, type Batch } from "../lib/chain";
import { useLive, useNow } from "../lib/hooks";
import { countdown, short, units, utc } from "../lib/format";
import { myOrders, parseUnits2, sealAndSubmit, sideLabel, tryOpenEarly, type EarlyAttempt, type SealResult } from "../lib/orders";
import { useWallet } from "../lib/wallet";
import { Amount, Empty, ErrorBox, Hash, Link, Skel } from "../components/ui";
import { SetupSteps, useSetupState } from "../components/Setup";

const PRESETS = ["100", "500", "1000", "2500"];
// Starting limits per side: a buyer's cap sits above the house ask and a seller's floor below the house bid.
const DEFAULT_LIMIT = { [BUY]: "31.50", [SELL]: "31.20" } as Record<Side, string>;

function Ticket({ batch, onSealed }: { batch?: Batch; onSealed: () => void }) {
  const w = useWallet();
  const now = useNow();
  const [side, setSide] = useState<Side>(BUY);
  const [size, setSize] = useState("1250");
  const [limit, setLimit] = useState(DEFAULT_LIMIT[BUY]);
  const setup = useSetupState();
  const pickSide = (x: Side) => {
    setSide(x);
    if (limit === DEFAULT_LIMIT[side]) setLimit(DEFAULT_LIMIT[x]);
  };
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const [done, setDone] = useState<SealResult>();
  const sizeU = parseUnits2(size);
  const limitU = parseUnits2(limit);
  const open = batch?.state === 1 && Number(batch.closeAt) > now + 2;
  const notional = sizeU && limitU ? (sizeU * limitU) / 100n : 0n;
  const needsSetup = !!w.address && !!setup.r.data && !setup.ready;
  const can = !!w.client && open && !needsSetup && !!sizeU && sizeU > 0n && !!limitU && limitU > 0n && !busy;

  async function submit() {
    if (!batch || !w.client || !sizeU || !limitU) return;
    setBusy(true);
    setErr(undefined);
    try {
      const k = await w.selfKey();
      setDone(await sealAndSubmit(w.client, k, batch, side, limitU, sizeU));
      onSealed();
    } catch (e) {
      setErr((e as Error).message.split("\n")[0].slice(0, 240));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="ticket" aria-label="Order ticket">
      <div className="between" style={{ marginBottom: 12 }}>
        <b style={{ fontSize: 16, letterSpacing: "-0.01em" }}>Block order</b>
        <span className="muted" style={{ fontSize: 13 }}>{batch ? `Batch #${batch.id}` : "No open batch"}</span>
      </div>
      <div className="seg" role="group" aria-label="Side">
        <button className="b" aria-pressed={side === BUY} onClick={() => pickSide(BUY)}>Buy tAVAX</button>
        <button className="s" aria-pressed={side === SELL} onClick={() => pickSide(SELL)}>Sell tAVAX</button>
      </div>
      <div className="field">
        <label htmlFor="size"><span>Size</span><span>tAVAX</span></label>
        <div className="input">
          <input id="size" inputMode="decimal" value={size} onChange={(e) => setSize(e.target.value)} aria-invalid={size !== "" && !sizeU} />
          <span className="unit">tAVAX</span>
        </div>
        <div className="chips">
          {PRESETS.map((p) => (
            <button key={p} className="chip" onClick={() => setSize(p)}>{Number(p).toLocaleString("en-US")}</button>
          ))}
        </div>
      </div>
      <div className="field">
        <label htmlFor="limit"><span>{side === BUY ? "Pay at most" : "Receive at least"}</span><span>tUSDC per tAVAX</span></label>
        <div className="input">
          <input id="limit" inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} aria-invalid={limit !== "" && !limitU} />
          <span className="unit">tUSDC</span>
        </div>
      </div>
      <div style={{ marginTop: 14 }}>
        <div className="kv"><span className="muted">Notional at limit</span><b className="num">{units(notional)} tUSDC</b></div>
        <div className="kv"><span className="muted">Bond (refunded)</span><b className="num">0.10 OFEL</b></div>
        <div className="kv"><span className="muted">Sealed until</span><b className="num">{batch ? utc(batch.closeAt) : "—"}</b></div>
      </div>
      {needsSetup ? (
        <div style={{ marginTop: 14 }}><SetupSteps state={setup} /></div>
      ) : (
        !w.client && cfg.faucet ? (
          <button className="btn ink block" onClick={() => w.connectTest()}>Start with a test wallet</button>
        ) : (
          <button className="btn ink block" disabled={!can} onClick={submit}>
            {busy ? "Sealing…" : !w.client ? "Connect to seal an order" : !open ? "Waiting for the next batch" : `Seal ${side === BUY ? "buy" : "sell"} order`}
          </button>
        )
      )}
      {err && <div style={{ marginTop: 12 }}><ErrorBox>{err}</ErrorBox></div>}
      {done && (
        <div className="sealed-box">
          <img src="/art/hero.webp" alt="Sealed order" width={72} height={72} />
          <div style={{ fontSize: 13.5 }}>
            <b>Sealed until {utc(done.closeAt)}</b>
            <div className="muted">
              {done.bytes.toLocaleString()} B of ciphertext in batch #{done.batchId.toString()}. Any {done.threshold} of {done.validators} validators open it after T.
            </div>
            <div className="mono" style={{ fontSize: 12.5 }}>{short(done.tx, 6)}</div>
          </div>
        </div>
      )}
      <div className="vis" aria-label="Who sees what">
        <div><span className="muted">Now</span><span>Everyone sees ciphertext and your bond.</span></div>
        <div><span className="muted">At close</span><span>Side and limit open; the price is set from them.</span></div>
        <div><span className="muted">Never</span><span><b>Your size.</b> Only you and the auditor read it.</span></div>
      </div>
    </section>
  );
}

function Book({ batch, refreshKey }: { batch?: Batch; refreshKey: number }) {
  const now = useNow();
  const sealed = useLive(() => (batch ? getSealed(batch.id) : Promise.resolve([])), [batch?.id, refreshKey], 4000);
  const [early, setEarly] = useState<EarlyAttempt>();
  const [trying, setTrying] = useState(false);
  const left = batch ? Number(batch.closeAt) - now : 0;
  const isOpen = batch?.state === 1 && left > 0;
  return (
    <section className="panel" aria-label="Sealed book">
      <div className="book-hero">
        <div>
          <div className="muted" style={{ fontSize: 14 }}>
            {batch ? (isOpen ? `Batch #${batch.id} closes in` : batch.state === 1 ? `Batch #${batch.id} is past T, closing` : `Batch #${batch.id}`) : "Waiting for the agent to open a batch"}
          </div>
          <div className="big num" style={{ margin: "8px 0 10px" }} aria-live="polite">
            {batch ? (isOpen ? countdown(left) : "00:00") : "—"}
          </div>
          <div className="muted" style={{ maxWidth: 460 }}>
            Every order is sealed until {batch ? utc(batch.closeAt) : "the close"}. Nobody can open the book early: not us, not any one validator.
          </div>
          <div className="row wrap" style={{ marginTop: 16 }}>
            <button
              className="btn sm"
              disabled={!batch || trying}
              onClick={async () => {
                if (!batch) return;
                setTrying(true);
                try {
                  setEarly(await tryOpenEarly(batch));
                } finally {
                  setTrying(false);
                }
              }}
            >
              {trying ? "Asking the chain…" : "Try to open it now"}
            </button>
            <Link to={batch ? `/batches/${batch.id}` : "/batches"} className="btn sm ghost">Batch details</Link>
          </div>
          {early && (
            <div className="note" style={{ marginTop: 12 }}>
              <div>closeBatch: <b className={early.contract.includes("TooEarly") ? "light" : ""}>{early.contract}</b></div>
              {early.validators.map((v) => (
                <div key={v.nodeID} className="row" style={{ gap: 8 }}>
                  <span className={v.refused ? "dot wait" : "dot"} />
                  <span className="mono">{short(v.nodeID, 5)}</span>
                  <span className="muted">{v.result}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <img className="eclipse float" src="/art/eclipse.webp" alt="" width={240} height={240} />
      </div>
      <div className="panel-h" style={{ borderTop: "1px solid var(--line)" }}>
        <h3>What the chain shows for batch {batch ? `#${batch.id}` : ""}</h3>
        <span className="muted" style={{ fontSize: 13 }}>{sealed.data?.length ?? 0} sealed</span>
      </div>
      {sealed.error && <div className="panel-b"><ErrorBox>{sealed.error}</ErrorBox></div>}
      {!sealed.data && !sealed.error && <div className="panel-b stack"><Skel /><Skel w="70%" /></div>}
      {sealed.data && sealed.data.length === 0 && <Empty title="No sealed orders yet">The first order in this batch shows up here as ciphertext.</Empty>}
      {sealed.data && sealed.data.length > 0 && (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>#</th><th>Trader</th><th>Ciphertext</th><th className="r">Status</th></tr></thead>
            <tbody>
              {sealed.data.map((s) => (
                <tr key={s.tx}>
                  <td className="num">{s.index}</td>
                  <td><Hash v={s.trader} /></td>
                  <td><span className="cipher">{s.envelope.slice(194, 194 + 56)}…</span> <span className="faint">{((s.envelope.length - 2) / 2).toLocaleString()} B</span></td>
                  <td className="r"><span className="pill sealed">Sealed</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Mine({ batches, refreshKey }: { batches?: Batch[]; refreshKey: number }) {
  const w = useWallet();
  const [unlock, setUnlock] = useState(0);
  const count = useLive(async () => (w.address ? sealedCountOf(w.address) : undefined), [w.address, refreshKey], 0);
  const rows = useLive(
    async () => (w.address && batches && unlock > 0 ? myOrders(w.address, await w.selfKey(), batches) : undefined),
    [w.address, batches?.map((b) => `${b.id}:${b.state}:${b.orderCount}`).join(","), refreshKey, unlock],
    0,
  );
  if (!w.address) return <Empty art="key" title="Connect to see your orders">Your orders are decrypted in this browser with a key derived from your wallet signature.</Empty>;
  if (count.data === 0) return <Empty title="No orders from this wallet yet">Seal one with the ticket.</Empty>;
  if (unlock === 0)
    return (
      <Empty art="key" title={count.data ? `${count.data} sealed order${count.data === 1 ? "" : "s"} from this wallet` : "Your orders are sealed, even here"}>
        <button className="btn sm primary" style={{ marginTop: 8 }} onClick={() => setUnlock(1)}>Decrypt my orders</button>
      </Empty>
    );
  if (rows.error) return <div className="panel-b"><ErrorBox>{rows.error}</ErrorBox></div>;
  if (!rows.data) return <div className="panel-b stack"><Skel /><Skel w="60%" /></div>;
  if (!rows.data.length) return <Empty title="No orders from this wallet yet">Seal one with the ticket.</Empty>;
  return (
    <div className="tbl-wrap">
      <table className="tbl">
        <thead><tr><th>Batch</th><th>Side</th><th className="r">Size</th><th className="r">Limit</th><th className="r">Fill</th><th className="r">Status</th></tr></thead>
        <tbody>
          {rows.data.map((r) => (
            <tr key={r.tx}>
              <td>#{r.batch.id.toString()}</td>
              <td className={r.mine.side === BUY ? "buy" : "sell"}>{sideLabel(r.mine.side)}</td>
              <td className="r num">{units(r.mine.size)}</td>
              <td className="r num">{units(r.mine.limit)}</td>
              <td className="r num">{r.fill ? <>{units(r.fill.base)} @ {units(r.batch.price)}</> : <span className="faint">—</span>}</td>
              <td className="r"><StatusPill s={r.order.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function StatusPill({ s }: { s: number }) {
  const label = ["None", "Sealed", "Revealed", "Void", "Unfilled", "Filled", "Settled", "Bond back"][s] ?? "?";
  const cls = s === 1 ? "pill sealed" : s === 5 || s === 6 || s === 7 ? "pill ok" : s === 3 ? "pill bad" : "pill";
  return <span className={cls}>{label}</span>;
}

export function Desk() {
  const batches = useLive(() => recentBatches(12), [], 3000);
  const vals = useLive(validatorStatus, [], 6000);
  const [refreshKey, setRefreshKey] = useState(0);
  const withOrders = useLive(() => batchesWithOrders(10), [batches.data?.[0]?.id, batches.data?.[0]?.orderCount, batches.data?.[0]?.state, refreshKey], 0);
  const [tab, setTab] = useState<"mine" | "batches">("mine");
  const current = batches.data?.[0];
  const lastClear = useLive(() => lastClearedBatch(), [batches.data?.[0]?.id, batches.data?.[0]?.state], 0).data;
  const online = vals.data?.filter((v) => v.online).length;

  return (
    <div className="page">
      <div className="strip" aria-label="Market">
        <div>
          <img src="/art/coins.webp" alt="" width={36} height={36} />
          <div>
            <div className="pair">tAVAX / tUSDC</div>
            <div className="muted" style={{ fontSize: 12.5 }}>Sealed batch auction</div>
          </div>
        </div>
        <div><div className="k">Batch</div><div className="v num">{current ? `#${current.id} · ${["", "Open", "Closed", "Cleared"][current.state]}` : batches.error ? "—" : "…"}</div></div>
        <div><div className="k">Closes at</div><div className="v num">{current ? utc(current.closeAt) : "—"}</div></div>
        <div><div className="k">Last clearing price</div><div className="v num">{lastClear ? `${units(lastClear.price)} tUSDC` : "No clear yet"}</div></div>
        <div><div className="k">Last batch volume</div><div className="v num">{lastClear ? `${units(lastClear.buyTotal < lastClear.sellTotal ? lastClear.buyTotal : lastClear.sellTotal)} tAVAX` : "—"}</div></div>
        <div><div className="k">Validators</div><div className="v num">{online !== undefined ? `${online}/${vals.data!.length} online · any ${cfg.threshold}` : vals.error ? "P-Chain unreachable" : "…"}</div></div>
      </div>
      {batches.error && <div style={{ marginBottom: 16 }}><ErrorBox>Can't reach the Ofel L1 at {cfg.rpc}: {batches.error}</ErrorBox></div>}
      <div className="grid-desk">
        <Ticket batch={current} onSealed={() => setRefreshKey((k) => k + 1)} />
        <div className="stack">
          <Book batch={current} refreshKey={refreshKey} />
          <section className="panel">
            <div className="panel-h">
              <div className="tabs" role="group" aria-label="Lists">
                <button aria-pressed={tab === "mine"} onClick={() => setTab("mine")}>Your orders</button>
                <button aria-pressed={tab === "batches"} onClick={() => setTab("batches")}>Recent clears</button>
              </div>
              <Link to="/portfolio" className="btn sm ghost">Portfolio</Link>
            </div>
            {tab === "mine" ? (
              <Mine batches={withOrders.data} refreshKey={refreshKey} />
            ) : (
              <RecentClears batches={withOrders.data} />
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function RecentClears({ batches }: { batches?: Batch[] }) {
  const cleared = batches?.filter((b) => b.state === 3) ?? [];
  if (!batches) return <div className="panel-b stack"><Skel /><Skel /></div>;
  if (!cleared.length) return <Empty art="eclipse" title="No batch has cleared yet" />;
  return (
    <div className="tbl-wrap">
      <table className="tbl">
        <thead><tr><th>Batch</th><th className="r">Price</th><th className="r">Buy total</th><th className="r">Sell total</th><th className="r">Orders</th><th className="r">Cleared</th></tr></thead>
        <tbody>
          {cleared.map((b) => (
            <tr key={b.id.toString()}>
              <td><Link to={`/batches/${b.id}`}>#{b.id.toString()}</Link></td>
              <td className="r num">{b.price > 0n ? <Amount v={b.price} /> : <span className="faint">no cross</span>}</td>
              <td className="r num">{units(b.buyTotal)}</td>
              <td className="r num">{units(b.sellTotal)}</td>
              <td className="r num">{b.orderCount}</td>
              <td className="r num muted">{utc(b.clearedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
