// A transaction on the Ofel L1, read straight from its public RPC (no hosted explorer indexes this L1's EVM).
// Every field below comes from eth_getTransactionByHash / eth_getTransactionReceipt / eth_getBlockByNumber;
// calldata and logs are decoded with the contracts' own ABIs. Nothing is cached or rewritten.
import { useState } from "react";
import { decodeEventLog, decodeFunctionData, erc20Abi, formatEther, type Abi, type Hex } from "viem";
import { registrarAbi } from "@ofel/core";
import { cfg } from "../lib/config";
import { bookAbi, client, eercAbi } from "../lib/chain";
import { useLive } from "../lib/hooks";
import { short, utc } from "../lib/format";
import { Hash, Icon, Link, Skel, State } from "../components/ui";

const LABELS: [string | undefined, string][] = [
  [cfg.book, "OfelBook"],
  [cfg.eerc, "EncryptedERC (eERC)"],
  [cfg.registrar, "eERC registrar"],
  [cfg.faucet, "OfelFaucet"],
  [cfg.tAVAX, "tAVAX (test token)"],
  [cfg.tUSDC, "tUSDC (test token)"],
  [cfg.agent, "Clearing agent + auditor"],
  [cfg.house, "House (blind quotes)"],
  ["0x0200000000000000000000000000000000000005", "Warp precompile"],
];
const labelOf = (a?: string | null) => (a ? LABELS.find(([x]) => x && x.toLowerCase() === a.toLowerCase())?.[1] : undefined);
const ABIS: [string | undefined, Abi][] = [
  [cfg.book, bookAbi],
  [cfg.eerc, eercAbi],
  [cfg.registrar, registrarAbi as Abi],
  [cfg.tAVAX, erc20Abi as Abi],
  [cfg.tUSDC, erc20Abi as Abi],
];
const abiOf = (a?: string | null) => (a ? ABIS.find(([x]) => x && x.toLowerCase() === a.toLowerCase())?.[1] : undefined);

/** What a judge should notice in each Ofel call, in plain words. */
const NOTES: Record<string, string> = {
  submitOrder: "A sealed order. The chain received an encrypted envelope and a Pedersen commitment (commitment, cx, cy) to the size. There is no side, no limit and no size in plain text anywhere in this transaction. The value is the order's refundable bond.",
  closeBatch: "Closes the batch at its close time T: the L1 emits the Warp message its validators sign. Called any earlier, it reverts with TooEarly.",
  revealOrders: "Opens the batch's orders with the validators' BLS signatures on the close message. Each reveal is checked on-chain against the order's commitment; sizes stay commitments.",
  clear: "Sets one clearing price from the revealed limits and submits the buy and sell totals, which the contract checks against the sum of the size commitments (BN254 precompiles).",
  transfer: "A private eERC transfer. No amount appears in plain text: the amounts are encrypted (balancePCT and the proof's public signals), and the Groth16 proof shows the sender can pay. Only the receiver and the auditor key can decrypt them.",
  deposit: "Moves test tokens into the encrypted ERC: from here on the balance is encrypted on-chain.",
  markSettled: "The clearing agent marks an order's legs as settled after the private transfers.",
  claimBond: "Returns the order's bond once its batch has cleared.",
};

const bytesOf = (h: string) => Math.max(0, (h.length - 2) / 2);
const isBytes = (v: unknown): v is string => typeof v === "string" && /^0x[0-9a-fA-F]*$/.test(v) && v.length > 66;

/** One decoded argument: short values in full, long byte strings as their size plus a scrollable hex box. */
function Val({ v }: { v: unknown }) {
  if (typeof v === "bigint") return <span className="num">{v.toString()}</span>;
  if (typeof v === "number") return <span className="num">{v}</span>;
  if (typeof v === "boolean") return <span className="num">{String(v)}</span>;
  if (isBytes(v))
    return (
      <span className="txv-bytes">
        <b>{bytesOf(v).toLocaleString("en-US")} bytes</b>
        <code className="ci-hex raw">{v}</code>
      </span>
    );
  if (typeof v === "string") return <span className="mono txv-str">{v}{labelOf(v) ? <em> · {labelOf(v)}</em> : null}</span>;
  if (Array.isArray(v)) {
    const flat = JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x));
    return <code className="ci-hex raw txv-arr">{flat.length > 900 ? flat.slice(0, 900) + "…" : flat}</code>;
  }
  if (v && typeof v === "object") {
    return (
      <dl className="txv-obj">
        {Object.entries(v as Record<string, unknown>).map(([k, x]) => (
          <div key={k}><dt>{k}</dt><dd><Val v={x} /></dd></div>
        ))}
      </dl>
    );
  }
  return <span className="dim">—</span>;
}

