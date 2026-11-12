import { cfg } from "../lib/config";
import { validatorBalances, validatorStatus } from "../lib/chain";
import { useLive } from "../lib/hooks";
import { short } from "../lib/format";
import { Empty, ErrorBox, Hash, Skel } from "../components/ui";

export function Validators() {
  const vs = useLive(validatorStatus, [], 4000);
  const bal = useLive(() => (cfg.fuji ? validatorBalances() : Promise.resolve([])), [], 60000);
  const balOf = (nodeID: string) => bal.data?.find((b) => b.nodeID === nodeID);
  const online = vs.data?.filter((v) => v.online).length ?? 0;
  const total = vs.data?.length ?? 0;
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Validators</h1>
          <p>The Ofel L1's own validators, live from the P-Chain. Any {cfg.threshold} of their signatures open a batch.</p>
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
              {cfg.fuji ? (
                <a className="pill" href={cfg.l1Page} target="_blank" rel="noreferrer">L1 {short(cfg.subnetID, 5)} ↗</a>
              ) : (
                <span className="pill">Subnet {short(cfg.subnetID, 5)}</span>
              )}
              {cfg.conversionTx && <a className="pill" href={cfg.pTx(cfg.conversionTx)} target="_blank" rel="noreferrer">ConvertSubnetToL1 ↗</a>}
            </div>
          </div>
          <img className="eclipse float art-sm" style={{ width: 200, height: 200 }} src="/art/validators.webp" alt="" width={200} height={200} />
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
              <thead><tr><th>Node</th><th className="hide-sm">BLS public key (G1)</th><th className="r hide-sm">Weight</th>{cfg.fuji && <th className="r">P-Chain balance</th>}<th className="hide-sm">Endpoint</th><th className="r">Status</th></tr></thead>
              <tbody>
                {vs.data.map((v) => (
                  <tr key={v.nodeID}>
                    <td><Hash v={v.nodeID} n={6} /></td>
                    <td className="hide-sm"><Hash v={v.publicKey} n={8} /></td>
                    <td className="r num hide-sm">{v.weight?.toString() ?? "—"}</td>
                    {cfg.fuji && (
                      <td className="r num" title="Validator fee: 512 nAVAX per second">
                        {balOf(v.nodeID) ? (
                          <>
                            {(Number(balOf(v.nodeID)!.balance) / 1e9).toFixed(4)} AVAX
                            <div className="faint" style={{ fontSize: 12 }}>until {new Date(balOf(v.nodeID)!.runsOut * 1000).toISOString().slice(0, 10)}</div>
                          </>
                        ) : bal.error ? <span className="faint">—</span> : <Skel w="80px" />}
                      </td>
                    )}
                    <td className="mono muted hide-sm" style={{ fontSize: 13 }}>{v.uri ?? "—"}</td>
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
