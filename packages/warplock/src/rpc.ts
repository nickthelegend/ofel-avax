// Live reads: validator BLS keys from the P-Chain, signatures from each validator's warp API.
import type { Validator } from "./seal.ts";
import { cb58Encode, hexToBytes } from "./warp.ts";

async function jsonRpc<T>(url: string, method: string, params: unknown, timeoutMs = 4000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: ctrl.signal,
    });
  } catch (e) {
    throw new Error(`${method} @ ${url}: unreachable (${(e as Error).name === "AbortError" ? "timeout" : (e as Error).message})`);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`${method} @ ${url}: HTTP ${res.status}`);
  const body = (await res.json()) as { result?: T; error?: { message: string } };
  if (body.error) throw new Error(`${method} @ ${url}: ${body.error.message}`);
  return body.result as T;
}

/** Current validators of an L1 (or subnet), with their BLS public keys, from platform.getCurrentValidators. */
export async function getL1Validators(pchainUrl: string, subnetID: string): Promise<Validator[]> {
  const r = await jsonRpc<{ validators: { nodeID: string; publicKey?: string; signer?: { publicKey: string }; weight: string }[] }>(
    pchainUrl,
    "platform.getCurrentValidators",
    { subnetID },
  );
  const vs = r.validators.map((v) => {
    const publicKey = v.publicKey ?? v.signer?.publicKey;
    if (!publicKey) throw new Error(`validator ${v.nodeID} has no BLS public key on the P-Chain`);
    return { nodeID: v.nodeID, publicKey, weight: BigInt(v.weight) };
  });
  return vs.sort((a, b) => (a.nodeID < b.nodeID ? -1 : 1));
}

export async function getNetworkID(infoUrl: string): Promise<number> {
  const r = await jsonRpc<{ networkID: string }>(infoUrl, "info.getNetworkID", {});
  return Number(r.networkID);
}

/** One validator's BLS signature on an accepted Warp message (subnet-evm warp API). */
export async function getWarpSignature(chainRpcUrl: string, messageID: Uint8Array): Promise<Uint8Array> {
  const hex = await jsonRpc<string>(chainRpcUrl, "warp_getMessageSignature", [cb58Encode(messageID)]);
  const sig = hexToBytes(hex);
  if (sig.length !== 96) throw new Error(`warp_getMessageSignature @ ${chainRpcUrl}: expected 96 bytes, got ${sig.length}`);
  return sig;
}

/** The node's own ID and BLS key, to match a validator's RPC endpoint to its P-Chain entry. */
export async function getNodeIdentity(infoUrl: string): Promise<{ nodeID: string; publicKey: string }> {
  const r = await jsonRpc<{ nodeID: string; nodePOP: { publicKey: string } }>(infoUrl, "info.getNodeID", {});
  return { nodeID: r.nodeID, publicKey: r.nodePOP.publicKey };
}
