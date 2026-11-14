// Landing sections added in the film round (Nov 14): the problem (a public book vs Ofel's sealed book), the anatomy of
// a sealed order (what the browser seals, what the chain stores, what the validators sign, when it opens), an honest
// comparison with other venues (sources in README "Compared with"), and the proof (public RPC, a live receipt).
// Everything marked live is read from the Ofel L1 or the Fuji P-Chain; the public-book animation is an illustration
// and says so.
import { useEffect, useRef, useState } from "react";
import { parseAbiItem, toHex, type Hex } from "viem";
import { splitEnvelope } from "@ofel/core";
import { decodeEnvelope } from "warplock";
import { cfg } from "../lib/config";
import { batchesWithOrders, client, getOrders, getSealed, validatorStatus } from "../lib/chain";
import { useLive } from "../lib/hooks";
import { short, units, utc } from "../lib/format";
import { fix, ofelClears, priced } from "../lib/market";
import { Hash, Icon, Link } from "./ui";

const bytesOf = (h: string) => Math.max(0, (h.length - 2) / 2);
const useReduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ------------------------------------------------------------------------------------------------ 1. the problem
const ASKS: [number, number][] = [[8.37, 420], [8.36, 310], [8.35, 260]];
const BIDS: [number, number][] = [[8.33, 380], [8.32, 510]];

/** An illustration of front-running on a public book: a fund's block buy shows up, two bots buy the cheap asks first
 * and offer them back higher. Not live data; labelled as an illustration. */
function PublicBook() {
  const reduced = useReduced();
  const [ph, setPh] = useState(reduced ? 4 : 0);
  const ref = useRef<HTMLDivElement>(null);
  // the story starts from the top each time the book scrolls into view, then loops
  useEffect(() => {
    if (reduced || !ref.current) return;
    let t: ReturnType<typeof setInterval> | undefined;
    const io = new IntersectionObserver(([e]) => {
      clearInterval(t);
      if (!e.isIntersecting) return;
      setPh(0);
      t = setInterval(() => setPh((p) => (p + 1) % 6), 1900);
    }, { threshold: 0.6 });
    io.observe(ref.current);
    return () => { io.disconnect(); clearInterval(t); };
  }, [reduced]);
  const eaten = ph >= 2 && ph < 5;
  const relist = ph >= 3 && ph < 5;
  const last = ph >= 4 && ph < 5 ? "8.41" : ph >= 2 && ph < 5 ? "8.36" : "8.34";
  return (
    <div className="pb" ref={ref} data-film="public-book" data-phase={ph}>
      <div className="pb-head">
        <span className="label">Public order book</span>
        <span className={`pb-last num ${ph >= 2 && ph < 5 ? "pb-up" : ""}`}>{last}</span>
      </div>
      <ol className="pb-rows">
        {relist && (
          <>
            <li className="pb-ask pb-bot pb-new"><span className="num">8.41</span><span className="num">310</span><em>Bot B sells back</em></li>
            <li className="pb-ask pb-bot pb-new"><span className="num">8.39</span><span className="num">260</span><em>Bot A sells back</em></li>
          </>
        )}
        {ASKS.map(([p, s]) => (
          <li key={p} className={`pb-ask ${eaten && p <= 8.36 ? "pb-gone" : ""}`}>
            <span className="num">{fix(p)}</span>
            <span className="num">{s}</span>
            {eaten && p === 8.36 && <em>bought by Bot B</em>}
            {eaten && p === 8.35 && <em>bought by Bot A</em>}
          </li>
        ))}
        <li className="pb-mid"><span>spread</span></li>
        {ph >= 1 && ph < 5 && (
          <li className="pb-bid pb-whale pb-new">
            <span className="num">≤8.45</span>
            <span className="num">1,000</span>
            <em><Icon name="eye" size={13} /> Fund's block buy, up to 8.45 · everyone sees it</em>
          </li>
        )}
        {BIDS.map(([p, s]) => (
          <li key={p} className="pb-bid"><span className="num">{fix(p)}</span><span className="num">{s}</span></li>
        ))}
      </ol>
      <p className="pb-cap">
        {ph === 0 && "A quiet book. Last trade 8.34."}
        {ph === 1 && "A fund posts a 1,000 buy, up to 8.45. Everyone can see it."}
        {ph === 2 && "Bots see it first and buy the cheap offers ahead of it."}
        {ph === 3 && "Then they offer the same tokens back, higher."}
        {ph === 4 && "The fund pays up to 8.41 instead of 8.35. That's front-running."}
        {ph === 5 && "Size on a public book is a signal."}
      </p>
      <span className="illus">Illustration · not live data</span>
    </div>
  );
}

