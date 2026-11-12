// Zero-setup path for a new wallet: test funds from the Ofel faucet (OFEL gas + tAVAX + tUSDC, relayed because a new
// wallet has no gas), eERC registration (Groth16 proof in this browser), then deposits so the balances are private.
import { useState } from "react";
import { erc20Abi, parseAbi, type Hex } from "viem";
import { cfg } from "../lib/config";
import { client } from "../lib/chain";
import { eercFor, isRegistered, privateBalance } from "../lib/eerc";
import { useLive } from "../lib/hooks";
import { useWallet } from "../lib/wallet";

const faucetAbi = parseAbi(["function claimed(address) view returns (bool)"]);

interface Readiness {
  gas: bigint;
  claimed: boolean;
  registered: boolean;
  publicA: bigint;
  publicU: bigint;
}

async function readiness(me: Hex): Promise<Readiness> {
  const [gas, claimed, registered, publicA, publicU] = await Promise.all([
    client.getBalance({ address: me }),
    cfg.faucet ? (client.readContract({ address: cfg.faucet, abi: faucetAbi, functionName: "claimed", args: [me] }) as Promise<boolean>) : Promise.resolve(true),
    isRegistered(me),
    client.readContract({ address: cfg.tAVAX, abi: erc20Abi, functionName: "balanceOf", args: [me] }),
    client.readContract({ address: cfg.tUSDC, abi: erc20Abi, functionName: "balanceOf", args: [me] }),
  ]);
  return { gas, claimed, registered, publicA, publicU };
}

/** True once the wallet is registered and holds no undeposited test assets. */
export function useSetupState() {
  const w = useWallet();
  const [k, setK] = useState(0);
  const r = useLive(() => (w.address ? readiness(w.address) : Promise.resolve(undefined)), [w.address, k], 15000);
  const ready = !!r.data && r.data.registered && r.data.publicA === 0n && r.data.publicU === 0n && r.data.gas > 0n;
  return { r, ready, refresh: () => setK((x) => x + 1) };
}

export function SetupSteps({ state }: { state: ReturnType<typeof useSetupState> }) {
  const w = useWallet();
  const [step, setStep] = useState<string>();
  const [err, setErr] = useState<string>();
  const d = state.r.data;
  if (!w.address || !d || state.ready) return null;
  const funded = d.claimed || d.gas > 0n;

  async function run() {
    if (!w.client?.account || !w.address) return;
    const me = w.address;
    setErr(undefined);
    try {
      let cur = await readiness(me);
      if (!cur.claimed && cur.gas === 0n) {
        if (!cfg.api) throw new Error("Setup required: no faucet API in this build");
        setStep("Asking the faucet…");
        const res = await fetch(`${cfg.api}/api/faucet`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: me }) });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j.error ?? `Faucet answered ${res.status}`);
        await client.waitForTransactionReceipt({ hash: j.tx });
        cur = await readiness(me);
      }
      if (cur.gas === 0n) throw new Error("This wallet has no OFEL for gas, and the faucet already funded it once");
      const e = await eercFor(w.client);
      if (!cur.registered) {
        setStep("Registering your eERC key (proof in this browser)…");
        const r = await e.register();
        if (r.transactionHash) await client.waitForTransactionReceipt({ hash: r.transactionHash as Hex });
      }
      for (const [token, amount, sym] of [[cfg.tUSDC, cur.publicU, "tUSDC"], [cfg.tAVAX, cur.publicA, "tAVAX"]] as const) {
        if (amount === 0n) continue;
        setStep(`Depositing ${sym} into eERC…`);
        const a = await w.client.writeContract({ address: token, abi: erc20Abi, functionName: "approve", args: [cfg.eerc, amount], account: w.client.account, chain: undefined });
        await client.waitForTransactionReceipt({ hash: a });
        const dep = await e.deposit(amount, token, 2n);
        await client.waitForTransactionReceipt({ hash: dep.transactionHash as Hex });
        await privateBalance(e, me, token);
      }
      setStep(undefined);
      state.refresh();
    } catch (x) {
      setStep(undefined);
      setErr((x as Error).message.split("\n")[0].slice(0, 220));
      state.refresh();
    }
  }

  const row = (label: string, done: boolean) => (
    <div className="kv">
      <span className="muted">{label}</span>
      <b>{done ? "Done" : "To do"}</b>
    </div>
  );
  return (
    <div style={{ margin: "4px 0 16px" }} aria-label="Set up this wallet">
      {row("Test OFEL, tAVAX, tUSDC", funded)}
      {row("eERC key registered", d.registered)}
      {row("Assets in private balance", d.registered && d.publicA === 0n && d.publicU === 0n)}
      <button className="btn ink block" disabled={!!step} onClick={run}>
        {step ?? (funded ? "Finish setup" : "Get test funds")}
      </button>
      {err && <div className="sell" style={{ fontSize: 12.5, marginTop: 8 }}>{err}</div>}
    </div>
  );
}
