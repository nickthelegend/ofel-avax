// Sandwich lab: what a mempool bot does to a public AMM swap, next to what it can read of a sealed Ofel order.
// The AMM half reads a LOCAL Anvil fork of the Fuji C-Chain (scripts/sandwich/*, default http://127.0.0.1:8546,
// `?rpc=` to override). The Ofel half reads the real Ofel L1. Every number on this page comes from those two chains.
import { createPublicClient, decodeFunctionData, http, parseAbi, type Hex } from "viem";
import { cfg } from "../lib/config";
import { client, bookAbi as BOOK_ABI_FOR_LAB } from "../lib/chain";
import { useLive } from "../lib/hooks";
import { short } from "../lib/format";
import { Hash, Skel, State } from "../components/ui";

type Dep = { pool: Hex; tAVAX: Hex; tUSDC: Hex; bot: Hex; victim: Hex; deployer: Hex; forkBlock: string; rpc: string; network: string };
const found = import.meta.glob("../../../deployments/sandwich-local.json", { eager: true, import: "default" }) as Record<string, Dep>;
const DEP: Dep | undefined = Object.values(found)[0];

const params = new URLSearchParams(typeof location !== "undefined" ? location.search : "");
const RPC = params.get("rpc") ?? DEP?.rpc ?? "http://127.0.0.1:8546";
const POOL = (params.get("pool") as Hex | null) ?? DEP?.pool;
const PIN_OFEL_TX = params.get("otx") as Hex | null;

const anvil = createPublicClient({ transport: http(RPC) });
const poolAbi = parseAbi([
  "function reserve0() view returns (uint256)",
  "function reserve1() view returns (uint256)",
  "function token0() view returns (address)",
  "function getAmountOut(address tokenIn, uint256 amountIn) view returns (uint256)",
  "event Swap(address indexed sender, address indexed tokenIn, uint256 amountIn, uint256 amountOut, address indexed to, uint256 reserve0, uint256 reserve1)",
]);

const n18 = (v: bigint) => Number(v) / 1e18;
const usd = (v: number, dp = 2) => v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });

interface SwapRow {
  tx: Hex;
  block: bigint;
  index: number;
  from: Hex;
  buy: boolean;
  amountIn: bigint;
  amountOut: bigint;
  role: "front" | "victim" | "back" | "plain";
  quotedOut?: bigint;
}

async function readPool() {
  if (!POOL) throw new Error("Setup required: no deployments/sandwich-local.json (run scripts/sandwich/setup.ts)");
  const chainId = await anvil.getChainId();
  const [r0, r1, t0, head] = await Promise.all([
    anvil.readContract({ address: POOL, abi: poolAbi, functionName: "reserve0" }),
    anvil.readContract({ address: POOL, abi: poolAbi, functionName: "reserve1" }),
    anvil.readContract({ address: POOL, abi: poolAbi, functionName: "token0" }),
    anvil.getBlockNumber(),
  ]);
  const from = DEP ? BigInt(DEP.forkBlock) + 1n : head > 500n ? head - 500n : 0n;
  const logs = await anvil.getLogs({ address: POOL, event: poolAbi[4], fromBlock: from, toBlock: head });
  const rows: SwapRow[] = [];
  for (const l of logs) {
    const tx = await anvil.getTransaction({ hash: l.transactionHash });
    rows.push({ tx: l.transactionHash, block: l.blockNumber, index: l.transactionIndex, from: tx.from, buy: l.args.tokenIn!.toLowerCase() !== t0.toLowerCase(), amountIn: l.args.amountIn!, amountOut: l.args.amountOut!, role: "plain" });
  }
  // A sandwich: one sender trades before and after another sender, in the same block.
  const blocks = new Map<bigint, SwapRow[]>();
  for (const r of rows) blocks.set(r.block, [...(blocks.get(r.block) ?? []), r]);
  for (const list of blocks.values()) {
    list.sort((a, b) => a.index - b.index);
    for (let i = 0; i < list.length; i++)
      for (let k = i + 2; k < list.length; k++)
        if (list[i].from === list[k].from)
          for (let j = i + 1; j < k; j++)
            if (list[j].from !== list[i].from) {
              list[i].role = "front";
              list[j].role = "victim";
              list[k].role = "back";
            }
  }
  // The victim's quote: what the same swap returned against the pool one block earlier (historical eth_call).
  const sorted = [...blocks.entries()].sort((a, b) => (a[0] > b[0] ? -1 : 1));
  for (const [blk, list] of sorted.slice(0, 6)) {
    const firstOf = list.filter((r) => r.role === "victim" || (r.role === "plain" && r.from === list[0].from && r === list[0]));
    for (const r of firstOf) {
      r.quotedOut = await anvil.readContract({ address: POOL, abi: poolAbi, functionName: "getAmountOut", args: [r.buy ? (DEP?.tUSDC as Hex) : t0, r.amountIn], blockNumber: blk - 1n }).catch(() => undefined);
    }
  }
  return { chainId, r0, r1, head, blocks: sorted.map(([block, list]) => ({ block, list })) };
}

