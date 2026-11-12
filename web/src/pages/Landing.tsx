import { cfg } from "../lib/config";
import { batchesWithOrders, validatorStatus } from "../lib/chain";
import { useLive } from "../lib/hooks";
import { short, units } from "../lib/format";
import { Hash, Link } from "../components/ui";
import fujiStatus from "../../../deployments/fuji.json";

const WHO: [string, string, string, string, string][] = [
  ["", "The public", "Validators", "Auditor", "You"],
  ["Your order before the close", "ciphertext", "ciphertext", "ciphertext", "yes"],
  ["Side and limit after the close", "yes", "yes", "yes", "yes"],
  ["Your size", "no", "no", "yes", "yes"],
  ["Batch totals and price", "yes", "yes", "yes", "yes"],
  ["Your balance", "no", "no", "yes", "yes"],
];

function Cell({ v }: { v: string }) {
  if (v === "yes") return <span className="yes">Sees it</span>;
  if (v === "no") return <span className="no">Never</span>;
  if (v === "ciphertext") return <span className="light">Sealed</span>;
  return <>{v}</>;
}

const STEPS: [string, string, string][] = [
  ["hero", "Seal your order", "Size and limit are encrypted in your browser before they leave it."],
  ["hourglass", "The batch closes", "At the close, the L1's validators sign it open. Not before, and not alone."],
  ["scale", "One fair price", "Everyone crosses at one price. Settlement is private, so your size stays yours."],
];

const CONTRACTS: [string, string | undefined][] = [
  ["OfelBook", cfg.book],
  ["Encrypted ERC (Ava Labs)", cfg.eerc],
  ["eERC registrar", cfg.registrar],
  ["Test-funds faucet", cfg.faucet],
];

export function Landing() {
  const batches = useLive(() => batchesWithOrders(60), [], 8000);
  const vals = useLive(validatorStatus, [], 8000);
  const cleared = batches.data?.filter((b) => b.state === 3 && b.price > 0n) ?? [];
  const last = cleared[0];
  const sealedTotal = batches.data?.reduce((s, b) => s + b.orderCount, 0) ?? 0;
  const live = !batches.error && batches.data;
  const pTxs = cfg.fuji ? fujiStatus.pChainTxs : [];

  return (
    <>
      <section className="hero">
        <div>
          <h1>Trade size without being front-run.</h1>
          <p className="lede">Private block trading for funds, DAOs and treasuries. Your order stays sealed until the batch closes, and your size is never made public.</p>
          <div className="row wrap">
            <Link to="/desk" className="btn primary">Open the desk</Link>
            <a className="btn ghost" href="#how">How it works</a>
          </div>
          <div className="muted" style={{ fontSize: 13.5, marginTop: 28, maxWidth: 520 }}>
            On its own Avalanche L1, whose validators hold the seal.
          </div>
        </div>
        <div className="hero-art">
          <img className="env float" src="/art/block.webp" alt="A bundle of sealed orders, bound with a band of light" width={440} height={440} fetchPriority="high" />
          <img className="ecl" src="/art/eclipse.webp" alt="" width={168} height={168} />
        </div>
      </section>

      <section className="section" id="how" aria-labelledby="h-how">
        <h2 id="h-how">Nobody sees your order until it can't be traded against.</h2>
        <div className="flow">
          {STEPS.map(([art, t, p]) => (
            <div className="panel" key={t}>
              <img src={`/art/${art}.webp`} alt="" width={112} height={112} loading="lazy" />
              <h3>{t}</h3>
              <p>{p}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section" aria-labelledby="h-proven">
        <h2 id="h-proven">What stays private, and what's proven.</h2>
        <p className="sub">Every row is enforced by the chain or by cryptography. Live from {cfg.networkLabel}.</p>
        <div className="proof" style={{ marginBottom: 16 }}>
          <div>
            <div className="muted" style={{ fontSize: 13 }}>Batches crossed</div>
            <div className="v num">{live ? cleared.length : "—"}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 13 }}>Last clearing price</div>
            <div className="v num">{last ? units(last.price) : "—"}<span className="dec" style={{ fontSize: 15, marginLeft: 6 }}>tUSDC</span></div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 13 }}>Orders sealed</div>
            <div className="v num">{live ? sealedTotal : "—"}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 13 }}>Validators online</div>
            <div className="v num">{vals.data ? `${vals.data.filter((v) => v.online).length}/${vals.data.length}` : "—"}</div>
          </div>
        </div>
        {batches.error && <div className="note" role="alert" style={{ marginBottom: 16 }}>Live data unavailable: the Ofel L1 is not reachable right now.</div>}
        <div className="who" aria-label="Who sees what">
          {WHO.flat().map((v, i) => (
            <div key={i}><Cell v={v} /></div>
          ))}
        </div>
      </section>

      <section className="section" aria-labelledby="h-desk">
        <div className="feature panel">
          <div>
            <h2 id="h-desk">Try it with an empty wallet.</h2>
            <p className="sub">Connect, pick Test wallet, tap Get test funds. A house trader quotes into every batch, so your first order fills.</p>
            <div className="row wrap">
              <Link to="/desk" className="btn primary">Open the desk</Link>
              <Link to="/batches" className="btn ghost">Browse batches</Link>
            </div>
          </div>
          <img className="float" src="/art/desk.webp" alt="The Ofel desk on a dark glass tablet" width={320} height={320} loading="lazy" />
        </div>
      </section>

      <section className="section" aria-labelledby="h-proof">
        <div className="feature-split">
          <div>
            <img src="/art/proof.webp" alt="" width={112} height={112} loading="lazy" style={{ marginBottom: 12 }} />
            <h2 id="h-proof">Check it yourself.</h2>
            <p className="sub" style={{ marginBottom: 20 }}>
              Ofel L1: chain ID {cfg.chainId}, {vals.data?.length ?? 3} validators, Warp on. The L1 and its P-Chain history are on the Avalanche Explorer.
            </p>
            <div className="row wrap">
              {cfg.fuji && <a className="btn sm" href={cfg.l1Page} target="_blank" rel="noreferrer">The L1 on Avalanche Explorer ↗</a>}
              <Link to="/validators" className="btn sm ghost">Validators</Link>
            </div>
          </div>
          <div className="panel">
            {CONTRACTS.filter(([, a]) => a).map(([k, a]) => (
              <div className="kv-row" key={k}><span className="muted">{k}</span><Hash v={a} n={6} /></div>
            ))}
            {pTxs.map((t) => (
              <div className="kv-row" key={t.txID}>
                <span className="muted">{t.kind}</span>
                <a className="mono" href={cfg.pTx(t.txID)} target="_blank" rel="noreferrer">{short(t.txID, 6)} ↗</a>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="footer">
        <div className="row"><img src="/art/mark.webp" alt="" width={28} height={28} /><b style={{ color: "var(--ink)" }}>Ofel</b> · אופל, deep darkness</div>
        <div>MIT · contracts, warplock and the desk are open source</div>
      </footer>
    </>
  );
}
