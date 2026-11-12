import { useState } from "react";
import { BUY } from "@ofel/core";
import { parseAbiItem, type Hex } from "viem";
import { cfg } from "../lib/config";
import { batchesWithOrders, bookAbi, client } from "../lib/chain";
import { eercFor, isRegistered, privateBalance, privateTransfer } from "../lib/eerc";
import { useLive } from "../lib/hooks";
import { units } from "../lib/format";
import { myOrders, sideLabel, type MyRow } from "../lib/orders";
import { useWallet } from "../lib/wallet";
import { Amount, Empty, ErrorBox, Hash, Skel } from "../components/ui";
import { StatusPill } from "./Desk";

const clearedEvent = parseAbiItem("event BatchCleared(uint256 indexed batchId, uint64 price, uint64 buyTotal, uint64 sellTotal, uint32 filled)");
const transferEvent = parseAbiItem("event PrivateTransfer(address indexed from, address indexed to, uint256[7] auditorPCT, address indexed auditorAddress)");

async function payInOnChain(me: Hex, batchId: bigint): Promise<Hex | undefined> {
  const [c] = await client.getLogs({ address: cfg.book, event: clearedEvent, args: { batchId }, fromBlock: 0n, toBlock: "latest" });
  if (!c) return undefined;
  const ts = await client.getLogs({ address: cfg.eerc, event: transferEvent, args: { from: me, to: cfg.agent }, fromBlock: c.blockNumber, toBlock: "latest" });
  return ts[0]?.transactionHash;
}

function Balances() {
  const w = useWallet();
  const [go, setGo] = useState(0);
  const bal = useLive(
    async () => {
      if (!w.client || !w.address || !go) return undefined;
      if (!(await isRegistered(w.address))) return { registered: false as const };
      const e = await eercFor(w.client);
      const [a, u] = await Promise.all([privateBalance(e, w.address, cfg.tAVAX), privateBalance(e, w.address, cfg.tUSDC)]);
      return { registered: true as const, a: a.decrypted, u: u.decrypted };
    },
    [w.address, go],
    8000,
  );
  return (
    <section className="panel" style={{ overflow: "hidden" }}>
      <div className="book-hero">
        <div>
          <div className="muted">Private balances · eERC on the Ofel L1</div>
          {!w.address && <p className="muted">Connect a wallet to read your encrypted balances.</p>}
          {w.address && !go && (
            <>
              <p className="muted" style={{ maxWidth: 520 }}>On chain these are ElGamal ciphertexts. Your browser decrypts them with a key derived from your wallet signature; nobody else can, except the auditor.</p>
              <button className="btn primary" onClick={() => setGo(1)}>Decrypt my balances</button>
            </>
          )}
          {bal.error && <ErrorBox>{bal.error}</ErrorBox>}
          {go > 0 && !bal.data && !bal.error && <div className="stack" style={{ marginTop: 12 }}><Skel w="60%" /><Skel w="40%" /></div>}
          {bal.data && !bal.data.registered && <div className="note" style={{ marginTop: 12 }}>This wallet is not registered with the eERC yet, so it holds no private balance.</div>}
          {bal.data?.registered && (
            <div className="row wrap" style={{ gap: 40, marginTop: 12 }}>
              <div><Amount v={bal.data.a} unit="tAVAX" big /></div>
              <div><Amount v={bal.data.u} unit="tUSDC" big /></div>
            </div>
          )}
        </div>
        <img className="eclipse float" style={{ width: 180, height: 180 }} src="/art/coins.webp" alt="" width={180} height={180} />
      </div>
    </section>
  );
}