function Args({ names, args }: { names: string[]; args: readonly unknown[] | Record<string, unknown> | undefined }) {
  if (!args) return <span className="dim">no arguments</span>;
  const list = Array.isArray(args) ? args.map((a, i) => [names[i] || `arg${i}`, a] as const) : Object.entries(args);
  return (
    <dl className="txv-args">
      {list.map(([k, a]) => (
        <div key={k}><dt>{k}</dt><dd><Val v={a} /></dd></div>
      ))}
    </dl>
  );
}

async function loadTx(hash: Hex) {
  const [tx, rc] = await Promise.all([client.getTransaction({ hash }), client.getTransactionReceipt({ hash })]);
  const [blk, head] = await Promise.all([client.getBlock({ blockNumber: rc.blockNumber }), client.getBlockNumber()]);
  const abi = abiOf(tx.to);
  let call: { name: string; names: string[]; args?: readonly unknown[] } | undefined;
  if (abi) {
    try {
      const d = decodeFunctionData({ abi, data: tx.input });
      const item = (abi as unknown as { type: string; name?: string; inputs?: { name: string }[] }[]).find((x) => x.type === "function" && x.name === d.functionName);
      call = { name: d.functionName, names: item?.inputs?.map((i) => i.name) ?? [], args: d.args };
    } catch {
      /* unknown selector: the raw input below still shows */
    }
  }
  const logs = rc.logs.map((l) => {
    const a = abiOf(l.address);
    if (a) {
      try {
        const e = decodeEventLog({ abi: a, data: l.data, topics: l.topics });
        return { address: l.address, name: e.eventName, args: e.args as unknown as Record<string, unknown>, raw: l };
      } catch {
        /* fall through */
      }
    }
    return { address: l.address, name: undefined, args: undefined, raw: l };
  });
  return { tx, rc, blk, head, call, logs };
}

