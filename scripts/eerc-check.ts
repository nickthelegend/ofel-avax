// Live check: one private eERC transfer (alice -> agent) and the auditor decrypting it.
import { deployment, log, walletFor } from "./lib/env.ts";
import { eercFor, privateBalance, privateTransfer } from "./lib/eerc.ts";

const alice = walletFor("OFEL_ALICE_PK");
const agent = walletFor("OFEL_AGENT_PK");
const ea = await eercFor(alice);
const eg = await eercFor(agent);
log("alice tUSDC (private)", (await privateBalance(ea, alice.account.address, deployment.tUSDC)).decrypted);
const t = Date.now();
const h = await privateTransfer(ea, alice.account.address, agent.account.address, deployment.tUSDC, 100n, "ofel:check");
log("transfer 1.00 tUSDC", `${h} (${Date.now() - t} ms incl. proof)`);
log("agent tUSDC (private)", (await privateBalance(eg, agent.account.address, deployment.tUSDC)).decrypted);
const audit = await eg.auditorDecrypt();
log("auditor sees", audit.map((a) => `${a.type} ${a.amount} ${a.sender.slice(0, 8)}→${a.receiver?.slice(0, 8)}`));
process.exit(0);
