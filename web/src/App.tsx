import { useEffect, useRef, useState } from "react";
import { cfg } from "./lib/config";
import { client } from "./lib/chain";
import { useLive } from "./lib/hooks";
import { QA_ROLES, ROLE_LABEL, useWallet } from "./lib/wallet";
import { short } from "./lib/format";
import { Icons, Link, usePath } from "./components/ui";
import { Landing } from "./pages/Landing";
import { Desk } from "./pages/Desk";
import { Batches } from "./pages/Batches";
import { Portfolio } from "./pages/Portfolio";
import { Auditor } from "./pages/Auditor";
import { Validators } from "./pages/Validators";

const NAV = [
  { to: "/desk", label: "Desk", icon: Icons.desk },
  { to: "/batches", label: "Batches", icon: Icons.batches },
  { to: "/portfolio", label: "Portfolio", icon: Icons.fills },
  { to: "/auditor", label: "Auditor", icon: Icons.auditor },
  { to: "/validators", label: "Validators", icon: Icons.validators },
];

function WalletButton() {
  const w = useWallet();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const on = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", on);
    return () => document.removeEventListener("mousedown", on);
  }, []);
  return (
    <div className="wallet" ref={ref}>
      <button className={w.address ? "btn sm" : "btn sm primary"} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu">
        {w.address ? (
          <>
            <span className="dot" />
            <span className="mono">{short(w.address)}</span>
          </>
        ) : (
          "Connect"
        )}
      </button>
      {open && (
        <div className="menu" role="menu">
          {w.address && (
            <>
              <div className="note">
                {w.label}
                <br />
                <span className="mono">{w.address}</span>
              </div>
              <div className="sep" />
            </>
          )}
          {QA_ROLES.map((r) => (
            <button key={r} role="menuitem" onClick={() => (w.useQa(r), setOpen(false))}>
              {ROLE_LABEL[r]}
              <span className="faint mono" style={{ fontSize: 12 }}>local key</span>
            </button>
          ))}
          {cfg.faucet && (
            <button role="menuitem" onClick={() => (w.connectTest(), setOpen(false))}>
              Test wallet
              <span className="faint" style={{ fontSize: 12 }}>new key in this browser</span>
            </button>
          )}
          <button role="menuitem" onClick={() => (w.connectInjected(), setOpen(false))}>
            Browser wallet
          </button>
          {w.address && (
            <>
              <div className="sep" />
              <button role="menuitem" onClick={() => (w.disconnect(), setOpen(false))}>
                Disconnect
              </button>
            </>
          )}
          {!QA_ROLES.length && !cfg.faucet && <div className="note">The recorded demo uses the QA build, which carries local test signers.</div>}
        </div>
      )}
    </div>
  );
}

function NetPill() {
  const h = useLive(() => client.getBlockNumber(), [], 4000);
  return (
    <span className="netpill wide" title={cfg.rpc}>
      <span className={h.error ? "dot off" : "dot"} />
      {h.error ? "L1 unreachable" : cfg.networkLabel}
      {h.data !== undefined && <span className="faint mono">#{h.data.toString()}</span>}
    </span>
  );
}

export function App() {
  const path = usePath();
  const w = useWallet();
  const page = path === "/" ? <Landing /> : path.startsWith("/desk") ? <Desk /> : path.startsWith("/batches") ? <Batches path={path} /> : path.startsWith("/portfolio") ? <Portfolio /> : path.startsWith("/auditor") ? <Auditor /> : path.startsWith("/validators") ? <Validators /> : null;
  return (
    <>
      <header className="topbar">
        <Link to="/" className="brand">
          <img src="/art/mark.webp" alt="" width={28} height={28} />
          Ofel
        </Link>
        <nav className="nav" aria-label="Main">
          {NAV.map((n) => (
            <Link key={n.to} to={n.to} current={path.startsWith(n.to)}>
              {n.label}
            </Link>
          ))}
        </nav>
        <span className="spacer" />
        <NetPill />
        {path === "/" ? (
          <Link to="/desk" className="btn sm primary">
            Open the desk
          </Link>
        ) : (
          <WalletButton />
        )}
      </header>
      {w.error && path !== "/" && (
        <div style={{ maxWidth: 1440, margin: "12px auto 0", padding: "0 24px" }}>
          <div className="note" role="alert">{w.error}</div>
        </div>
      )}
      <main>{page ?? <div className="page"><h1>Not found</h1><Link to="/desk">Go to the desk</Link></div>}</main>
      {path !== "/" && (
        <nav className="tabbar" aria-label="App">
          {NAV.map((n) => (
            <Link key={n.to} to={n.to} current={path.startsWith(n.to)}>
              {n.icon}
              {n.label}
            </Link>
          ))}
        </nav>
      )}
    </>
  );
}
