// App shell, forked from Eidolon's: a porcelain header with pill nav, the network line and the wallet, then the page.
import { useEffect, useRef, useState } from "react";
import { cfg } from "./lib/config";
import { client } from "./lib/chain";
import { useLive } from "./lib/hooks";
import { QA_ROLES, ROLE_LABEL, useWallet } from "./lib/wallet";
import { short } from "./lib/format";
import { Icon, Link, Logo, State, usePath } from "./components/ui";
import { Landing } from "./pages/Landing";
import { Desk } from "./pages/Desk";
import { Batches } from "./pages/Batches";
import { Portfolio } from "./pages/Portfolio";
import { Auditor } from "./pages/Auditor";
import { Validators } from "./pages/Validators";
import { Tx } from "./pages/Tx";
import { Sandwich } from "./pages/Sandwich";

const NAV = [
  { to: "/desk", label: "Desk" },
  { to: "/batches", label: "Batches" },
  { to: "/portfolio", label: "Portfolio" },
  { to: "/validators", label: "Validators" },
  { to: "/auditor", label: "Auditor" },
  { to: "/sandwich", label: "Sandwich lab" },
];

const TITLES: Record<string, string> = { desk: "Desk", batches: "Batches", portfolio: "Portfolio", validators: "Validators", auditor: "Auditor", tx: "Transaction", sandwich: "Sandwich lab" };

function WalletButton() {
  const w = useWallet();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const on = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", on);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", on);
      document.removeEventListener("keydown", key);
    };
  }, []);
  return (
    <div className="wallet" ref={ref}>
      {w.address ? (
        <button className="addr-pill" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu" data-film="wallet">
          <img className="avatar" src="/art/key.webp" alt="" width={26} height={26} />
          <span className="mono">{short(w.address)}</span>
          <span className="dim hide-sm">{w.isTest ? (w.address.toLowerCase() === cfg.agent.toLowerCase() ? "auditor key" : "test wallet") : w.isAgent ? "auditor" : ""}</span>
        </button>
      ) : (
        <button className="btn btn-primary btn-sm" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu" data-film="connect">
          Connect
        </button>
      )}
      {open && (
        <div className="menu" role="menu">
          {w.address && (
            <div className="menu-note">
              <b>{w.label}</b>
              <span className="mono">{w.address}</span>
            </div>
          )}
          {cfg.faucet && (
            <button role="menuitem" onClick={() => (w.connectTest(), setOpen(false))} data-film="menu-test-wallet">
              <span>
                <b>Test wallet</b>
                <small>a new key in this browser · free test funds</small>
              </span>
              <Icon name="arrow" size={14} />
            </button>
          )}
          <button role="menuitem" onClick={() => (w.connectInjected(), setOpen(false))}>
            <span>
              <b>Browser wallet</b>
              <small>adds the Ofel L1 (chain {cfg.chainId})</small>
            </span>
            <Icon name="wallet" size={14} />
          </button>
          {QA_ROLES.map((r) => (
            <button key={r} role="menuitem" onClick={() => (w.useQa(r), setOpen(false))}>
              <span>
                <b>{ROLE_LABEL[r]}</b>
                <small>local key</small>
              </span>
            </button>
          ))}
          {w.address && (
            <button role="menuitem" onClick={() => (w.disconnect(), setOpen(false))}>
              <span>
                <b>Disconnect</b>
              </span>
              <Icon name="x" size={14} />
            </button>
          )}
          {!QA_ROLES.length && !cfg.faucet && <div className="menu-note">No test wallet on this network.</div>}
        </div>
      )}
    </div>
  );
}

function Net() {
  const h = useLive(() => client.getBlockNumber(), [], 4000);
  return (
    <span className={`net ${h.error ? "" : "net-live"}`} title={cfg.rpc}>
      <i className={h.error ? "off" : "live"} />
      {h.error ? "Ofel L1 unreachable" : cfg.fuji ? "LIVE · Ofel L1 on Fuji" : cfg.networkLabel}
      {h.data !== undefined && <span className="dim">#{h.data.toString()}</span>}
    </span>
  );
}

export function App() {
  const path = usePath();
  const w = useWallet();
  const seg = path.split("/")[1] ?? "";
  useEffect(() => {
    document.title = seg ? `Ofel · ${TITLES[seg] ?? "Not found"}` : "Ofel · Trade size without being front-run";
  }, [seg]);

  if (path === "/") return <div className="site"><a className="skip" href="#main">Skip to content</a><Landing /></div>;

  const page = path.startsWith("/desk") ? <Desk /> : path.startsWith("/batches") ? <Batches path={path} /> : path.startsWith("/portfolio") ? <Portfolio /> : path.startsWith("/auditor") ? <Auditor /> : path.startsWith("/validators") ? <Validators /> : path.startsWith("/tx/") ? <Tx path={path} /> : path.startsWith("/sandwich") ? <Sandwich /> : null;
  return (
    <div className="app">
      <a className="skip" href="#main">Skip to content</a>
      <header className="ahead">
        <Logo />
        <nav className="ahead-nav" aria-label="App">
          {NAV.map((n) => (
            <Link key={n.to} to={n.to} current={path.startsWith(n.to)}>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="ahead-right">
          <Net />
          <WalletButton />
        </div>
      </header>
      <nav className="mnav" aria-label="App sections">
        {NAV.map((n) => (
          <Link key={n.to} to={n.to} current={path.startsWith(n.to)}>
            {n.label}
          </Link>
        ))}
      </nav>
      {w.error && <p className="banner" role="alert">{w.error}</p>}
      {page ?? (
        <main className="order" id="main">
          <State kind="empty" art="empty" title="No page at this address" action={<Link to="/desk" className="btn btn-primary btn-sm">Go to the desk</Link>} />
        </main>
      )}
      <footer className="term-foot mono">
        <span>
          <i className="live" />
          Chain reads: Ofel L1 {cfg.chainId} · P-Chain Fuji
        </span>
        <span>Reference: Chainlink {cfg.market.id}/USD on Fuji · Coinbase · market {cfg.market.base} / tUSDC</span>
        <span>Private balances: eERC (Ava Labs)</span>
                <span>UI forked from Eidolon · art generated with ChatGPT</span>
      </footer>
    </div>
  );
}
