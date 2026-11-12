// Thin helpers over Ava Labs' eERC SDK (EERC class) for Node roles.
import { EERC } from "@avalabs/eerc-sdk/dist/index.js";
import { encryptedErcAbi } from "@ofel/core";
import type { Abi, Hex, WalletClient } from "viem";
import { circuitURLs, deployment, publicClient } from "./env.ts";

const abi = encryptedErcAbi as Abi;

export async function eercFor(wallet: WalletClient): Promise<EERC> {
  const e = new EERC(publicClient as never, wallet as never, deployment.encryptedERC, deployment.registrar, true, circuitURLs);
  await e.generateDecryptionKey();
  return e;
}

export async function auditorPublicKey(): Promise<bigint[]> {
  const p = (await publicClient.readContract({ address: deployment.encryptedERC, abi, functionName: "auditorPublicKey" })) as readonly [bigint, bigint];
  return [p[0], p[1]];
}

export interface PrivateBalance {
  decrypted: bigint;
  encrypted: bigint[];
}

type BalanceTuple = readonly [{ c1: { x: bigint; y: bigint }; c2: { x: bigint; y: bigint } }, bigint, { pct: bigint[]; index: bigint }[], bigint[], bigint];

export async function privateBalance(e: EERC, user: Hex, token: Hex): Promise<PrivateBalance> {
  const r = (await publicClient.readContract({ address: deployment.encryptedERC, abi, functionName: "getBalanceFromTokenAddress", args: [user, token] })) as unknown as BalanceTuple;
  const decrypted = e.calculateTotalBalance(r[0] as never, r[2] as never, r[3] as never);
  if (decrypted < 0n) throw new Error(`eERC balance for ${user} failed its consistency check`);
  return { decrypted, encrypted: [r[0].c1.x, r[0].c1.y, r[0].c2.x, r[0].c2.y] };
}

/** Private eERC transfer with a fresh balance read; amount in eERC units (2 decimals). */
export async function privateTransfer(e: EERC, from: Hex, to: Hex, token: Hex, amount: bigint, memo: string): Promise<Hex> {
  const bal = await privateBalance(e, from, token);
  if (bal.decrypted < amount) throw new Error(`insufficient private balance: have ${bal.decrypted}, need ${amount}`);
  const r = await e.transfer(to, amount, bal.encrypted, bal.decrypted, await auditorPublicKey(), token, memo);
  await publicClient.waitForTransactionReceipt({ hash: r.transactionHash });
  return r.transactionHash;
}
