// The Ofel L1's own validators, live from the P-Chain and from each node.
import { cfg } from "../lib/config";
import { validatorBalances, validatorStatus } from "../lib/chain";
import { useLive } from "../lib/hooks";
import { short } from "../lib/format";
import { Ext, Hash, Skel, State } from "../components/ui";

export function Validators() {
  const vs = useLive(validatorStatus, [], 4000);
  const bal = useLive(() => (cfg.fuji ? validatorBalances() : Promise.resolve([])), [], 60000);
  const balOf = (nodeID: string) => bal.data?.find((b) => b.nodeID === nodeID);
  const online = vs.data?.filter((v) => v.online).length ?? 0;
  const total = vs.data?.length ?? 0;
  const ok = !!vs.data && online >= cfg.threshold;
  return (
    <main className="order" id="main">
      <header className="board-head">
        <span className="kicker">Validators</span>
        <h1>The L1's own validators hold the seal</h1>
        <p>Live from the P-Chain. Any {cfg.threshold} of their signatures open a batch after its close.</p>
      </header>
      <div className="order-hero">
        <section className="verdict dark" data-film="validators-online">
          <span className="label">Online now</span>
          <p className="verdict-big">
            {vs.data ? online : "—"}
            <span className="dim"> / {vs.data ? total : "—"}</span>
          </p>
          <p className="verdict-note">{vs.data ? (ok ? `Batches can open: ${cfg.threshold} signatures needed.` : "Below threshold: batches wait for the validators.") : vs.error ? "P-Chain unreachable." : "Checking each node…"}</p>
        </section>
        <section className="pnl osum">
          <header>
            <img className="osum-art" src="/art/validators.webp" alt="" aria-hidden width={56} height={56} />
            <div>
              <span className="label">Ofel L1 · chain {cfg.chainId}</span>
              <h1>Proof-of-authority set</h1>
            </div>
          </header>
          <dl className="osum-grid">
            <div><dt>Consensus</dt><dd>k=3, α=2</dd></div>
            <div><dt>Unseal threshold</dt><dd className="num">{cfg.threshold} of {total || 3}</dd></div>
            <div><dt>L1 on the Explorer</dt><dd>{cfg.fuji ? <Ext href={cfg.l1Page}>{short(cfg.subnetID, 5)}</Ext> : short(cfg.subnetID, 5)}</dd></div>
            <div><dt>ConvertSubnetToL1</dt><dd>{cfg.conversionTx ? <Ext href={cfg.pTx(cfg.conversionTx)}>{short(cfg.conversionTx, 5)}</Ext> : "—"}</dd></div>
          </dl>
        </section>
      </div>
      <section className="order-sec">
        <h2>Validator set <small className="dim">platform.getCurrentValidators</small></h2>
        <div className="pnl">
          {vs.error && <State kind="error" title="P-Chain unreachable">{vs.error}</State>}
          {!vs.data && !vs.error && (
            <div className="skels">
              <Skel h={40} />
              <Skel h={40} />
              <Skel h={40} />
            </div>
          )}
          {vs.data?.length === 0 && <State kind="empty" title="No validators returned for this L1" />}
          {!!vs.data?.length && (
            <div className="tbl-wrap">
              <table className="tbl" data-film="validator-set">
                <thead>
                  <tr>
                    <th>Node</th>
                    <th className="hide-sm">BLS key (G1)</th>
                    <th className="hide-sm">Weight</th>
                    {cfg.fuji && <th>P-Chain balance</th>}
                    <th className="hide-sm">Endpoint</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {vs.data.map((v) => {
                    const b = balOf(v.nodeID);
                    return (
                      <tr key={v.nodeID}>
                        <td><Hash v={v.nodeID} n={6} /></td>
                        <td className="hide-sm"><Hash v={v.publicKey} n={8} /></td>
                        <td className="mono hide-sm">{v.weight?.toString() ?? "—"}</td>
                        {cfg.fuji && (
                          <td className="mono" title="Validator fee: 512 nAVAX per second">
                            {b ? (
                              <>
                                {(Number(b.balance) / 1e9).toFixed(4)} AVAX
                                <small>until {new Date(b.runsOut * 1000).toISOString().slice(0, 10)}</small>
                              </>
                            ) : bal.error ? (
                              <span className="dim">—</span>
                            ) : (
                              <Skel w="80px" />
                            )}
                          </td>
                        )}
                        <td className="mono dim hide-sm">{v.uri?.replace("https://", "") ?? "—"}</td>
                        <td>{v.online ? <span className="st st-won"><i />Online</span> : <span className="st st-lost"><i />Offline</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="form-note pad-x">Collusion of {cfg.threshold} or more validators could sign a close message early off-chain. That is the trust assumption, the same one the L1's own consensus makes. Production sets would be independent operators.</p>
        </div>
      </section>
    </main>
  );
}