function SettleCell({ r, onDone }: { r: MyRow; onDone: () => void }) {
  const w = useWallet();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const sent = useLive(() => (w.address && r.order.status === 5 ? payInOnChain(w.address, r.batch.id) : Promise.resolve(undefined)), [w.address, r.order.status], 5000);
  if (r.order.status === 4 || r.order.status === 6) {
    return (
      <button
        className="btn sm"
        disabled={busy}
        onClick={async () => {
          if (!w.client?.account) return;
          setBusy(true);
          setErr(undefined);
          try {
            const h = await w.client.writeContract({ address: cfg.book, abi: bookAbi, functionName: "claimBond", args: [r.batch.id, r.order.index], account: w.client.account, chain: undefined });
            await client.waitForTransactionReceipt({ hash: h });
            onDone();
          } catch (e) {
            setErr((e as Error).message.split("\n")[0].slice(0, 160));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Claiming…" : "Claim bond"}
      </button>
    );
  }
  if (r.order.status !== 5 || !r.fill) return <span className="faint">—</span>;
  if (sent.data) return <span className="muted" style={{ fontSize: 13 }}>Paid in <Hash v={sent.data} />, waiting for the agent</span>;
  const token = r.mine.side === BUY ? cfg.tUSDC : cfg.tAVAX;
  const amount = r.mine.side === BUY ? r.fill.quote : r.fill.base;
  return (
    <div style={{ display: "grid", gap: 6, justifyItems: "end" }}>
      <button
        className="btn sm primary"
        disabled={busy}
        onClick={async () => {
          if (!w.client?.account || !w.address) return;
          setBusy(true);
          setErr(undefined);
          try {
            const e = await eercFor(w.client);
            await privateTransfer(e, w.address, cfg.agent, token, amount, `ofel:${r.batch.id}:${r.order.index}:in`);
            sent.refresh();
          } catch (e) {
            setErr((e as Error).message.split("\n")[0].slice(0, 200));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Proving and sending…" : `Pay ${units(amount)} ${r.mine.side === BUY ? "tUSDC" : "tAVAX"} privately`}
      </button>
      {err && <span className="sell" style={{ fontSize: 12.5, maxWidth: 260 }}>{err}</span>}
    </div>
  );
}

function Orders() {
  const w = useWallet();
  const [go, setGo] = useState(0);
  const [k, setK] = useState(0);
  const batches = useLive(() => batchesWithOrders(15), [], 5000);
  const rows = useLive(
    async () => (w.address && batches.data && go ? myOrders(w.address, await w.selfKey(), batches.data) : undefined),
    [w.address, go, k, batches.data?.map((b) => `${b.id}:${b.state}:${b.revealedCount}`).join(",")],
    6000,
  );
  return (
    <section className="panel">
      <div className="panel-h"><h3>Fills and settlement</h3><span className="muted" style={{ fontSize: 13 }}>Decrypted only in this browser</span></div>
      {!w.address && <Empty art="key" title="Connect to see your fills" />}
      {w.address && !go && <Empty art="key" title="Your orders are sealed, even here"><button className="btn sm primary" style={{ marginTop: 8 }} onClick={() => setGo(1)}>Decrypt my orders</button></Empty>}
      {rows.error && <div className="panel-b"><ErrorBox>{rows.error}</ErrorBox></div>}
      {go > 0 && !rows.data && !rows.error && <div className="panel-b stack"><Skel /><Skel /></div>}
      {rows.data?.length === 0 && <Empty title="No orders from this wallet yet" />}
      {!!rows.data?.length && (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Batch</th><th>Side</th><th className="r">Size</th><th className="r">Limit</th><th className="r">Filled</th><th className="r">Price</th><th className="r">Notional</th><th className="r">Status</th><th className="r">Action</th></tr></thead>
            <tbody>
              {rows.data.map((r) => (
                <tr key={r.tx}>
                  <td>#{r.batch.id.toString()}</td>
                  <td className={r.mine.side === BUY ? "buy" : "sell"}>{sideLabel(r.mine.side)}</td>
                  <td className="r num">{units(r.mine.size)}</td>
                  <td className="r num">{units(r.mine.limit)}</td>
                  <td className="r num">{r.fill ? units(r.fill.base) : <span className="faint">—</span>}</td>
                  <td className="r num">{r.fill ? units(r.batch.price) : <span className="faint">—</span>}</td>
                  <td className="r num">{r.fill ? units(r.fill.quote) : <span className="faint">—</span>}</td>
                  <td className="r"><StatusPill s={r.order.status} /></td>
                  <td className="r"><SettleCell r={r} onDone={() => setK((x) => x + 1)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function Portfolio() {
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Portfolio</h1>
          <p>Your fills, at the batch's one price. Settlement legs are private eERC transfers: the chain records that a transfer happened, never how much.</p>
        </div>
      </div>
      <div className="stack">
        <Balances />
        <Orders />
      </div>
    </div>
  );
}
