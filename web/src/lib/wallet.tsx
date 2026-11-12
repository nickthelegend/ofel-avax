// Wallet: an injected browser wallet, a test wallet made in this browser (testnet only), or (QA builds only) the
// local demo signers.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createWalletClient, custom, http, type Hex, type WalletClient } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { agentKeyMessage, agentSecretFromSignature, selfKeyFromSignature, selfKeyMessage } from "@ofel/core";
import { cfg, chain, NETWORK as NETWORK_TAG } from "./config";

declare const __OFEL_QA_KEYS__: Record<string, string> | null;
export const QA_KEYS: Record<string, string> | null = typeof __OFEL_QA_KEYS__ === "undefined" ? null : __OFEL_QA_KEYS__;
export const QA_ROLES = QA_KEYS ? (["alice", "bob", "agent"] as const) : ([] as const);
export const ROLE_LABEL: Record<string, string> = { alice: "Trader A (QA)", bob: "Trader B (QA)", agent: "Clearing agent · auditor (QA)" };

interface WalletState {
  address?: Hex;
  label?: string;
  client?: WalletClient;
  isAgent: boolean;
  connectInjected: () => Promise<void>;
  useQa: (role: string) => void;
  connectTest: () => void;
  isTest: boolean;
  disconnect: () => void;
  selfKey: () => Promise<Uint8Array>;
  agentSecret: () => Promise<Uint8Array>;
  error?: string;
}

const Ctx = createContext<WalletState | null>(null);
const TEST_KEY = `ofel.testWallet.${NETWORK_TAG}`;
const TEST_ON = `ofel.testWallet.${NETWORK_TAG}.on`;

export function WalletProvider({ children }: { children: ReactNode }) {
  const [client, setClient] = useState<WalletClient>();
  const [label, setLabel] = useState<string>();
  const [error, setError] = useState<string>();
  const keys = useRef(new Map<string, Uint8Array>());
  const [isTest, setIsTest] = useState(false);

  // A throwaway key for this Ofel testnet L1, kept in this browser so a reload keeps the same wallet.
  const connectTest = useCallback(() => {
    let pk: string | null = null;
    try {
      pk = localStorage.getItem(TEST_KEY);
      if (!pk) {
        pk = generatePrivateKey();
        localStorage.setItem(TEST_KEY, pk);
      }
      localStorage.setItem(TEST_ON, "1");
    } catch {
      pk = pk ?? generatePrivateKey(); // storage blocked: the wallet lasts for this tab only
    }
    keys.current.clear();
    setClient(createWalletClient({ chain, transport: http(cfg.rpc), account: privateKeyToAccount(pk as Hex) }));
    setLabel("Test wallet (this browser)");
    setIsTest(true);
    setError(undefined);
  }, []);

  const useQa = useCallback((role: string) => {
    const pk = QA_KEYS?.[role];
    if (!pk) return setError("QA signers are not in this build");
    try {
      sessionStorage.setItem("ofel.qaRole", role); // the role name only, never a key
    } catch {
      /* storage blocked */
    }
    keys.current.clear();
    setClient(createWalletClient({ chain, transport: http(cfg.rpc), account: privateKeyToAccount(pk as Hex) }));
    setLabel(ROLE_LABEL[role]);
    setIsTest(false);
    setError(undefined);
  }, []);

  const connectInjected = useCallback(async () => {
    const eth = (window as unknown as { ethereum?: { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> } }).ethereum;
    if (!eth) return setError("No browser wallet found. Use a test wallet instead.");
    try {
      const [addr] = (await eth.request({ method: "eth_requestAccounts" })) as Hex[];
      try {
        await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: `0x${cfg.chainId.toString(16)}` }] });
      } catch {
        await eth.request({
          method: "wallet_addEthereumChain",
          params: [{ chainId: `0x${cfg.chainId.toString(16)}`, chainName: "Ofel L1", nativeCurrency: { name: "OFEL", symbol: "OFEL", decimals: 18 }, rpcUrls: [cfg.rpc] }],
        });
      }
      keys.current.clear();
      setClient(createWalletClient({ chain, transport: custom(eth), account: addr }));
      setLabel("Browser wallet");
      setIsTest(false);
      setError(undefined);
    } catch (e) {
      setError((e as Error).message.split("\n")[0]);
    }
  }, []);

  const derive = useCallback(
    async (kind: "self" | "agent") => {
      if (!client?.account) throw new Error("Connect a wallet first");
      const cached = keys.current.get(kind);
      if (cached) return cached;
      const message = kind === "self" ? selfKeyMessage(cfg.chainId, cfg.book) : agentKeyMessage(cfg.chainId, cfg.book);
      const sig = await client.signMessage({ account: client.account, message });
      const k = kind === "self" ? selfKeyFromSignature(sig) : agentSecretFromSignature(sig);
      keys.current.set(kind, k);
      return k;
    },
    [client],
  );

  useEffect(() => {
    try {
      const r = sessionStorage.getItem("ofel.qaRole");
      if (r && QA_KEYS?.[r]) useQa(r);
      else if (localStorage.getItem(TEST_ON) === "1") connectTest();
    } catch {
      /* storage blocked */
    }
  }, [useQa, connectTest]);

  const value = useMemo<WalletState>(
    () => ({
      address: client?.account?.address,
      label,
      client,
      isAgent: !!client?.account && client.account.address.toLowerCase() === cfg.agent.toLowerCase(),
      connectInjected,
      useQa,
      connectTest,
      isTest,
      disconnect: () => {
        try {
          sessionStorage.removeItem("ofel.qaRole");
          localStorage.removeItem(TEST_ON); // the test key itself stays, so reconnecting brings the same wallet back
        } catch {
          /* storage blocked */
        }
        keys.current.clear();
        setClient(undefined);
        setLabel(undefined);
        setIsTest(false);
      },
      selfKey: () => derive("self"),
      agentSecret: () => derive("agent"),
      error,
    }),
    [client, label, connectInjected, useQa, connectTest, isTest, derive, error],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet(): WalletState {
  const v = useContext(Ctx);
  if (!v) throw new Error("WalletProvider missing");
  return v;
}
