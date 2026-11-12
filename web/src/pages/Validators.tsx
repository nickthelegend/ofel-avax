import { cfg } from "../lib/config";
import { validatorStatus } from "../lib/chain";
import { useLive } from "../lib/hooks";
import { short } from "../lib/format";
import { Empty, ErrorBox, Hash, Skel } from "../components/ui";

export function Validators() {
  const vs = useLive(validatorStatus, [], 4000);
  const online = vs.data?.filter((v) => v.online).length ?? 0;
  const total = vs.data?.length ?? 0;
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Validators</h1>
          <p>The Ofel L1's own validator set, read live from the P-Chain. Their BLS keys are the timelock: any {cfg.threshold} of them signing a batch's close message opens it.</p>
        </div>
      </div>
      <section className="panel" style={{ marginBottom: 16, overflow: "hidden" }}>
        <div className="book-hero">
          <div>
            <div className="muted">Online now</div>
            <div className="big num" style={{ margin: "6px 0 12px" }}>
              {vs.data ? online : "—"}
              <span className="dec"> / {vs.data ? total : "—"}</span>
            </div>
            <div className="row wrap" style={{ gap: 8 }}>
              <span className={vs.data && online >= cfg.threshold ? "pill ok" : "pill bad"}>
                {vs.data ? (online >= cfg.threshold ? `Batches can open (needs ${cfg.threshold})` : `Below threshold: batches wait`) : "Checking"}
              </span>
              <span className="pill">Consensus k=3, α=2</span>
              <span className="pill">Subnet {short(cfg.subnetID, 5)}</span>
            </div>
          </div>
          <img className="eclipse float" style={{ width: 200, height: 200 }} src="/art/validators.webp" alt="" width={200} height={200} />
        </div>
      </section>
      <section className="panel">
        <div className="panel-h"><h3>Validator set</h3><span className="muted" style={{ fontSize: 13 }}>platform.getCurrentValidators · {short(cfg.pchain, 12)}</span></div>
        {vs.error && <div className="panel-b"><ErrorBox>P-Chain unreachable: {vs.error}</ErrorBox></div>}
        {!vs.data && !vs.error && <div className="panel-b stack"><Skel /><Skel /><Skel /></div>}
        {vs.data?.length === 0 && <Empty title="No validators returned for this L1" />}
        {!!vs.data?.length && (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Node</th><th>BLS public key (G1)</th><th className="r">Weight</th><th>Endpoint</th><th className="r">Status</th></tr></thead>
              <tbody>
                {vs.data.map((v) => (
                  <tr key={v.nodeID}>
                    <td><Hash v={v.nodeID} n={6} /></td>
                    <td><Hash v={v.publicKey} n={8} /></td>
                    <td className="r num">{v.weight?.toString() ?? "—"}</td>
                    <td className="mono muted" style={{ fontSize: 13 }}>{v.uri ?? "—"}</td>
                    <td className="r">{v.online ? <span className="pill ok"><span className="dot" />Online</span> : <span className="pill bad"><span className="dot off" />Offline</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="panel-b muted" style={{ borderTop: "1px solid var(--line)", fontSize: 13.5 }}>
          Collusion of {cfg.threshold} or more validators could sign a close message early off-chain. That is the trust assumption, the same one the L1's own consensus makes. Production sets would be independent operators.
        </div>
      </section>
    </div>
  );
}
