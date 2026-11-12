// Landing, in Eidolon's structure: a night hero with the live desk in a device frame, a trust strip, live numbers,
// three benefits with Ofel's obsidian art, who-sees-what, the proof, and one call to action.
import { cfg } from "../lib/config";
import { batchesWithOrders, recentBatches, validatorStatus } from "../lib/chain";
import { useLive, useNow } from "../lib/hooks";
import { countdown, short, units, utc } from "../lib/format";
import { fetchCandles, INTERVALS } from "../lib/candles";
import { chainlinkAvax, fix, ofelClears, priced, usd } from "../lib/market";
import { DeskChart } from "../components/CandleChart";
import { Ext, Hash, Icon, Link, Logo, Pair } from "../components/ui";
import fujiStatus from "../../../deployments/fuji.json";

const Art = ({ src, className }: { src: string; className?: string }) => (
  <div className={`art ${className ?? ""}`} aria-hidden="true">
    <img src={src} alt="" width={640} height={640} />
  </div>
);

/** The real desk, live and read-only, in a device frame. */
function DeskPreview() {
  const now = useNow();
  const head = useLive(() => recentBatches(1), [], 4000);
  const clearsAll = useLive(ofelClears, [], 30000);
  const clears = { data: clearsAll.data?.filter(priced) };
  const ref = useLive(() => chainlinkAvax(24), [], 60000);
  const candles = useLive(() => fetchCandles("AVAX", "5m", 120), [], 30000);
  const b = head.data?.[0];
  const left = b ? Number(b.closeAt) - now : 0;
  const last = clears.data?.at(-1);
  return (
    <div className="device" aria-label="Live preview of the Ofel desk" data-film="landing-preview">
      <div className="device-bar">
        <i />
        <i />
        <i />
        <span className="mono">ofel-desk.vercel.app/desk</span>
      </div>
      <div className="prev">
        <div className="prev-mbar">
          <Pair size={22} />
          <b>tAVAX / tUSDC</b>
          <span className="mono prev-last">{last ? fix(last.price) : "—"}</span>
          <span className="mono dim hide-sm">AVAX/USD {ref.data ? usd(ref.data.price, 3) : "…"} · Chainlink</span>
          <span className="mono prev-src">{b && b.state === 1 && left > 0 ? `#${b.id} seals in ${countdown(left)}` : b ? `batch #${b.id}` : "Ofel L1"}</span>
        </div>
        <div className="prev-chart">
          {candles.data ? (
            <DeskChart candles={candles.data.candles} sec={INTERVALS["5m"]} rounds={ref.data?.rounds ?? []} clears={clears.data ?? []} compact />
          ) : (
            <div className="chart-wait">
              <i className="pulse" /> {candles.error ? "Exchange candles unavailable" : "Loading AVAX-USD candles…"}
            </div>
          )}
        </div>
        <div className="prev-form">
          <p className="prev-h">Block order</p>
          <div className="updown">
            <Link className="ud ud-up" to="/desk">
              <span>
                <Icon name="up" size={14} />
                Buy
              </span>
              <small>tAVAX</small>
            </Link>
            <Link className="ud ud-down" to="/desk">
              <span>
                <Icon name="down" size={14} />
                Sell
              </span>
              <small>tAVAX</small>
            </Link>
          </div>
          <div className="prev-ghost">
            <img src="/art/hero.webp" alt="" aria-hidden width={40} height={40} />
            <span>
              Sealed until <b className="num">{b ? utc(b.closeAt).slice(0, 8) : "the close"}</b>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

const WHO: [string, string, string, string, string][] = [
  ["Your order before the close", "sealed", "sealed", "sealed", "yes"],
  ["Side and limit after the close", "yes", "yes", "yes", "yes"],
  ["Your size", "no", "no", "yes", "yes"],
  ["Batch totals and the price", "yes", "yes", "yes", "yes"],
  ["Your balance", "no", "no", "yes", "yes"],
];
const Cell = ({ v }: { v: string }) =>
  v === "yes" ? <span className="up">Yes</span> : v === "no" ? <span className="dim">Never</span> : <span className="sealed-word"><Icon name="lock" size={12} />Sealed</span>;

const CONTRACTS: [string, string | undefined][] = [
  ["OfelBook", cfg.book],
  ["Encrypted ERC (Ava Labs)", cfg.eerc],
  ["eERC registrar", cfg.registrar],
  ["Test-funds faucet", cfg.faucet],
];

export function Landing() {
  const batches = useLive(() => batchesWithOrders(60), [], 10000);
  const clears = useLive(ofelClears, [], 30000);
  const vals = useLive(validatorStatus, [], 10000);
  const ref = useLive(() => chainlinkAvax(4), [], 60000);
  const last = clears.data?.filter(priced).at(-1);
  const sealedTotal = batches.data?.reduce((s, b) => s + b.orderCount, 0);
  const lastWithOrders = batches.data?.[0];
  const pTxs = cfg.fuji ? fujiStatus.pChainTxs : [];

  return (
    <>
      <div className="dark hero-wrap">
        <header className="l-nav">
          <Logo />
          <nav aria-label="Primary" className="l-links">
            <a href="#how">How it works</a>
            <a href="#who">Who sees what</a>
            <a href="#proof">Proof</a>
            <Link to="/batches">Batches</Link>
          </nav>
          <Link to="/desk" className="btn btn-primary btn-sm" data-film="open-desk">
            Open the desk
          </Link>
        </header>
        <section className="hero">
          <div className="hero-copy">
            <p className="pill-live">
              <i className="live" />
              Live on its own Avalanche L1 · Fuji
            </p>
            <h1 data-film="hero-title">
              Trade size without being <em>front-run.</em>
            </h1>
            <p className="hero-lede">Private block trading for funds, DAOs and treasuries. Your order stays sealed until the batch closes, and your size is never made public.</p>
            <div className="hero-cta">
              <Link to="/desk" className="btn btn-primary btn-lg">
                Open the desk <Icon name="arrow" size={17} />
              </Link>
              <a href="#how" className="btn btn-ghost btn-lg">How it works</a>
            </div>
          </div>
          <Art src="/art/block.webp" className="hero-art" />
        </section>
        <div className="hero-device">
          <DeskPreview />
        </div>
      </div>

      <main id="main" className="l-main">
        <section className="trust" aria-label="Where the data comes from">
          <img src="/art/proof.webp" alt="" aria-hidden className="trust-seal" width={56} height={56} />
          <div className="trust-title">
            <b>Real data only</b>
            <span>Every number is read from the Ofel L1, Fuji or a named exchange.</span>
          </div>
          <dl className="trust-items">
            <div><dt>Book</dt><dd>Ofel L1 · chain {cfg.chainId}</dd></div>
            <div><dt>Seal</dt><dd>Warp · {cfg.threshold} of {vals.data?.length ?? 3} validators</dd></div>
            <div><dt>Balances</dt><dd>eERC (Ava Labs)</dd></div>
            <div><dt>Reference</dt><dd>Chainlink on Fuji</dd></div>
          </dl>
        </section>

        <dl className="numbers" aria-label="Live numbers" data-film="landing-numbers">
          <div>
            <dt>AVAX/USD · Chainlink Fuji</dt>
            <dd className="mono">{ref.data ? usd(ref.data.price, 3) : "…"}</dd>
          </div>
          <div>
            <dt>Batches crossed</dt>
            <dd>{clears.data ? clears.data.length : "…"}</dd>
          </div>
          <div>
            <dt>Last clear <small>tUSDC</small></dt>
            <dd className="mono">{last ? fix(last.price) : "—"}</dd>
          </div>
          <div>
            <dt>Orders sealed</dt>
            <dd>{sealedTotal ?? "…"}</dd>
          </div>
          <div>
            <dt>Validators in sync</dt>
            <dd>
              {vals.data ? vals.data.filter((v) => v.synced).length : "…"}
              <small>{vals.data ? ` of ${vals.data.length}` : ""}</small>
            </dd>
          </div>
        </dl>

        <section className="benefits" id="how">
          <article className="ben">
            <Art src="/art/hero.webp" className="ben-art" />
            <div className="ben-copy">
              <p className="kicker">01 · Seal it</p>
              <h2>Your order leaves the browser as ciphertext.</h2>
              <p>Size and limit are encrypted before they're sent. The chain stores a sealed envelope and a commitment to your size, nothing a bot can trade against.</p>
              {lastWithOrders && (
                <ul className="ben-rows">
                  <li>
                    <Icon name="lock" size={14} />
                    <span className="mono dim">batch #{lastWithOrders.id.toString()} · {lastWithOrders.orderCount} sealed orders</span>
                    <Link className="tx" to={`/batches/${lastWithOrders.id}`}>See them</Link>
                  </li>
                </ul>
              )}
            </div>
          </article>
          <article className="ben ben-flip">
            <Art src="/art/hourglass.webp" className="ben-art" />
            <div className="ben-copy">
              <p className="kicker">02 · The batch closes</p>
              <h2>Only the close can open it.</h2>
              <p>When the batch closes, the L1's validators sign a Warp message. Any {cfg.threshold} signatures open every order at once. Ask early and the chain refuses.</p>
              <div className="ben-live">
                <span className="label">Validators right now</span>
                <p className="ben-quote">{vals.data ? `${vals.data.filter((v) => v.synced).length} of ${vals.data.length} in sync · any ${cfg.threshold} unseal` : "Checking…"}</p>
              </div>
            </div>
          </article>
          <article className="ben">
            <Art src="/art/scale.webp" className="ben-art" />
            <div className="ben-copy">
              <p className="kicker">03 · One fair price</p>
              <h2>Everyone crosses at one price. Sizes stay yours.</h2>
              <p>Buyers and sellers fill at a single clearing price. Settlement runs through encrypted balances, so the chain shows a transfer, never the amount.</p>
              {last && (
                <div className="ben-cross">
                  <div>
                    <span className="label">Last clear</span>
                    <b className="mono">{fix(last.price)} tUSDC</b>
                  </div>
                  <div>
                    <span className="label">Matched</span>
                    <b className="mono">{units(last.buyTotal < last.sellTotal ? last.buyTotal : last.sellTotal)} tAVAX</b>
                  </div>
                  <div>
                    <span className="label">Batch</span>
                    <b className="mono">#{last.batchId.toString()}</b>
                  </div>
                </div>
              )}
            </div>
          </article>
        </section>

        <section className="l-sec" id="who">
          <header className="l-head">
            <p className="kicker">Who sees what</p>
            <h2>Private where it protects you. Public where it proves the price.</h2>
          </header>
          <div className="pnl">
            <div className="tbl-wrap">
              <table className="tbl who-tbl" data-film="who-sees-what">
                <thead>
                  <tr>
                    <th />
                    <th>Public</th>
                    <th>Validators</th>
                    <th>Auditor</th>
                    <th>You</th>
                  </tr>
                </thead>
                <tbody>
                  {WHO.map((r) => (
                    <tr key={r[0]}>
                      <td><b>{r[0]}</b></td>
                      {r.slice(1).map((v, i) => (
                        <td key={i}><Cell v={v} /></td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="l-sec" id="proof">
          <header className="l-head">
            <p className="kicker">Check it yourself</p>
            <h2>One L1, three validators, every contract on screen.</h2>
          </header>
          <div className="runlist">
            <p className="runlist-h">Ofel L1 · chain {cfg.chainId} · Warp on</p>
            <ol>
              {CONTRACTS.filter(([, a]) => a).map(([k, a]) => (
                <li key={k}>
                  <code>{k}</code>
                  <p className="mono dim">{a}</p>
                  <Hash v={a} />
                </li>
              ))}
              {pTxs.map((t) => (
                <li key={t.txID}>
                  <code>{t.kind}</code>
                  <p className="mono dim">P-Chain · {short(t.txID, 10)}</p>
                  <Ext href={cfg.pTx(t.txID)}>Explorer</Ext>
                </li>
              ))}
            </ol>
            {cfg.fuji && (
              <a className="btn btn-ghost btn-sm" href={cfg.l1Page} target="_blank" rel="noreferrer">
                The L1 on Avalanche Explorer <Icon name="external" size={14} />
              </a>
            )}
          </div>
        </section>
      </main>

      <section className="dark cta">
        <Art src="/art/desk.webp" className="cta-art" />
        <div>
          <h2>Try it with an empty wallet.</h2>
          <p className="cta-sub">Test wallet, Get test funds, seal. A house trader quotes into every batch, so your first order can fill.</p>
          <Link to="/desk" className="btn btn-primary btn-lg" data-film="cta">
            Open the desk <Icon name="arrow" size={17} />
          </Link>
        </div>
      </section>

      <footer className="l-foot">
        <div className="l-foot-in">
          <div className="l-foot-brand">
            <Logo />
            <p>Private block trading on its own Avalanche L1. Ofel (אופל) means deep darkness.</p>
          </div>
          <div>
            <h4>Product</h4>
            <Link to="/desk">Desk</Link>
            <Link to="/batches">Batches</Link>
            <Link to="/validators">Validators</Link>
            <Link to="/auditor">Auditor</Link>
          </div>
          <div>
            <h4>Built on</h4>
            {cfg.fuji && <a href={cfg.l1Page} target="_blank" rel="noreferrer">Ofel L1 on Fuji <Icon name="external" size={11} /></a>}
            <span>Avalanche Warp · eERC (Ava Labs)</span>
            <span>Chainlink AVAX/USD on Fuji</span>
          </div>
          <div>
            <h4>Credits</h4>
            <span>Desk UI forked from Eidolon</span>
            <span>Candles: Coinbase (Binance fallback)</span>
            <span>3D art generated with ChatGPT</span>
          </div>
        </div>
        <p className="l-legal">MIT · © 2026 Nivesh Gajengi · Testnet only: tAVAX and tUSDC are test tokens with no value.</p>
      </footer>
    </>
  );
}
