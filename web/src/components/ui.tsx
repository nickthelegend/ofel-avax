// Shared bits: the path router, icons, states and values. Shapes forked from Eidolon's ui.tsx; Ofel's mark and tokens.
import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { short } from "../lib/format";

// --------------------------------------------------------------- router
export function usePath(): string {
  const [p, setP] = useState(() => window.location.pathname);
  useEffect(() => {
    const on = () => setP(window.location.pathname);
    window.addEventListener("popstate", on);
    return () => window.removeEventListener("popstate", on);
  }, []);
  return p;
}

export function go(to: string) {
  window.history.pushState({}, "", to);
  window.dispatchEvent(new PopStateEvent("popstate"));
  if (!to.includes("#")) window.scrollTo({ top: 0 });
}

export function Link({ to, children, className, current, ...rest }: { to: string; children: ReactNode; className?: string; current?: boolean; "data-film"?: string }) {
  const onClick = (e: MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    go(to);
  };
  return (
    <a href={to} onClick={onClick} className={className} aria-current={current ? "page" : undefined} {...rest}>
      {children}
    </a>
  );
}

export function useMedia(q: string) {
  const [m, setM] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [q]);
  return m;
}

// --------------------------------------------------------------- icons (Eidolon's stroke set plus Ofel's)
const paths: Record<string, string> = {
  arrow: "M5 12h14M13 6l6 6-6 6",
  back: "M19 12H5M11 6l-6 6 6 6",
  external: "M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
  check: "M5 12.5l4.5 4.5L19 7.5",
  x: "M6 6l12 12M18 6L6 18",
  lock: "M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5zM12 15v2",
  unlock: "M7 11V8a5 5 0 0 1 9.6-2M5 11h14v10H5zM12 15v2",
  up: "M12 19V5M6 11l6-6 6 6",
  down: "M12 5v14M6 13l6 6 6-6",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
  eye: "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  wallet: "M4 7a2 2 0 0 1 2-2h12v4M4 7v10a2 2 0 0 0 2 2h14V9H6a2 2 0 0 1-2-2zM16 14h.01",
  bolt: "M13 2L4 14h7l-1 8 9-12h-7z",
  shield: "M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z",
  server: "M4 5h16v6H4zM4 13h16v6H4zM8 8h.01M8 16h.01",
  copy: "M9 9h11v11H9zM5 15H4V4h11v1",
  menu: "M4 7h16M4 12h16M4 17h16",
};
export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={paths[name]} />
    </svg>
  );
}

// --------------------------------------------------------------- brand and tokens
export function Logo({ to = "/" }: { to?: string }) {
  return (
    <Link to={to} className="wordmark">
      <img className="mark" src="/art/mark.webp" alt="" width={32} height={32} />
      <b>Ofel</b>
    </Link>
  );
}

/** tAVAX: the Ofel L1's test AVAX, drawn inline (red disc, white peak). */
export function AvaxDisc({ size = 28 }: { size?: number }) {
  return (
    <svg className="tok" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="16" fill="#e84142" />
      <path fill="#fff" d="M20.3 21.6h3.1c.7 0 1.1-.8.7-1.4l-1.6-2.7c-.4-.6-1.2-.6-1.6 0l-1.5 2.7c-.3.6.1 1.4.9 1.4zM16.8 9.4c-.4-.6-1.2-.6-1.6 0l-7.3 12.2c-.4.6.1 1.4.8 1.4h3.4c.5 0 1-.3 1.2-.7l4.4-7.9c.3-.4.3-1 0-1.4z" />
    </svg>
  );
}

/** tUSDC: the Ofel L1's test dollar, drawn inline (blue disc, white dollar). */
export function UsdcDisc({ size = 28 }: { size?: number }) {
  return (
    <svg className="tok" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="16" fill="#2775ca" />
      <path fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" d="M19.6 12.6c-.4-1.4-1.8-2.2-3.6-2.2-2 0-3.5 1-3.5 2.6 0 3.6 7.4 2 7.4 5.8 0 1.7-1.6 2.8-3.9 2.8-1.9 0-3.4-.9-3.8-2.4M16 8.4v2M16 21.6v2" />
    </svg>
  );
}

export function Pair({ size = 30 }: { size?: number }) {
  return (
    <span className="pair-discs" style={{ width: size * 1.6, height: size }}>
      <AvaxDisc size={size} />
      <UsdcDisc size={size} />
    </span>
  );
}

// --------------------------------------------------------------- states and values
export function State({ kind, title, children, action, art }: { kind: "loading" | "empty" | "error" | "setup"; title: string; children?: ReactNode; action?: ReactNode; art?: string }) {
  return (
    <div className={`state state-${kind}`} role={kind === "error" ? "alert" : "status"}>
      {art ? (
        <img className="state-art" src={`/art/${art}.webp`} alt="" width={44} height={44} aria-hidden />
      ) : (
        <span className="state-mark" aria-hidden="true">
          {kind === "loading" ? <i className="pulse" /> : kind === "error" ? "!" : kind === "setup" ? <Icon name="lock" size={16} /> : <Icon name="eye" size={16} />}
        </span>
      )}
      <div>
        <h3>{title}</h3>
        {children && <p>{children}</p>}
        {action}
      </div>
    </div>
  );
}

export function Skel({ w = "100%", h = 14 }: { w?: string; h?: number }) {
  return <div className="skel" style={{ width: w, height: h }} aria-hidden />;
}

/** A hash or address, shortened, click to copy (the L1's own EVM has no hosted explorer). */
export function Hash({ v, n = 4, label }: { v?: string; n?: number; label?: string }) {
  const [copied, setCopied] = useState(false);
  if (!v) return <span className="dim">—</span>;
  return (
    <button
      className="hash"
      title={`${v} (click to copy)`}
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard?.writeText(v).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
    >
      {copied ? "copied" : label ?? short(v, n)}
      <Icon name={copied ? "check" : "copy"} size={11} />
    </button>
  );
}

export function Ext({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className="tx" href={href} target="_blank" rel="noreferrer">
      {children}
      <Icon name="external" size={12} />
    </a>
  );
}

/** A 0.01-unit amount with faded decimals. */
export function Amount({ v, unit }: { v: bigint; unit?: string }) {
  const neg = v < 0n;
  const a = neg ? -v : v;
  const whole = (a / 100n).toLocaleString("en-US");
  const frac = (a % 100n).toString().padStart(2, "0");
  return (
    <span className="num">
      {neg ? "−" : ""}
      {whole}
      <span className="dec">.{frac}</span>
      {unit && <span className="unit"> {unit}</span>}
    </span>
  );
}

export function StatusPill({ s }: { s: number }) {
  const label = ["None", "Sealed", "Revealed", "Void", "Unfilled", "Filled", "Settled", "Bond back"][s] ?? "?";
  const tone = s === 1 ? "st-live" : s === 5 || s === 6 || s === 7 ? "st-won" : s === 3 ? "st-lost" : "st-wait";
  return (
    <span className={`st ${tone}`}>
      <i />
      {label}
    </span>
  );
}

export function BatchState({ state, price }: { state: number; price?: bigint }) {
  if (state === 1) return <span className="st st-live"><i />Sealed</span>;
  if (state === 2) return <span className="st st-refused"><i />Opening</span>;
  if (state === 3) return price && price > 0n ? <span className="st st-won"><i />Cleared</span> : <span className="st st-wait"><i />No cross</span>;
  return <span className="st st-wait"><i />—</span>;
}
