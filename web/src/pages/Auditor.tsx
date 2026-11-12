import { useState } from "react";
import { BUY, openAgentBlob, openOrder, opens } from "@ofel/core";
import { cfg } from "../lib/config";
import { getAddress, type Hex } from "viem";
import { batchesWithOrders, checkSignatures, client, eercAbi, getOrders, getSealed, validatorStatus } from "../lib/chain";
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

/** The asset of each eERC leg: transfer(to, tokenId, …) carries the token ID as its second word, and the eERC maps it
 * to the ERC-20 it wraps. */
async function legAssets(hashes: Hex[]): Promise<Map<string, string>> {
  const ids = new Map<bigint, string>();
  const out = new Map<string, string>();
  await Promise.all(
    hashes.map(async (h) => {
      const tx = await client.getTransaction({ hash: h });
      const id = BigInt("0x" + tx.input.slice(2 + 8 + 64, 2 + 8 + 128));
      if (!ids.has(id)) {
        const token = (await client.readContract({ address: cfg.eerc, abi: eercAbi, functionName: "tokenAddresses", args: [id] })) as Hex;
        ids.set(id, token.toLowerCase() === cfg.tAVAX.toLowerCase() ? "tAVAX" : token.toLowerCase() === cfg.tUSDC.toLowerCase() ? "tUSDC" : `token ${id}`);
      }
      out.set(h, ids.get(id)!);
    }),
  );
  return out;
}

const cs = (a?: string | null) => (a ? getAddress(a) : undefined);

export function Auditor() {
  const w = useWallet();
  const [go, setGo] = useState(0);
  const audit = useLive(async () => (w.isAgent && go ? auditBatches(await w.agentSecret()) : undefined), [w.isAgent, go], 15000);
  const legs = useLive(async () => {
    if (!(w.isAgent && go && w.client)) return undefined;
    const rows = await (await eercFor(w.client)).auditorDecrypt();
    const assets = await legAssets([...new Set(rows.map((r) => r.transactionHash))]).catch(() => new Map<string, string>());
    return rows.map((r) => ({ ...r, asset: assets.get(r.transactionHash) }));
  }, [w.isAgent, go], 15000);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Auditor</h1>
          <p>The compliance view: every size and every settlement leg, readable only once a batch closes.</p>
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
            <div className="panel-h"><h3>Every order, opened</h3><span className="muted" style={{ fontSize: 13 }}>Each size checked against its Pedersen commitment</span></div>
            {audit.error && <div className="panel-b"><ErrorBox>{audit.error}</ErrorBox></div>}
            {!audit.data && !audit.error && <div className="panel-b stack"><Skel /><Skel /><Skel /></div>}
            {audit.data && audit.data.rows.length === 0 && <Empty title="Nothing to audit yet">No closed batch has orders.</Empty>}
            {!!audit.data?.rows.length && (
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead><tr><th>Batch</th><th className="hide-sm">#</th><th>Trader</th><th>Side</th><th className="r">Size</th><th className="r">Limit</th><th className="r">Commitment</th><th className="r hide-sm">Opened with</th></tr></thead>
                  <tbody>
                    {audit.data.rows.map((r) => (
                      <tr key={`${r.batch}-${r.index}`}>
                        <td>#{r.batch.toString()}</td>
                        <td className="num hide-sm">{r.index}</td>
                        <td><Hash v={r.trader} /></td>
                        <td className={r.side === BUY ? "buy" : "sell"}>{r.side === BUY ? "Buy" : "Sell"}</td>
                        <td className="r num">{units(r.size)} tAVAX</td>
                        <td className="r num">{units(r.limit)}</td>
                        <td className="r">{r.commitmentOk ? <span className="pill ok">matches</span> : <span className="pill bad">mismatch</span>}</td>
                        <td className="r num muted hide-sm">{r.signers} signatures</td>
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
                  <thead><tr><th className="hide-sm">Type</th><th>From</th><th>To</th><th className="r">Amount</th><th className="hide-sm">Tx</th></tr></thead>
                  <tbody>
                    {legs.data.map((l) => (
                      <tr key={l.transactionHash + l.amount}>
                        <td className="hide-sm">{l.type}</td>
                        <td><Hash v={cs(l.sender)} /></td>
                        <td><Hash v={cs(l.receiver)} /></td>
                        <td className="r num">{units(BigInt(l.amount))}{l.asset && <span className="dec" style={{ marginLeft: 5 }}>{l.asset}</span>}</td>
                        <td className="hide-sm"><Hash v={l.transactionHash} /></td>
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