export function Tx({ path }: { path: string }) {
  const hash = path.split("/")[2] as Hex | undefined;
  const ok = !!hash && /^0x[0-9a-fA-F]{64}$/.test(hash);
  const t = useLive(() => (ok ? loadTx(hash!) : Promise.reject(new Error("Not a transaction hash"))), [hash], 0);
  const [rawOpen, setRawOpen] = useState(false);
  const cmd = `cast receipt ${hash ?? "<hash>"} --rpc-url ${cfg.rpc}`;
  const d = t.data;
  const success = d?.rc.status === "success";
  return (
    <main className="order txp" id="main">
      <header className="board-head">
        <span className="kicker">Ofel L1 explorer · chain {cfg.chainId}</span>
        <h1>Transaction</h1>
        <p>Read live from the L1's public RPC and decoded with the contracts' own ABIs. No hosted explorer indexes this L1 yet, so this page is the explorer, and the command below gives you the same receipt.</p>
      </header>

      {!ok && <State kind="error" title="Not a transaction hash">Use /tx/0x… with a 32-byte hash.</State>}
      {ok && t.error && <State kind="error" title="The RPC couldn't find this transaction">{t.error}</State>}
      {ok && !d && !t.error && (
        <div className="skels">
          <Skel h={48} />
          <Skel h={200} />
        </div>
      )}

      {d && (
        <>
          <section className="pnl txp-sum" data-film="tx-summary">
            <dl className="txp-grid">
              <div>
                <dt>Transaction hash</dt>
                <dd className="mono txp-hash">{d.tx.hash}<Hash v={d.tx.hash} label="copy" /></dd>
              </div>
              <div data-film="tx-status">
                <dt>Status</dt>
                <dd>
                  <span className={`txp-st ${success ? "ok" : "bad"}`}>
                    <Icon name={success ? "check" : "x"} size={14} />
                    {success ? "Success" : "Reverted"}
                  </span>
                </dd>
              </div>
              <div data-film="tx-block">
                <dt>Block</dt>
                <dd>
                  <b className="num">#{d.rc.blockNumber.toString()}</b>
                  <span className="dim"> · {(d.head - d.rc.blockNumber + 1n).toString()} confirmations · {utc(d.blk.timestamp)}</span>
                </dd>
              </div>
              <div data-film="tx-from">
                <dt>From</dt>
                <dd className="mono">{d.tx.from}{labelOf(d.tx.from) && <em className="txp-tag">{labelOf(d.tx.from)}</em>}</dd>
              </div>
              <div data-film="tx-to">
                <dt>To</dt>
                <dd className="mono">{d.tx.to ?? "contract creation"}{labelOf(d.tx.to) && <em className="txp-tag">{labelOf(d.tx.to)}</em>}</dd>
              </div>
              <div data-film="tx-method">
                <dt>Method</dt>
                <dd>{d.call ? <code className="txp-method">{d.call.name}</code> : <code className="txp-method">{d.tx.input.slice(0, 10)}</code>}</dd>
              </div>
              <div>
                <dt>Value · gas used · fee</dt>
                <dd className="num">
                  {formatEther(d.tx.value)} OFEL · {d.rc.gasUsed.toLocaleString("en-US")} gas · {formatEther(d.rc.gasUsed * d.rc.effectiveGasPrice)} OFEL
                </dd>
              </div>
            </dl>
          </section>

          {d.call && NOTES[d.call.name] && (
            <aside className="txp-note" data-film="tx-note">
              <img src={d.call.name === "transfer" ? "/art/coins.webp" : d.call.name === "submitOrder" ? "/art/vault.webp" : "/art/receipt.webp"} alt="" aria-hidden width={64} height={64} />
              <p><b>What this transaction shows.</b> {NOTES[d.call.name]}</p>
            </aside>
          )}

          <section className="order-sec" data-film="tx-input">
            <h2>Input <small className="dim">{bytesOf(d.tx.input).toLocaleString("en-US")} bytes of calldata{d.call ? `, decoded as ${d.call.name}` : ""}</small></h2>
            <div className="pnl txp-box">
              {d.call ? <Args names={d.call.names} args={d.call.args} /> : <p className="dim">This contract's ABI isn't bundled; raw input below.</p>}
              <button className="btn btn-ghost btn-xs" onClick={() => setRawOpen(!rawOpen)}>{rawOpen ? "Hide raw input" : "Raw input"}</button>
              {rawOpen && <code className="ci-hex raw">{d.tx.input}</code>}
            </div>
          </section>

          <section className="order-sec" data-film="tx-logs">
            <h2>Events <small className="dim">{d.logs.length} log{d.logs.length === 1 ? "" : "s"} in the receipt</small></h2>
            <div className="pnl txp-box">
              {d.logs.length === 0 && <p className="dim">No events.</p>}
              <ol className="txp-logs">
                {d.logs.map((l, i) => (
                  <li key={i}>
                    <header>
                      <code className="txp-method">{l.name ?? l.raw.topics[0]?.slice(0, 10) ?? "anonymous"}</code>
                      <span className="mono dim">{labelOf(l.address) ?? short(l.address, 6)}</span>
                    </header>
                    {l.args ? <Args names={[]} args={l.args} /> : <code className="ci-hex raw">{l.raw.data}</code>}
                  </li>
                ))}
              </ol>
            </div>
          </section>

          <section className="order-sec" data-film="tx-cast">
            <h2>Check it yourself <small className="dim">Foundry's cast, against the same public RPC</small></h2>
            <div className="txp-cmd">
              <code>{cmd}</code>
              <Hash v={cmd} label="copy" />
            </div>
            <p className="dim small">
              Every L1 transaction Ofel makes is listed in <Link to="/batches">Batches</Link>; P-Chain transactions are on the{" "}
              <a href={cfg.l1Page} target="_blank" rel="noreferrer">Avalanche Explorer</a>.
            </p>
          </section>
        </>
      )}
    </main>
  );
}
