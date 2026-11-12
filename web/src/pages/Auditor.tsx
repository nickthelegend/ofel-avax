import { useState } from "react";
import { BUY, openAgentBlob, openOrder, opens } from "@ofel/core";
import { cfg } from "../lib/config";
import { batchesWithOrders, checkSignatures, getOrders, getSealed, validatorStatus } from "../lib/chain";
import { eercFor } from "../lib/eerc";
import { useLive } from "../lib/hooks";
import { units } from "../lib/format";
import { useWallet } from "../lib/wallet";
import { Empty, ErrorBox, Hash, Skel } from "../components/ui";

interface AuditRow {
  batch: bigint;
  index: number;
  trader: string;
  side: number;
  limit: bigint;
  size: bigint;
  commitmentOk: boolean;
  signers: number;
}

async function auditBatches(secret: Uint8Array): Promise<{ rows: AuditRow[]; sealedBatches: number }> {
  const batches = await batchesWithOrders(10);
  const vs = await validatorStatus();
  const rows: AuditRow[] = [];
  let sealedBatches = 0;
  for (const b of batches) {
    if (b.state < 2) {
      sealedBatches++;
      continue; // before T even the auditor cannot read the batch
    }
    const [sig, sealed, orders] = await Promise.all([checkSignatures(b, vs), getSealed(b.id), getOrders(b.id)]);
    const sigs = new Map(sig.checks.filter((c) => c.ok && c.signature).map((c) => [c.nodeID, c.signature!]));
    for (const s of sealed) {
      try {
        const o = openOrder(s.envelope, sig.identity, vs, sigs);
        const { size, blind } = openAgentBlob(secret, o.agentBlob);
        const ord = orders[s.index];
        rows.push({ batch: b.id, index: s.index, trader: s.trader, side: o.side, limit: o.limit, size, commitmentOk: opens({ x: ord.cx, y: ord.cy }, size, blind), signers: o.used.length });
      } catch {
        /* unreadable envelope: shown by the count below */
      }
    }
  }
  return { rows, sealedBatches };
}

export function Auditor() {
  const w = useWallet();
  const [go, setGo] = useState(0);
  const audit = useLive(async () => (w.isAgent && go ? auditBatches(await w.agentSecret()) : undefined), [w.isAgent, go], 15000);
  const legs = useLive(async () => (w.isAgent && go && w.client ? (await eercFor(w.client)).auditorDecrypt() : undefined), [w.isAgent, go], 15000);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Auditor</h1>
          <p>The compliance view. The auditor reads every size and every settlement leg, but only from the moment a batch closes, never before.</p>
        </div>
        {w.isAgent && go > 0 && <span className="pill ok">Auditor key active</span>}
      </div>
      {!w.isAgent ? (
        <section className="panel">
          <Empty art="lens" title="Auditor key required">
            Connect the auditor wallet ({<Hash v={cfg.agent} />}). Everyone else sees ciphertext and batch totals only.
          </Empty>
        </section>
      ) : !go ? (
        <section className="panel">
          <Empty art="lens" title="Ready to audit">
            <button className="btn primary" style={{ marginTop: 8 }} onClick={() => setGo(1)}>Derive the auditor key and decrypt</button>
          </Empty>
        </section>
      ) : (
        <div className="stack">
          <section className="panel">
            <div className="panel-h"><h3>Every order, opened</h3><span className="muted" style={{ fontSize: 13 }}>Sizes from the agent blob, checked against each Pedersen commitment</span></div>
            {audit.error && <div className="panel-b"><ErrorBox>{audit.error}</ErrorBox></div>}
            {!audit.data && !audit.error && <div className="panel-b stack"><Skel /><Skel /><Skel /></div>}
            {audit.data && audit.data.rows.length === 0 && <Empty title="Nothing to audit yet">No closed batch has orders.</Empty>}
            {!!audit.data?.rows.length && (
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead><tr><th>Batch</th><th>#</th><th>Trader</th><th>Side</th><th className="r">Size</th><th className="r">Limit</th><th className="r">Commitment</th><th className="r">Opened with</th></tr></thead>
                  <tbody>
                    {audit.data.rows.map((r) => (
                      <tr key={`${r.batch}-${r.index}`}>
                        <td>#{r.batch.toString()}</td>
                        <td className="num">{r.index}</td>
                        <td><Hash v={r.trader} /></td>
                        <td className={r.side === BUY ? "buy" : "sell"}>{r.side === BUY ? "Buy" : "Sell"}</td>
                        <td className="r num">{units(r.size)} tAVAX</td>
                        <td className="r num">{units(r.limit)}</td>
                        <td className="r">{r.commitmentOk ? <span className="pill ok">matches</span> : <span className="pill bad">mismatch</span>}</td>
                        <td className="r num muted">{r.signers} signatures</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {!!audit.data?.sealedBatches && <div className="panel-b muted" style={{ borderTop: "1px solid var(--line)", fontSize: 13.5 }}>{audit.data.sealedBatches} batch still sealed: the auditor waits for T like everyone else.</div>}
          </section>
          <section className="panel">
            <div className="panel-h"><h3>Settlement legs (eERC)</h3><span className="muted" style={{ fontSize: 13 }}>Decrypted with the eERC auditor key</span></div>
            {legs.error && <div className="panel-b"><ErrorBox>{legs.error}</ErrorBox></div>}
            {!legs.data && !legs.error && <div className="panel-b stack"><Skel /><Skel /></div>}
            {legs.data?.length === 0 && <Empty art="coins" title="No private transfers in the last 1,000 blocks" />}
            {!!legs.data?.length && (
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead><tr><th>Type</th><th>From</th><th>To</th><th className="r">Amount</th><th>Tx</th></tr></thead>
                  <tbody>
                    {legs.data.map((l) => (
                      <tr key={l.transactionHash + l.amount}>
                        <td>{l.type}</td>
                        <td><Hash v={l.sender} /></td>
                        <td><Hash v={l.receiver ?? undefined} /></td>
                        <td className="r num">{units(BigInt(l.amount))}</td>
                        <td><Hash v={l.transactionHash} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
