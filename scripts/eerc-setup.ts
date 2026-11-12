// Registers the agent (eERC auditor + clearing hub) and the two demo traders with the live eERC,
// sets the auditor, mints test assets and deposits them so balances become encrypted.
import { EERC } from "@avalabs/eerc-sdk/dist/index.js";
import { erc20Abi, parseAbi, parseUnits } from "viem";
import { circuitURLs, deployment, log, publicClient, walletFor } from "./lib/env.ts";

const eercAbi = parseAbi([
  "function setAuditorPublicKey(address user)",
  "function auditor() view returns (address)",
  "function isAuditorKeySet() view returns (bool)",
]);
const tokenAbi = parseAbi(["function mint(address to, uint256 amount)"]);

const deployer = walletFor("OFEL_LOCAL_PK");
const roles = { agent: walletFor("OFEL_AGENT_PK"), alice: walletFor("OFEL_ALICE_PK"), bob: walletFor("OFEL_BOB_PK") };

const t0 = Date.now();
const clients: Record<string, EERC> = {};
for (const [name, w] of Object.entries(roles)) {
  const e = new EERC(publicClient as never, w as never, deployment.encryptedERC, deployment.registrar, true, circuitURLs);
  const s = Date.now();
  const r = await e.register();
  if (r.transactionHash) await publicClient.waitForTransactionReceipt({ hash: r.transactionHash as `0x${string}` });
  log(`register ${name}`, r.transactionHash ? `${r.transactionHash} (${Date.now() - s} ms incl. proof)` : "already registered");
  clients[name] = e;
}

if (!(await publicClient.readContract({ address: deployment.encryptedERC, abi: eercAbi, functionName: "isAuditorKeySet" }))) {
  const h = await deployer.writeContract({ address: deployment.encryptedERC, abi: eercAbi, functionName: "setAuditorPublicKey", args: [roles.agent.account.address] });
  await publicClient.waitForTransactionReceipt({ hash: h });
  log("setAuditorPublicKey(agent)", h);
}
log("auditor", await publicClient.readContract({ address: deployment.encryptedERC, abi: eercAbi, functionName: "auditor" }));

async function fund(name: "alice" | "bob", token: `0x${string}`, decimals: number, whole: string) {
  const w = roles[name];
  const amount = parseUnits(whole, decimals);
  let h = await deployer.writeContract({ address: token, abi: tokenAbi, functionName: "mint", args: [w.account.address, amount] });
  await publicClient.waitForTransactionReceipt({ hash: h });
  h = await w.writeContract({ address: token, abi: erc20Abi, functionName: "approve", args: [deployment.encryptedERC, amount] });
  await publicClient.waitForTransactionReceipt({ hash: h });
  const d = await clients[name].deposit(amount, token, 2n);
  await publicClient.waitForTransactionReceipt({ hash: d.transactionHash as `0x${string}` });
  log(`deposit ${name} ${whole}`, d.transactionHash);
}
await fund("alice", deployment.tUSDC, 6, "100000");
await fund("bob", deployment.tAVAX, 18, "5000");
log("done in", `${Date.now() - t0} ms`);
process.exit(0); // snarkjs keeps worker threads alive
