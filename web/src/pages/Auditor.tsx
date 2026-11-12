import { useState } from "react";
import { BUY, openAgentBlob, openOrder, opens } from "@ofel/core";
import { cfg } from "../lib/config";
import { getAddress, type Hex } from "viem";
import { batchesWithOrders, checkSignatures, client, eercAbi, getOrders, getSealed, validatorStatus } from "../lib/chain";
import { auditorLegs, eercFor } from "../lib/eerc";
import { useLive } from "../lib/hooks";
import { units } from "../lib/format";
import { useWallet } from "../lib/wallet";
import { Hash, Icon, Skel, State } from "../components/ui";

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

/** The compliance view, live: every order opened with the validators' signatures and checked against its commitment,
 * and every eERC settlement leg decrypted with the auditor key. */
export function AuditView() {
  const w = useWallet();
  const [go, setGo] = useState(0);
  const audit = useLive(async () => (w.isAgent && go ? auditBatches(await w.agentSecret()) : undefined), [w.isAgent, go], 15000);
  const legs = useLive(async () => {
    if (!(w.isAgent && go && w.client)) return undefined;
    const rows = await auditorLegs(await eercFor(w.client), w.address!);
    const assets = await legAssets([...new Set(rows.map((r) => r.transactionHash))]).catch(() => new Map<string, string>());
    return rows.map((r) => ({ ...r, asset: assets.get(r.transactionHash) }));
  }, [w.isAgent, go], 15000);

  if (!w.isAgent)
    return (
      <State kind="setup" art="lens" title="Auditor key required">
        Only the auditor wallet (<Hash v={cfg.agent} />) can open sizes and settlement legs, and only after a batch closes. Everyone else sees ciphertext and batch totals.
      </State>
    );
  if (!go)
    return (
      <State kind="setup" art="lens" title="Ready to audit" action={<button className="btn btn-primary btn-sm" onClick={() => setGo(1)}>Derive the auditor key and decrypt</button>}>
        Opens every closed batch with the validators' signatures, then checks each size against its commitment.
      </State>
    );
  return (
    <div className="audit">
      <div className="sec-h"><b>Every order, opened</b><span className="dim small">each size checked against its Pedersen commitment</span></div>
      {audit.error && <State kind="error" title="Audit failed">{audit.error}</State>}
      {!audit.data && !audit.error && <div className="skels"><Skel h={36} /><Skel h={36} /></div>}
      {audit.data && audit.data.rows.length === 0 && <State kind="empty" title="Nothing to audit yet">No closed batch has orders.</State>}
      {!!audit.data?.rows.length && (
        <table className="tbl" data-film="audit-orders">
          <thead><tr><th>Batch</th><th className="hide-sm">#</th><th>Trader</th><th>Side</th><th>Size <i>tAVAX</i></th><th>Limit</th><th>Commitment</th><th className="hide-sm">Opened with</th></tr></thead>
          <tbody>
            {audit.data.rows.map((r) => (
              <tr key={`${r.batch}-${r.index}`}>
                <td className="mono">#{r.batch.toString()}</td>
                <td className="mono hide-sm">{r.index}</td>
                <td><Hash v={r.trader} /></td>
                <td><span className={`spill spill-${r.side === BUY ? "up" : "down"}`}><Icon name={r.side === BUY ? "up" : "down"} size={12} />{r.side === BUY ? "Buy" : "Sell"}</span></td>
                <td className="mono">{units(r.size)}</td>
                <td className="mono">{units(r.limit)}</td>
                <td>{r.commitmentOk ? <span className="st st-won"><i />matches</span> : <span className="st st-lost"><i />mismatch</span>}</td>
                <td className="mono hide-sm dim">{r.signers} signatures</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {!!audit.data?.sealedBatches && <p className="form-note pad-x">{audit.data.sealedBatches} batch still sealed: the auditor waits for the close like everyone else.</p>}
      <div className="sec-h"><b>Settlement legs (eERC)</b><span className="dim small">decrypted with the eERC auditor key</span></div>
      {legs.error && <State kind="error" title="Can't decrypt the legs">{legs.error}</State>}
      {!legs.data && !legs.error && <div className="skels"><Skel h={36} /></div>}
      {legs.data?.length === 0 && <State kind="empty" title="No private transfers in the last 1,000 blocks" />}
      {!!legs.data?.length && (
        <table className="tbl" data-film="audit-legs">
          <thead><tr><th className="hide-sm">Type</th><th>From</th><th>To</th><th>Amount</th><th className="hide-sm">Tx</th></tr></thead>
          <tbody>
            {legs.data.map((l) => (
              <tr key={l.transactionHash + l.amount}>
                <td className="hide-sm">{l.type}</td>
                <td><Hash v={cs(l.sender)} /></td>
                <td><Hash v={cs(l.receiver)} /></td>
                <td className="mono">{units(BigInt(l.amount))} <small>{l.asset}</small></td>
                <td className="hide-sm"><Hash v={l.transactionHash} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function Auditor() {
  const w = useWallet();
  return (
    <main className="order" id="main">
      <header className="board-head">
        <span className="kicker">Auditor</span>
        <h1>Every size and every leg, after the close</h1>
        <p>The compliance view. One key reads what the public never sees, and even it waits for the batch to close.</p>
        {w.isAgent && <span className="st st-won"><i />Auditor wallet connected</span>}
      </header>
      <section className="pnl" data-film="auditor">
        <div className="tbl-wrap">
          <AuditView />
        </div>
      </section>
    </main>
  );
}