/** The real sealed book: the newest batch with orders, as the Ofel L1 stores it. */
function SealedBook() {
  const b = useLive(async () => {
    const [last] = await batchesWithOrders(40);
    if (!last) return undefined;
    const [sealed, orders] = await Promise.all([getSealed(last.id), getOrders(last.id)]);
    return { batch: last, rows: sealed.slice(0, 6).map((s) => ({ ...s, c: orders[s.index]?.commitment })) };
  }, [], 20000);
  return (
    <div className="sb" data-film="sealed-book-live">
      <div className="pb-head">
        <span className="label">Ofel's book · batch #{b.data?.batch.id.toString() ?? "…"}</span>
        <span className="sb-live"><i className="live" /> live from the L1</span>
      </div>
      <ol className="sb-rows">
        {b.data?.rows.map((r) => (
          <li key={r.index}>
            <img src="/art/hero.webp" alt="" aria-hidden width={34} height={34} />
            <span className="mono">{short(r.trader)}</span>
            <span className="sb-sealed"><Icon name="lock" size={12} /> side · limit sealed</span>
            <span className="mono dim">{bytesOf(r.envelope).toLocaleString("en-US")} B · size C {short(r.c, 4)}</span>
          </li>
        ))}
        {!b.data && <li className="sb-wait">{b.error ? `L1 unreachable: ${b.error}` : "Reading the sealed book…"}</li>}
      </ol>
      <p className="pb-cap">Bots see ciphertext until the batch closes. Then everyone fills at one price, and no single size is ever shown.</p>
    </div>
  );
}