async function readOfel() {
  const head = await client.getBlockNumber();
  let hash = PIN_OFEL_TX;
  let batchId: bigint | undefined;
  if (!hash) {
    for (let to = head, i = 0; i < 6 && !hash; i++, to -= 2000n) {
      const logs = await client.getContractEvents({ address: cfg.book, abi: BOOK_ABI_FOR_LAB, eventName: "OrderSealed", fromBlock: to > 2000n ? to - 2000n : 0n, toBlock: to });
      const l = logs.at(-1);
      if (l) hash = l.transactionHash;
    }
  }
  if (!hash) return undefined;
  const tx = await client.getTransaction({ hash });
  const call = decodeFunctionData({ abi: BOOK_ABI_FOR_LAB, data: tx.input });
  const [bid, commitment, cx, cy, envelope] = call.args as [bigint, Hex, bigint, bigint, Hex];
  batchId = bid;
  const b = (await client.readContract({ address: cfg.book, abi: BOOK_ABI_FOR_LAB, functionName: "getBatch", args: [batchId] })) as { closeAt: bigint; state: number; orderCount: number };
  return { hash, trader: tx.from, block: tx.blockNumber, batchId, commitment, cx, cy, envelope, closeAt: b.closeAt, state: b.state, orders: b.orderCount };
}

const ROLE: Record<SwapRow["role"], { label: string; cls: string }> = {
  front: { label: "Bot front-run", cls: "spill spill-down" },
  victim: { label: "Victim", cls: "spill sw-victim" },
  back: { label: "Bot back-run", cls: "spill spill-down" },
  plain: { label: "Swap", cls: "spill sw-plain" },
};
const who = (a: Hex) => (DEP && a.toLowerCase() === DEP.bot.toLowerCase() ? "bot" : DEP && a.toLowerCase() === DEP.victim.toLowerCase() ? "victim" : DEP && a.toLowerCase() === DEP.deployer.toLowerCase() ? "deployer" : "wallet");

