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
  window.scrollTo({ top: 0 });
}

export function Link({ to, children, className, current }: { to: string; children: ReactNode; className?: string; current?: boolean }) {
  const onClick = (e: MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    go(to);
  };
  return (
    <a href={to} onClick={onClick} className={className} aria-current={current ? "page" : undefined}>
      {children}
    </a>
  );
}

// --------------------------------------------------------------- states
export function Empty({ art = "empty", title, children }: { art?: string; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <img src={`/art/${art}.webp`} alt="" width={96} height={96} />
      <b>{title}</b>
      {children && <div>{children}</div>}
    </div>
  );
}

export function ErrorBox({ children }: { children: ReactNode }) {
  return (
    <div className="err" role="alert">
      <img src="/art/cracked.webp" alt="" width={40} height={40} />
      <div>{children}</div>
    </div>
  );
}

export function Skel({ w = "100%" }: { w?: string }) {
  return <div className="skel" style={{ width: w }} aria-hidden />;
}

export function Hash({ v, n = 4 }: { v?: string; n?: number }) {
  const [copied, setCopied] = useState(false);
  if (!v) return <span className="faint">—</span>;
  return (
    <button
      className="mono"
      style={{ background: "none", border: 0, padding: 0, cursor: "copy", color: "var(--ink-2)" }}
      title={`${v} (click to copy)`}
      onClick={() => {
        navigator.clipboard?.writeText(v).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
    >
      {copied ? "copied" : short(v, n)}
    </button>
  );
}

/** A 0.01-unit amount with faded decimals. */
export function Amount({ v, unit, big }: { v: bigint; unit?: string; big?: boolean }) {
  const neg = v < 0n;
  const a = neg ? -v : v;
  const whole = (a / 100n).toLocaleString("en-US");
  const frac = (a % 100n).toString().padStart(2, "0");
  return (
    <span className={big ? "big num" : "num"}>
      {neg ? "−" : ""}
      {whole}
      <span className="dec">.{frac}</span>
      {unit && <span className="dec" style={{ fontSize: big ? "0.38em" : "0.86em", marginLeft: big ? 10 : 5, letterSpacing: 0 }}>{unit}</span>}
    </span>
  );
}

// --------------------------------------------------------------- icons (stroke, 20px)
const I = (d: string) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />
  </svg>
);
export const Icons = {
  desk: I("M4 6h16M4 12h10M4 18h7M17 15l3 3-3 3"),
  batches: I("M12 3a9 9 0 1 0 9 9M12 7v5l3 2"),
  fills: I("M4 7h16v12H4zM4 11h16M8 15h3"),
  auditor: I("M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14zM16 16l5 5"),
  validators: I("M5 21V9a3 3 0 0 1 6 0v12M13 21V9a3 3 0 0 1 6 0v12M3 21h18"),
};
