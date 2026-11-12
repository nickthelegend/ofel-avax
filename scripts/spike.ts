// GO/NO-GO spike: Warp message -> validator BLS signatures -> verify in JS -> timelock round trip.
// Runs against the live local Ofel L1. No mocks.
import { createPublicClient, createWalletClient, encodeAbiParameters, http, parseAbi, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  bytesToHex,
  cb58Encode,
  getL1Validators,
  getNetworkID,
  getNodeIdentity,
  getWarpSignature,
  hexToBytes,
  identityMessage,
  messageId,
  open,
  seal,
  verifySignature,
  NotEnoughSignaturesError,
} from "warplock";

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`Setup required: ${k} is not set (see .env.example)`);
  return v;
};
const SUBNET_ID = env("OFEL_SUBNET_ID");
const BLOCKCHAIN_ID = env("OFEL_BLOCKCHAIN_ID");
const PCHAIN = env("OFEL_PCHAIN_URL");
const NODE_URIS = env("OFEL_VALIDATOR_URIS").split(",");
const SPIKE = env("OFEL_SPIKE_ADDRESS") as `0x${string}`;
const rpcOf = (uri: string) => `${uri}/ext/bc/${BLOCKCHAIN_ID}/rpc`;

const chain = defineChain({ id: 77077, name: "Ofel local", nativeCurrency: { name: "OFEL", symbol: "OFEL", decimals: 18 }, rpcUrls: { default: { http: [rpcOf(NODE_URIS[0])] } } });
const pub = createPublicClient({ chain, transport: http() });
const wallet = createWalletClient({ chain, transport: http(), account: privateKeyToAccount(env("OFEL_LOCAL_PK") as `0x${string}`) });
const abi = parseAbi(["function emitMessage(bytes payload) returns (bytes32)", "function blockchainID() view returns (bytes32)", "event SendWarpMessage(address indexed sourceAddress, bytes32 indexed unsignedMessageID, bytes message)"]);

const log = (k: string, v: unknown) => console.log(`${k.padEnd(28)} ${typeof v === "string" ? v : JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x))}`);

const validators = await getL1Validators(PCHAIN, SUBNET_ID);
log("P-Chain L1 validators", validators.map((v) => `${v.nodeID} ${v.publicKey.slice(0, 14)}…`));
const networkID = await getNetworkID(`${NODE_URIS[0]}/ext/info`);
const chainIdHex = await pub.readContract({ address: SPIKE, abi, functionName: "blockchainID" });
log("networkID", networkID);
log("blockchainID (precompile)", chainIdHex);
if (cb58Encode(hexToBytes(chainIdHex)) !== BLOCKCHAIN_ID) throw new Error("blockchain ID mismatch between precompile and CLI");

// 1. Predict the future message before it exists.
const T = BigInt(Math.floor(Date.now() / 1000));
const payload = encodeAbiParameters([{ type: "string" }, { type: "uint64" }], ["ofel/spike/v1", T]);
const identity = identityMessage({ networkID, sourceChainID: chainIdHex, sourceAddress: SPIKE, payload });
const id = messageId(identity);
log("predicted message ID", cb58Encode(id));

// 2. Seal 2-of-3 to that message.
const secret = new TextEncoder().encode(`BUY 1,250 AVAX @ <= 31.40 sealed at ${T}`);
const env1 = seal(secret, identity, validators, 2);
log("sealed", `${env1.shares.length} shares, threshold ${env1.threshold}, ${env1.ciphertext.length} B ciphertext`);

// 3. Before emission no validator will sign.
for (const uri of NODE_URIS) {
  try {
    await getWarpSignature(rpcOf(uri), id);
    throw new Error(`NO-GO: ${uri} signed a message that was never emitted`);
  } catch (e) {
    if ((e as Error).message.startsWith("NO-GO")) throw e;
    log(`early fetch ${uri.slice(-4)}`, `refused: ${(e as Error).message.split(": ").slice(1).join(": ")}`);
  }
}

// 4. Emit it from the contract.
const hash = await wallet.writeContract({ address: SPIKE, abi, functionName: "emitMessage", args: [payload] });
const rcpt = await pub.waitForTransactionReceipt({ hash });
const warpLog = rcpt.logs.find((l) => l.address.toLowerCase() === "0x0200000000000000000000000000000000000005");
if (!warpLog) throw new Error("NO-GO: no SendWarpMessage log");
const emitted = (await import("viem")).decodeEventLog({ abi, data: warpLog.data, topics: warpLog.topics });
const emittedBytes = hexToBytes((emitted.args as { message: `0x${string}` }).message);
log("emit tx", hash);
log("emitted == predicted bytes", bytesToHex(emittedBytes) === bytesToHex(identity));
if (bytesToHex(emittedBytes) !== bytesToHex(identity)) throw new Error(`NO-GO: byte mismatch\n emitted  ${bytesToHex(emittedBytes)}\n predicted ${bytesToHex(identity)}`);

// 5. Fetch each validator's signature and verify against its P-Chain key.
const sigs = new Map<string, Uint8Array>();
for (const uri of NODE_URIS) {
  const me = await getNodeIdentity(`${uri}/ext/info`);
  let sig: Uint8Array | undefined;
  for (let i = 0; i < 20 && !sig; i++) {
    try {
      sig = await getWarpSignature(rpcOf(uri), id);
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  if (!sig) throw new Error(`NO-GO: ${uri} never returned a signature`);
  const v = validators.find((x) => x.nodeID === me.nodeID);
  if (!v) throw new Error(`${uri} (${me.nodeID}) is not an L1 validator`);
  const ok = verifySignature(sig, identity, hexToBytes(v.publicKey));
  log(`sig ${me.nodeID.slice(0, 14)}`, ok ? "verifies against P-Chain BLS key" : "DOES NOT VERIFY");
  if (!ok) throw new Error("NO-GO: signature does not verify");
  sigs.set(me.nodeID, sig);
}

// 6. Round trip with only 2 of the 3 (one validator "offline").
const two = new Map([...sigs].slice(1));
const r = open(env1, identity, validators, two);
log("opened with 2/3", new TextDecoder().decode(r.plaintext));
if (new TextDecoder().decode(r.plaintext) !== new TextDecoder().decode(secret)) throw new Error("NO-GO: plaintext mismatch");

// 7. One signature is not enough.
try {
  open(env1, identity, validators, new Map([...sigs].slice(0, 1)));
  throw new Error("NO-GO: opened with 1/3");
} catch (e) {
  if (!(e instanceof NotEnoughSignaturesError)) throw e;
  log("1/3 signatures", `refused: ${e.message}`);
}
console.log("\nGO: Warp BLS signatures from the L1 validators open a timelock sealed before the message existed.");
