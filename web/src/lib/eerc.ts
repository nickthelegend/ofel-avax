// Ava Labs eERC in the browser: private balances and private transfers (Groth16 proofs made here).
import { EERC } from "@avalabs/eerc-sdk";
import { decodeFunctionData, parseAbiItem, type Hex, type WalletClient } from "viem";
import { cfg, circuitURLs } from "./config";
import { client, eercAbi } from "./chain";

const cache = new WeakMap<WalletClient, Promise<EERC>>();

export function eercFor(w: WalletClient): Promise<EERC> {
  let p = cache.get(w);
  if (!p) {
    p = (async () => {
      const e = new EERC(client as never, w as never, cfg.eerc, cfg.registrar, true, circuitURLs);
      await e.generateDecryptionKey();
      return e;
    })();
    cache.set(w, p);
    p.catch(() => cache.delete(w));
  }
  return p;
}

type BalanceTuple = readonly [{ c1: { x: bigint; y: bigint }; c2: { x: bigint; y: bigint } }, bigint, { pct: bigint[]; index: bigint }[], bigint[], bigint];

export async function isRegistered(user: Hex): Promise<boolean> {
  return (await client.readContract({
    address: cfg.registrar,
    abi: [{ type: "function", name: "isUserRegistered", stateMutability: "view", inputs: [{ name: "user", type: "address" }], outputs: [{ type: "bool" }] }],
    functionName: "isUserRegistered",
    args: [user],
  })) as boolean;
}

export async function privateBalance(e: EERC, user: Hex, token: Hex): Promise<{ decrypted: bigint; encrypted: bigint[] }> {
  const r = (await client.readContract({ address: cfg.eerc, abi: eercAbi, functionName: "getBalanceFromTokenAddress", args: [user, token] })) as unknown as BalanceTuple;
  const decrypted = e.calculateTotalBalance(r[0] as never, r[2] as never, r[3] as never);
  if (decrypted < 0n) throw new Error("eERC balance failed its consistency check");
  return { decrypted, encrypted: [r[0].c1.x, r[0].c1.y, r[0].c2.x, r[0].c2.y] };
}

export async function auditorPublicKey(): Promise<bigint[]> {
  const p = (await client.readContract({ address: cfg.eerc, abi: eercAbi, functionName: "auditorPublicKey" })) as readonly [bigint, bigint];
  return [p[0], p[1]];
}

export async function privateTransfer(e: EERC, from: Hex, to: Hex, token: Hex, amount: bigint, memo: string): Promise<Hex> {
  const bal = await privateBalance(e, from, token);
  if (bal.decrypted < amount) throw new Error(`Not enough private balance: you hold ${bal.decrypted}, this leg needs ${amount} (units of 0.01)`);
  const r = await e.transfer(to, amount, bal.encrypted, bal.decrypted, await auditorPublicKey(), token, memo);
  await client.waitForTransactionReceipt({ hash: r.transactionHash });
  return r.transactionHash;
}

const auditorAbi = [{ type: "function", name: "auditor", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }] as const;
const legEvents = [
  parseAbiItem("event PrivateTransfer(address indexed from, address indexed to, uint256[7] auditorPCT, address indexed auditorAddress)"),
  parseAbiItem("event PrivateMint(address indexed user, uint256[7] auditorPCT, address indexed auditorAddress)"),
  parseAbiItem("event PrivateBurn(address indexed user, uint256[7] auditorPCT, address indexed auditorAddress)"),
];

export interface AuditLeg {
  transactionHash: Hex;
  amount: string;
  sender: Hex;
  receiver?: Hex;
  type: string;
  blockNumber: bigint;
}

/** Every eERC leg of the last `window` blocks, decrypted with the auditor key. Same steps as the SDK's
 * auditorDecrypt, except the auditor is checked with the contract's own `auditor()` (the SDK 1.0.2 only looks for an
 * AuditorChanged event in the last 1,000 blocks, so it stops recognising the auditor once the chain is older). */
export async function auditorLegs(e: EERC, me: Hex, window = 1000n): Promise<AuditLeg[]> {
  const auditor = (await client.readContract({ address: cfg.eerc, abi: auditorAbi, functionName: "auditor" })) as Hex;
  if (auditor.toLowerCase() !== me.toLowerCase()) throw new Error(`This wallet is not the eERC auditor (${auditor})`);
  const head = await client.getBlockNumber();
  const fromBlock = head > window ? head - window : 0n;
  const logs = (await Promise.all(legEvents.map((event) => client.getLogs({ address: cfg.eerc, event, args: { auditorAddress: me }, fromBlock, toBlock: head })))).flat();
  const out: AuditLeg[] = [];
  for (const l of logs) {
    const pct = (l.args as { auditorPCT?: readonly bigint[] }).auditorPCT;
    if (!l.transactionHash || !pct || pct.length !== 7) continue;
    const tx = await client.getTransaction({ hash: l.transactionHash });
    const amount = (e as unknown as { decryptPCT: (p: readonly bigint[]) => bigint }).decryptPCT(pct);
    let receiver: Hex | undefined;
    try {
      const d = decodeFunctionData({ abi: eercAbi, data: tx.input });
      receiver = d.functionName === "privateBurn" ? (tx.to as Hex) : ((d.args?.[0] as Hex) ?? undefined);
    } catch {
      receiver = undefined;
    }
    out.push({ transactionHash: l.transactionHash, amount: amount.toString(), sender: tx.from, receiver, type: l.eventName.replace("Private", ""), blockNumber: tx.blockNumber! });
  }
  return out.sort((a, b) => Number(b.blockNumber - a.blockNumber));
}
