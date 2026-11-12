import { cfg } from "../lib/config";
import { batchesWithOrders, validatorStatus } from "../lib/chain";
import { useLive } from "../lib/hooks";
import { units } from "../lib/format";
import { Link } from "../components/ui";

const WHO: [string, string, string, string, string][] = [
  ["", "The public", "Validators", "Auditor", "You"],
  ["Your order before T", "ciphertext", "ciphertext", "ciphertext", "yes"],
  ["Side and limit after T", "yes", "yes", "yes", "yes"],
  ["Your size, ever", "no", "no", "yes", "yes"],
  ["Batch totals and price", "yes", "yes", "yes", "yes"],
  ["Your balance", "no", "no", "yes", "yes"],
];

function Cell({ v }: { v: string }) {
  if (v === "yes") return <span className="yes">Sees it</span>;
  if (v === "no") return <span className="no">Never</span>;
  if (v === "ciphertext") return <span className="light">Ciphertext</span>;
  return <>{v}</>;
}

export function Landing() {
  const batches = useLive(() => batchesWithOrders(60), [], 8000);
  const vals = useLive(validatorStatus, [], 8000);
  const cleared = batches.data?.filter((b) => b.state === 3 && b.price > 0n) ?? [];
  const last = cleared.find((b) => b.price > 0n);
  const sealedTotal = batches.data?.reduce((s, b) => s + b.orderCount, 0) ?? 0;
  const live = !batches.error && batches.data;

  return (
    <>
      <section className="hero">
        <div>
          <h1>Trade size in the dark.</h1>
          <p className="lede">
            Private block trading on Avalanche. Your order is sealed before its price exists, and your size stays private for good.
          </p>
          <div className="row wrap">
            <Link to="/desk" className="btn primary">Open the desk</Link>
            <a className="btn ghost" href="#how">How the seal works</a>
          </div>
          <div className="muted" style={{ fontSize: 13.5, marginTop: 28, maxWidth: 520 }}>
            For funds, DAOs and treasuries moving size without being front-run or watched.
          </div>
        </div>
        <div className="hero-art">
          <img className="env float" src="/art/hero.webp" alt="A sealed order, closed with a seam of light" width={440} height={440} />
          <img className="ecl" src="/art/eclipse.webp" alt="" width={168} height={168} />
        </div>
      </section>

      <section className="section" aria-label="Live">
        <div className="proof">
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
        <div className="muted" style={{ fontSize: 13, marginTop: 10 }}>
          {batches.error ? `Live data unavailable: the Ofel L1 is not reachable at ${cfg.rpc}.` : `Read live from ${cfg.networkLabel}.`}
        </div>
      </section>

      <section className="section" id="how">
        <h2>The chain's own validators hold the key.</h2>
        <p className="sub">Ofel runs on its own Avalanche L1. Each batch closes at a set time T, and orders are encrypted to that moment. There is no operator who could peek.</p>
        <div className="flow">
          <div className="panel">
            <img src="/art/hero.webp" alt="" width={112} height={112} />
            <h3>Sealed to a future message</h3>
            <p>Your browser encrypts the order to the exact Warp message the L1 will emit when the batch closes, split across the validators' BLS keys.</p>
          </div>
          <div className="panel">
            <img src="/art/key.webp" alt="" width={112} height={112} />
            <h3>Unsealed by their signatures</h3>
            <p>Before T the contract refuses to close and validators refuse to sign. After T, any {cfg.threshold} signatures are the decryption key. One validator down changes nothing.</p>
          </div>
          <div className="panel">
            <img src="/art/coins.webp" alt="" width={112} height={112} />
            <h3>One price, private sizes</h3>
            <p>The contract sets one price from the limits and checks the totals against commitments. Fills settle in eERC, so amounts stay encrypted with an auditor key.</p>
          </div>
        </div>
      </section>

      <section className="section">
        <h2>Who sees what.</h2>
        <p className="sub">Penumbra-grade privacy with an auditor for compliance. Nothing here is a promise from us; each row is enforced by the chain or by cryptography.</p>
        <div className="who" role="table">
          {WHO.flat().map((v, i) => (
            <div key={i} role="cell"><Cell v={v} /></div>
          ))}
        </div>
      </section>

      <section className="section">
        <h2>Built on Avalanche for a reason.</h2>
        <p className="sub">
          Its own L1 with a validator set the app can read from the P-Chain. Warp BLS signatures as a timelock (warplock, open source). Ava Labs' encrypted ERC for balances and settlement. Consensus tuned so one of three validators can be down.
        </p>
        <div className="row wrap">
          <Link to="/validators" className="btn">See the validators</Link>
          <Link to="/batches" className="btn ghost">Browse batches</Link>
        </div>
      </section>

      <footer className="footer">
        <div className="row"><img src="/art/mark.webp" alt="" width={28} height={28} /><b style={{ color: "var(--ink)" }}>Ofel</b> · אופל, deep darkness</div>
        <div>MIT · contracts, warplock and the desk are open source</div>
      </footer>
    </>
  );
}
