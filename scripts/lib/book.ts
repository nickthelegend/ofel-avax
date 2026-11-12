// Reading the live OfelBook and the validator set; shared by the agent, the trader CLI and tests.
import { batchIdentity, ofelBookAbi, type BookContext } from "@ofel/core";
import { parseAbiItem, type Abi, type Hex } from "viem";
import { getL1Validators, getNodeIdentity, getWarpSignature, messageId, bytesToHex, type Validator } from "warplock";
import { deployment, NET, PCHAIN_URL, publicClient, rpcOf, SUBNET_ID, VALIDATOR_URIS } from "./env.ts";

export const bookAbi = ofelBookAbi as Abi;
export const BOOK = deployment.ofelBook;

export const ctx: BookContext = {
  chainId: Number((deployment as Record<string, unknown>).chainId ?? 77077),
  networkID: Number((deployment as Record<string, unknown>).networkID ?? 1337),
  blockchainIdHex: deployment.blockchainIdHex,
  book: BOOK,
};

export const STATE = ["None", "Open", "Closed", "Cleared"] as const;
export const STATUS = ["None", "Sealed", "Revealed", "Void", "Unfilled", "Filled", "Settled", "BondClaimed"] as const;

export interface BatchView {
  id: bigint;
  closeAt: bigint;
  closedAt: bigint;
  clearedAt: bigint;
  orderCount: number;
  revealedCount: number;
  state: number;
  price: bigint;
  buyTotal: bigint;
  sellTotal: bigint;
  closeMessageId: Hex;
}

export interface OrderView {
  index: number;
  trader: Hex;
  side: number;
  status: number;
  limit: bigint;
  commitment: Hex;
  cx: bigint;
  cy: bigint;
}

export async function batchCount(): Promise<bigint> {
  return (await publicClient.readContract({ address: BOOK, abi: bookAbi, functionName: "batchCount" })) as bigint;
}

export async function getBatch(id: bigint): Promise<BatchView> {
  const b = (await publicClient.readContract({ address: BOOK, abi: bookAbi, functionName: "getBatch", args: [id] })) as Omit<BatchView, "id">;
  return { ...b, id };
}

export async function getOrders(id: bigint): Promise<OrderView[]> {
  const os = (await publicClient.readContract({ address: BOOK, abi: bookAbi, functionName: "getOrders", args: [id] })) as Omit<OrderView, "index">[];
  return os.map((o, index) => ({ ...o, index }));
}

const sealedEvent = parseAbiItem(
  "event OrderSealed(uint256 indexed batchId, uint32 indexed index, address indexed trader, bytes32 commitment, uint256 cx, uint256 cy, bytes envelope)",
);

export async function getEnvelopes(id: bigint): Promise<Map<number, { envelope: Hex; tx: Hex }>> {
  const logs = await publicClient.getLogs({ address: BOOK, event: sealedEvent, args: { batchId: id }, fromBlock: 0n, toBlock: "latest" });
  return new Map(logs.map((l) => [Number(l.args.index), { envelope: l.args.envelope as Hex, tx: l.transactionHash }]));
}

export async function validators(): Promise<Validator[]> {
  return getL1Validators(PCHAIN_URL, SUBNET_ID);
}

/** Validator node endpoints keyed by NodeID (each node reports its own ID). */
let nodeMap: Map<string, string> | undefined;
export async function validatorEndpoints(): Promise<Map<string, string>> {
  if (nodeMap) return nodeMap;
  const m = new Map<string, string>();
  for (const uri of VALIDATOR_URIS) {
    try {
      const me = await getNodeIdentity(`${uri}/ext/info`);
      m.set(me.nodeID, uri);
    } catch {
      /* offline right now; retried next call */
    }
  }
  if (m.size === VALIDATOR_URIS.length) nodeMap = m;
  return m;
}

export interface SignatureReport {
  identity: Uint8Array;
  signatures: Map<string, Uint8Array>;
  failures: { nodeID: string; error: string }[];
}

/** Ask every validator for its BLS signature on the batch-close Warp message. */
export async function collectSignatures(b: BatchView): Promise<SignatureReport> {
  const identity = batchIdentity(ctx, b.id, b.closeAt);
  const id = messageId(identity);
  if (b.closeMessageId !== "0x0000000000000000000000000000000000000000000000000000000000000000" && bytesToHex(id) !== b.closeMessageId.toLowerCase()) {
    throw new Error(`batch ${b.id}: predicted Warp message ID ${bytesToHex(id)} != on-chain ${b.closeMessageId}`);
  }
  const signatures = new Map<string, Uint8Array>();
  const failures: { nodeID: string; error: string }[] = [];
  const vs = await validators();
  const eps = await validatorEndpoints();
  await Promise.all(
    vs.map(async (v) => {
      const uri = eps.get(v.nodeID);
      if (!uri) return failures.push({ nodeID: v.nodeID, error: "no reachable endpoint" });
      try {
        signatures.set(v.nodeID, await getWarpSignature(rpcOf(uri), id));
      } catch (e) {
        failures.push({ nodeID: v.nodeID, error: (e as Error).message });
      }
    }),
  );
  return { identity, signatures, failures };
}

export const network = NET;