export function Problem() {
  return (
    <section className="l-sec prob" id="why" aria-labelledby="why-h">
      <div className="prob-card dark">
        <header className="prob-head">
          <p className="kicker">Why sealed</p>
          <h2 id="why-h">On a public book, a big order is a signal.</h2>
          <p>On-chain order books and mempools are public. A fund's block buy is seen before it fills, so bots buy first and sell back higher. Ofel keeps every order sealed until its batch closes: there's nothing to jump in front of.</p>
        </header>
        <div className="prob-grid">
          <div className="prob-side">
            <img className="prob-art" src="/art/exposed.webp" alt="A clear glass envelope with its coins in plain view" width={640} height={640} />
            <PublicBook />
          </div>
          <div className="prob-vs" aria-hidden="true">vs</div>
          <div className="prob-side">
            <img className="prob-art" src="/art/block.webp" alt="Three sealed obsidian envelopes bound by a band of light" width={640} height={640} />
            <SealedBook />
          </div>
        </div>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------------------------------------ 2. anatomy of a sealed order
/** One real sealed order, byte by byte: what OfelBook stores. Computed from the envelope read off the L1. */
// The map walks through its parts once it is on screen (key shares, the encrypted order, your copy, the size
// commitment), then shows them all together; it loops while in view and stays still under reduced motion.
const EMAP_STEPS: [number, number][] = [[0, 2200], [1, 2400], [2, 1900], [3, 1700], [4, 2600], [0, 4200]];
function useEmapStep() {
  const ref = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(0);
  useEffect(() => {
    // a film recorder sets window.__ofelFilm and steps the map itself, in time with its narration
    if (!ref.current || useReduced() || (window as unknown as { __ofelFilm?: boolean }).__ofelFilm) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const run = (i: number) => { setStep(EMAP_STEPS[i][0]); t = setTimeout(() => run((i + 1) % EMAP_STEPS.length), EMAP_STEPS[i][1]); };
    const io = new IntersectionObserver(([e]) => { clearTimeout(t); setStep(0); if (e.isIntersecting) run(0); }, { threshold: 0.6 });
    io.observe(ref.current);
    return () => { io.disconnect(); clearTimeout(t); };
  }, []);
  return { ref, step };
}

function EnvelopeMap({ env, c, batch }: { env: Hex; c?: Hex; batch: bigint }) {
  const { ref, step } = useEmapStep();
  let parts: { k: string; n: number; t: string; d: string; hex?: string }[] = [];
  try {
    const { timelocked, mine } = splitEnvelope(env);
    const e = decodeEnvelope(timelocked);
    parts = [
      ...e.shares.map((sh, i) => ({ k: "share", n: 133, t: `Key share ${i + 1}`, d: `opens only with ${short(sh.nodeID.replace("NodeID-", ""), 3)}'s BLS signature on the close message`, hex: toHex(sh.U).slice(2, 18) })),
      { k: "ct", n: 12 + e.ciphertext.length, t: "AES-GCM ciphertext", d: "side, limit, salt, and your size sealed again to the clearing agent", hex: toHex(e.ciphertext).slice(2, 18) },
      { k: "mine", n: mine.length, t: "Your copy", d: "sealed to a key only your browser holds, so you can read your own order", hex: toHex(mine).slice(2, 18) },
      { k: "wrap", n: Math.max(0, bytesOf(env) - timelocked.length - mine.length + 3), t: "Framing", d: "version, threshold, lengths", hex: undefined },
    ];
  } catch {
    return null;
  }
  const total = parts.reduce((s, p) => s + p.n, 0);
  return (
    <div className="emap" data-film="envelope-map" ref={ref} data-step={step}>
      <div className="emap-head">
        <img className="emap-art" src="/art/vault.webp" alt="" aria-hidden width={640} height={640} />
        <span className="label">Inside one sealed order · batch #{batch.toString()} · read live from OfelBook</span>
        <b className="num">{bytesOf(env).toLocaleString("en-US")} bytes, none of them readable before the close</b>
      </div>
      <div className="emap-bar" role="img" aria-label="Byte map of the sealed order">
        {parts.map((p, i) => (
          <span key={i} className={`emap-seg emap-${p.k}`} style={{ flexGrow: Math.max(p.n, total * 0.035) }} title={`${p.t}: ${p.n} bytes`}>
            <i className="num">{p.n} B</i>
          </span>
        ))}
      </div>
      <ol className="emap-legend">
        {parts.filter((p) => p.k !== "wrap").map((p, i) => (
          <li key={i} className={`emap-${p.k}`}>
            <b>{p.t}</b>
            <span>{p.d}</span>
            {p.hex && <code>{p.hex}…</code>}
          </li>
        ))}
        <li className="emap-c">
          <b>Stored beside it</b>
          <span>size commitment C, a BN254 point: binds your size without showing it</span>
          {c && <code>{short(c, 6)}</code>}
        </li>
      </ol>
    </div>
  );
}

export function Anatomy() {
  const ex = useLive(async () => {
    const [last] = await batchesWithOrders(40);
    if (!last) return undefined;
    const [sealed, orders] = await Promise.all([getSealed(last.id), getOrders(last.id)]);
    const s = sealed.at(-1);
    return { batch: last, env: s?.envelope, tx: s?.tx, c: s ? orders[s.index]?.commitment : undefined };
  }, [], 20000);
  const vals = useLive(validatorStatus, [], 10000);
  const clears = useLive(ofelClears, [], 30000);
  const last = clears.data?.filter(priced).at(-1);
  const synced = vals.data?.filter((v) => v.synced).length;
  const STEPS = [
    {
      n: "01", art: "/art/hero.webp", film: "anat-browser", title: "Your browser seals it",
      body: "Side, limit and size are encrypted in your browser with AES-GCM. The key is split 2-of-3 across the validators' BLS keys, read live from the P-Chain, and locked to the exact Warp message the batch will emit at its close.",
      live: ex.data ? <>Sealed to batch <b>#{ex.data.batch.id.toString()}</b> · closes <b>{utc(ex.data.batch.closeAt).slice(0, 8)} UTC</b></> : "…",
    },
    {
      n: "02", art: "/art/vault.webp", film: "anat-chain", title: "The chain stores ciphertext",
      body: "OfelBook keeps the sealed envelope and a Pedersen commitment to your size. No side, no limit, no size. Anyone can read the bytes; nobody can read the order.",
      live: ex.data?.env ? <><b>{bytesOf(ex.data.env).toLocaleString("en-US")} B</b> sealed envelope · size C <code>{short(ex.data.c, 6)}</code></> : "…",
    },
    {
      n: "03", art: "/art/validators.webp", film: "anat-sign", title: "Validators sign at the close",
      body: "At the close, anyone calls closeBatch and the L1 emits the Warp message. Its validators sign it, and any two of those BLS signatures are the decryption key. Before the close every validator answers \"not found\".",
      live: vals.data ? <><b>{synced} of {vals.data.length}</b> validators in sync · any <b>{cfg.threshold}</b> open a batch</> : "…",
    },
    {
      n: "04", art: "/art/opened.webp", film: "anat-open", title: "It opens. Sizes don't.",
      body: "Every order opens at once: side and limit set one clearing price. Sizes stay commitments; the contract checks that the commitments add up to the public totals. Fills settle as encrypted eERC transfers.",
      live: last ? <>Batch <b>#{last.batchId.toString()}</b> cleared at <b>{fix(last.price)}</b> · totals {units(last.buyTotal)} / {units(last.sellTotal)}</> : "…",
    },
  ];
  return (
    <section className="l-sec" id="seal" aria-labelledby="seal-h">
      <header className="l-head">
        <p className="kicker">What gets sealed</p>
        <h2 id="seal-h">What your browser seals, what the chain keeps, who opens it.</h2>
      </header>
      <ol className="anat">
        {STEPS.map((s) => (
          <li key={s.n} className="anat-step" data-film={s.film}>
            <div className="anat-art"><img src={s.art} alt="" aria-hidden width={640} height={640} /></div>
            <p className="kicker">{s.n}</p>
            <h3>{s.title}</h3>
            <p className="anat-body">{s.body}</p>
            <p className="anat-live"><i className="live" /> <span>{s.live}</span></p>
          </li>
        ))}
      </ol>
      {ex.data?.env && <EnvelopeMap env={ex.data.env} c={ex.data.c} batch={ex.data.batch.id} />}
      {ex.data?.tx && (
        <p className="anat-foot">
          See a real one: <Link to={`/tx/${ex.data.tx}`}>the latest sealed order's transaction</Link>, decoded from the L1.
        </p>
      )}
    </section>
  );
}

// ------------------------------------------------------------------------------------------------ 3. compared
type Mark = "bad" | "mid" | "good";
interface Row { venue: string; kind: string; before: [Mark, string]; after: [Mark, string]; trust: string; price: string; src: number[] }
const ROWS: Row[] = [
  { venue: "Hyperliquid", kind: "Order book on its own L1", before: ["bad", "Public book; open orders readable by address"], after: ["bad", "Public: size, price and both addresses"], trust: "Its validators; anyone reads the book", price: "Continuous order book", src: [1, 2] },
  { venue: "dYdX v4", kind: "Order book appchain", before: ["bad", "In every node's memory; public depth"], after: ["bad", "Public trades feed"], trust: "The block proposer (dYdX on MEV)", price: "Continuous order book", src: [3, 4] },
  { venue: "Dexalot", kind: "Order book on its own Avalanche L1", before: ["bad", "On-chain order book"], after: ["bad", "On-chain fills"], trust: "Its L1's validators", price: "Continuous order book", src: [5, 6] },
  { venue: "AMMs via a public mempool", kind: "e.g. Uniswap-style, LFJ on the C-Chain", before: ["bad", "Pending swaps sit in the mempool"], after: ["bad", "Public"], trust: "Searchers can sandwich you", price: "AMM curve", src: [7, 8, 9] },
  { venue: "CoW Protocol", kind: "Batch auction of intents", before: ["mid", "Seen by solvers and the order API"], after: ["bad", "Trade event logs the amounts"], trust: "Bonded solvers", price: "Uniform price per batch", src: [10, 11, 12] },
  { venue: "Shutter (Gnosis Chain)", kind: "Encrypted mempool; shuts down Nov 25, 2026", before: ["good", "Encrypted until inclusion"], after: ["bad", "Decrypted and executed in the open"], trust: "4 of 7 keypers", price: "Whatever app it feeds", src: [13, 14, 19] },
  { venue: "Renegade", kind: "Dark pool (MPC + ZK)", before: ["mid", "Hidden from the public; your relayer sees it"], after: ["good", "Hidden for internal matches"], trust: "Your relayer", price: "Pegged to the Binance midpoint", src: [15, 16] },
  { venue: "Penumbra", kind: "Shielded chain with a DEX", before: ["mid", "Input amount burned publicly, identity shielded"], after: ["mid", "Amounts public, not linked to you"], trust: "No operator; sealed-bid swaps are \"a future upgrade\"", price: "One price per block batch", src: [17] },
  { venue: "Railgun", kind: "Private balances, swaps via public DEXs", before: ["mid", "The swap leg hits a public DEX"], after: ["mid", "Amount visible, not linked to you"], trust: "Broadcasters; the DEX leg is exposed", price: "The external DEX's", src: [18] },
];
export const SOURCES: [string, string][] = [
  ["Hyperliquid docs: order book", "https://hyperliquid.gitbook.io/hyperliquid-docs/trading/order-book"],
  ["Hyperliquid API: info endpoint (openOrders, userFills)", "https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint"],
  ["dYdX docs: limit order book", "https://docs.dydx.xyz/concepts/trading/limit-orderbook"],
  ["dYdX: update on MEV", "https://www.dydx.xyz/blog/update-on-mev"],
  ["Dexalot contracts (own L1)", "https://github.com/Dexalot/contracts"],
  ["Avalanche: Dexalot launches the first CLOB subnet", "https://www.avalanche.com/blog/dexalot-launches-first-central-limit-order-book-subnet-on-avalanche-with-1m-in-incentives"],
  ["Zhou et al., sandwich attacks (arXiv 2009.14021)", "https://arxiv.org/abs/2009.14021"],
  ["Avalanche Builder Hub: P2P network anomalies (C-Chain mempool)", "https://build.avax.network/blog/p2p-network-anomalies"],
  ["LFJ docs: Liquidity Book is an AMM", "https://github.com/lfj-gg/joe-docs"],
  ["CoW docs: batch auctions", "https://docs.cow.fi/cow-protocol/concepts/introduction/batch-auctions"],
  ["CoW order book API (openapi.yml)", "https://raw.githubusercontent.com/cowprotocol/services/main/crates/orderbook/openapi.yml"],
  ["CoW settlement contract: Trade event", "https://raw.githubusercontent.com/cowprotocol/contracts/main/src/contracts/GPv2Settlement.sol"],
  ["Shutter: shutterized Gnosis Chain (4 of 7 keypers)", "https://blog.shutter.network/shutterized-gnosis-chain-is-now-live/"],
  ["Shutter docs: the road to an encrypted mempool", "https://docs.shutter.network/docs/shutter/research/the_road_towards_an_encrypted_mempool_on_ethereum"],
  ["Renegade docs: privacy", "https://docs.renegade.fi/concepts/privacy"],
  ["Renegade docs: MPC and ZK proofs", "https://docs.renegade.fi/concepts/mpc-zkp"],
  ["Penumbra protocol: swaps", "https://protocol.penumbra.zone/main/dex/swap.html"],
  ["Railgun docs: DEX swaps", "https://docs.railgun.org/wiki/learn/railway-dex-swaps"],
  ["Shutter: decommissioning the encrypted mempool on Gnosis Chain", "https://blog.shutter.network/decommissioning-the-encrypted-mempool-on-gnosis-chain/"],
];
const MarkCell = ({ m }: { m: [Mark, string] }) => (
  <span className={`cmp-m cmp-${m[0]}`}>
    <i aria-hidden="true">{m[0] === "good" ? "●" : m[0] === "mid" ? "◐" : "○"}</i>
    {m[1]}
  </span>
);

export function Compare() {
  return (
    <section className="l-sec" id="compare" aria-labelledby="cmp-h">
      <header className="l-head cmp-head">
        <div>
          <p className="kicker">Compared</p>
          <h2 id="cmp-h">Other venues show your order, or your size. Ofel shows neither.</h2>
          <p className="cmp-sub">What each design leaks, and whom you trust instead. Every row is from the venue's own docs or published research; sources below.</p>
        </div>
        <div className="cmp-art" aria-hidden="true">
          <img src="/art/ladder.webp" alt="" width={640} height={640} />
          <img src="/art/vault.webp" alt="" width={640} height={640} />
        </div>
      </header>
      <div className="pnl">
        <div className="tbl-wrap">
          <table className="tbl cmp-tbl" data-film="compare">
            <thead>
              <tr>
                <th>Venue</th>
                <th>Your order before it fills</th>
                <th>Your size after it fills</th>
                <th>Who can peek, or whom you trust</th>
                <th>Price</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r) => (
                <tr key={r.venue}>
                  <td>
                    <b>{r.venue}</b>
                    <small>{r.kind}{" "}{r.src.map((n) => <a key={n} className="cmp-src" href={SOURCES[n - 1][1]} target="_blank" rel="noreferrer">[{n}]</a>)}</small>
                  </td>
                  <td><MarkCell m={r.before} /></td>
                  <td><MarkCell m={r.after} /></td>
                  <td>{r.trust}</td>
                  <td>{r.price}</td>
                </tr>
              ))}
              <tr className="cmp-ofel" data-film="compare-ofel">
                <td>
                  <b>Ofel</b>
                  <small>Sealed batches on its own Avalanche L1</small>
                </td>
                <td><MarkCell m={["good", "Sealed until the close; opens only with 2 of 3 validator signatures"]} /></td>
                <td><MarkCell m={["good", "Never public: commitments, only totals"]} /></td>
                <td>2 of 3 validators (today on one VPS); the clearing agent settles and audits</td>
                <td>One price per batch</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <div className="cmp-trade">
        <div className="cmp-trade-card">
          <img className="cmp-trade-art" src="/art/key.webp" alt="" aria-hidden width={640} height={640} />
          <h3>Ofel's trade-offs, plainly</h3>
          <ul>
            <li><b>The seal is 2 of 3.</b> Two colluding validators could sign the close early. All three run on one VPS today, so in practice that's one operator; production needs independent ones.</li>
            <li><b>The clearing agent is trusted to settle.</b> It submits totals (checked on-chain against the commitments), pays out the legs, and holds the auditor key, which reads sizes from the close on.</li>
            <li><b>Side and limit become public at the close</b>, so the price can be checked. Totals are public too; single sizes never are.</li>
            <li><b>Testnet only.</b> Fuji L1, test tokens, no range proof on-chain yet, and a batch clock of about 90 seconds.</li>
          </ul>
        </div>
        <ol className="cmp-sources">
          {SOURCES.map(([t, u], i) => (
            <li key={u}><a href={u} target="_blank" rel="noreferrer"><span className="mono">[{i + 1}]</span> {t}</a></li>
          ))}
        </ol>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------------------------------------ 4. proof
const clearedEv = parseAbiItem("event BatchCleared(uint256 indexed batchId, uint64 price, uint64 buyTotal, uint64 sellTotal, uint32 filled)");

async function latestClearReceipt() {
  const head = await client.getBlockNumber();
  const logs = await client.getLogs({ address: cfg.book, event: clearedEv, fromBlock: 0n, toBlock: head });
  const l = logs.filter((x) => (x.args.price as bigint) > 0n).at(-1) ?? logs.at(-1);
  if (!l) return { head, rc: undefined, ev: undefined };
  const rc = await client.getTransactionReceipt({ hash: l.transactionHash });
  return { head, rc, ev: l.args as { batchId: bigint; price: bigint; buyTotal: bigint; sellTotal: bigint; filled: number } };
}

export function ProofPanels() {
  const chainId = useLive(() => client.getChainId(), [], 0);
  const r = useLive(latestClearReceipt, [], 8000);
  const rc = r.data?.rc;
  const cmd = rc ? `cast receipt ${rc.transactionHash} --rpc-url ${cfg.rpc}` : "";
  return (
    <div className="prf">
      <article className="prf-card prf-rpc dark" data-film="proof-rpc">
        <img src="/art/node.webp" alt="" aria-hidden width={640} height={640} className="prf-art" />
        <span className="label">Public RPC · anyone can query it</span>
        <code className="prf-url">{cfg.rpc}</code>
        <dl className="prf-kv">
          <div><dt>eth_chainId</dt><dd className="num">{chainId.data != null ? `${chainId.data} (0x${chainId.data.toString(16)})` : "…"}</dd></div>
          <div><dt>eth_blockNumber</dt><dd className="num">{r.data ? `#${r.data.head.toString()}` : "…"}</dd></div>
          <div><dt>Warp API</dt><dd>enabled on all 3 validators</dd></div>
        </dl>
        <div className="prf-cmd"><code>{`cast block-number --rpc-url ${cfg.rpc}`}</code><Hash v={`cast block-number --rpc-url ${cfg.rpc}`} label="copy" /></div>
        <p className="prf-note">No hosted explorer indexes this L1's own transactions yet, so the desk has its own explorer page that reads this RPC, and every hash on the site checks with <code>cast receipt</code>.</p>
      </article>
      <article className="prf-card prf-rc dark" data-film="proof-receipt">
        <img src="/art/receipt.webp" alt="" aria-hidden width={640} height={640} className="prf-art" />
        <span className="label">The latest clear, as its receipt reads · live</span>
        {rc && r.data?.ev ? (
          <>
            <dl className="prf-kv prf-big">
              <div><dt>status</dt><dd className={rc.status === "success" ? "up" : "down"}>{rc.status === "success" ? "1 (success)" : "0 (reverted)"}</dd></div>
              <div><dt>blockNumber</dt><dd className="num">{rc.blockNumber.toString()}</dd></div>
              <div><dt>from</dt><dd className="mono">{short(rc.from, 4)} <em>clearing agent</em></dd></div>
              <div><dt>to</dt><dd className="mono">{short(rc.to ?? "", 4)} <em>OfelBook</em></dd></div>
              <div><dt>event</dt><dd className="mono">BatchCleared #{r.data.ev.batchId.toString()} · price {fix(Number(r.data.ev.price) / 100)} · totals {units(r.data.ev.buyTotal)} / {units(r.data.ev.sellTotal)}</dd></div>
            </dl>
            <div className="prf-cmd"><code>{cmd}</code><Hash v={cmd} label="copy" /></div>
            <Link className="btn btn-primary btn-sm" to={`/tx/${rc.transactionHash}`}>Open it in the L1 explorer <Icon name="arrow" size={14} /></Link>
          </>
        ) : (
          <p className="dim">{r.error ? `L1 unreachable: ${r.error}` : "Reading the latest clear…"}</p>
        )}
      </article>
    </div>
  );
}

export type { Hex };