function SwapTable({ list }: { list: SwapRow[] }) {
  return (
    <div className="tbl-wrap">
      <table className="tbl sw-tbl">
        <thead>
          <tr>
            <th>Pos</th>
            <th>Role</th>
            <th>From</th>
            <th>Swap</th>
            <th>Price <i>tUSDC per tAVAX</i></th>
            <th>Tx <i>cast receipt</i></th>
          </tr>
        </thead>
        <tbody>
          {list.map((r) => {
            const avax = r.buy ? r.amountOut : r.amountIn;
            const usdc = r.buy ? r.amountIn : r.amountOut;
            return (
              <tr key={r.tx} className={r.role === "victim" ? "sel" : ""}>
                <td className="num">{r.index}</td>
                <td><span className={ROLE[r.role].cls}>{ROLE[r.role].label}</span></td>
                <td className="mono">{short(r.from, 4)}<small>{who(r.from)}</small></td>
                <td className="num">
                  {r.buy ? "Buy" : "Sell"} {usd(n18(avax))} tAVAX
                  <small>{r.buy ? "paid" : "for"} {usd(n18(usdc))} tUSDC</small>
                </td>
                <td className="num">
                  {(n18(usdc) / n18(avax)).toFixed(4)}
                  {r.quotedOut !== undefined && r.buy && <small>quoted {(n18(r.amountIn) / n18(r.quotedOut)).toFixed(4)}</small>}
                </td>
                <td><Hash v={r.tx} n={5} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function Sandwich() {
  const p = useLive(readPool, [], 2000);
  const o = useLive(readOfel, [], 4000);
  const latestSandwich = p.data?.blocks.find((b) => b.list.some((r) => r.role === "victim"));
  const v = latestSandwich?.list.find((r) => r.role === "victim");
  const f = latestSandwich?.list.find((r) => r.role === "front");
  const bk = latestSandwich?.list.find((r) => r.role === "back");
  const quotedPrice = v?.quotedOut ? n18(v.amountIn) / n18(v.quotedOut) : undefined;
  const paidPrice = v ? n18(v.amountIn) / n18(v.amountOut) : undefined;
  const lostAvax = v?.quotedOut ? n18(v.quotedOut - v.amountOut) : undefined;
  const lostUsdc = lostAvax !== undefined && quotedPrice ? lostAvax * quotedPrice : undefined;
  const profit = f && bk ? n18(bk.amountOut) - n18(f.amountIn) : undefined;
  const others = p.data?.blocks.filter((b) => b !== latestSandwich).slice(0, 4) ?? [];
  const left = o.data ? Number(o.data.closeAt) - Math.floor(Date.now() / 1000) : undefined;

  return (
    <main className="order" id="main">
      <header className="board-head">
        <span className="kicker">Sandwich lab</span>
        <h1>A public swap gets sandwiched. A sealed order can't be.</h1>
        <p>A bot reads a pending swap's size and side from the mempool, buys first, lets the victim buy at the worse price, then sells. The same bot pointed at Ofel finds only ciphertext.</p>
      </header>
      <p className="banner banner-demo sw-banner" data-film="sandwich-banner">
        AMM side: local Anvil fork of Fuji C-Chain, block time 4 s, public test keys. Ofel side: the live Ofel L1 on Fuji. Every number read from the chain.
      </p>

      {p.error && (
        <div className="pnl">
          <State kind="setup" title="Start the local Anvil fork">
            {p.error.includes("Setup required") ? p.error : `No Anvil fork at ${RPC}. Run scripts/sandwich/anvil.sh, then node scripts/sandwich/setup.ts. (${p.error})`}
          </State>
        </div>
      )}
      {!p.data && !p.error && (
        <div className="skels">
          <Skel h={120} />
          <Skel h={60} />
        </div>
      )}

      {p.data && (
        <>
          <div className="order-hero">
            <section className="verdict dark" data-film="sandwich-verdict">
              <span className="label">{v ? `Victim in block #${latestSandwich!.block}` : "No sandwich yet"}</span>
              {v && lostUsdc !== undefined ? (
                <>
                  <p className="verdict-big down">
                    −{usd(lostUsdc)} <span className="dim">tUSDC</span>
                  </p>
                  <p className="verdict-note">
                    Quoted {quotedPrice!.toFixed(4)}, paid {paidPrice!.toFixed(4)} tUSDC per tAVAX ({(((paidPrice! - quotedPrice!) / quotedPrice!) * 100).toFixed(2)}% worse): {usd(lostAvax!)} tAVAX fewer for the same {usd(n18(v.amountIn), 0)} tUSDC.
                    {profit !== undefined && <> The bot kept <b className="up">{usd(profit)} tUSDC</b>.</>}
                  </p>
                </>
              ) : (
                <p className="verdict-note">Run <span className="mono">scripts/sandwich/run-demo.sh attacked</span>: the bot watches the mempool and the victim swaps.</p>
              )}
            </section>
            <section className="pnl osum">
              <header>
                <div>
                  <span className="label">Demo pool · x·y=k, 0.3% fee</span>
                  <h1 className="num">{(n18(p.data.r1) / n18(p.data.r0)).toFixed(4)}</h1>
                </div>
                <span className="st up"><i />block #{p.data.head.toString()}</span>
              </header>
              <dl className="osum-grid">
                <div><dt>tAVAX in pool</dt><dd className="num">{usd(n18(p.data.r0), 0)}</dd></div>
                <div><dt>tUSDC in pool</dt><dd className="num">{usd(n18(p.data.r1), 0)}</dd></div>
                <div><dt>Pool</dt><dd>{POOL ? <Hash v={POOL} /> : "—"}</dd></div>
                <div><dt>Fork of Fuji at</dt><dd className="num">#{DEP?.forkBlock ?? "—"}</dd></div>
              </dl>
            </section>
          </div>

          {latestSandwich && (
            <section className="order-sec" data-film="sandwich-block">
              <h2>Block #{latestSandwich.block.toString()}, in execution order <small className="dim">Swap events</small></h2>
              <div className="pnl">
                <SwapTable list={latestSandwich.list} />
              </div>
            </section>
          )}

          {others.length > 0 && (
            <section className="order-sec" data-film="sandwich-earlier">
              <h2>Earlier blocks <small className="dim">a swap alone pays its quote</small></h2>
              <div className="pnl">
                <SwapTable list={others.flatMap((b) => b.list)} />
              </div>
            </section>
          )}
          <p className="dim sw-note">
            No explorer indexes a local fork. Copy a hash and check it: <span className="mono">cast receipt &lt;hash&gt; --rpc-url {RPC}</span>
          </p>
        </>
      )}

      <section className="order-sec" data-film="sandwich-ofel">
        <h2>The same bot, reading Ofel <small className="dim">live Ofel L1 · chain {cfg.chainId}</small></h2>
        <div className="pnl sw-ofel">
          {o.error && <State kind="error" title="Ofel L1 unreachable">{o.error}</State>}
          {!o.data && !o.error && <div className="skels"><Skel h={80} /></div>}
          {o.data === undefined && !o.error && !o.loading && <State kind="empty" title="No sealed order found in recent blocks" />}
          {o.data && (
            <>
              <div className="sw-ofel-head">
                <span className="label">Latest sealed order · batch #{o.data.batchId.toString()}</span>
                <span className="st">{o.data.state === 1 ? `Open · closes in ${Math.max(0, left!)} s` : o.data.state === 2 ? "Closed · opening" : "Cleared"}</span>
              </div>
              <dl className="sw-read">
                <div><dt>What the bot can read</dt><dd>submitOrder(batchId, commitment, cx, cy, envelope)</dd></div>
                <div><dt>Commitment</dt><dd className="mono">{short(o.data.commitment, 10)}</dd></div>
                <div><dt>Size</dt><dd className="mono">Pedersen point ({short("0x" + o.data.cx.toString(16), 6)}, {short("0x" + o.data.cy.toString(16), 6)})</dd></div>
                <div><dt>Envelope</dt><dd className="mono">{(o.data.envelope.length - 2) / 2} bytes · {"0x" + o.data.envelope.slice(2 + 128, 2 + 128 + 24)}… (ciphertext)</dd></div>
                <div className="sw-no"><dt>Side</dt><dd>Unreadable until the close</dd></div>
                <div className="sw-no"><dt>Size</dt><dd>Unreadable: only a commitment</dd></div>
                <div className="sw-no"><dt>Bot's move</dt><dd>Nothing to front-run, nothing to back-run</dd></div>
                <div><dt>Tx on the Ofel L1</dt><dd><a className="tx" href={`/tx/${o.data.hash}`}>{short(o.data.hash, 6)}</a></dd></div>
              </dl>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
