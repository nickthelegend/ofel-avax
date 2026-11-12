// Mint test assets to a demo trader and deposit them into eERC (public deposit, private balance after).
//   node topup.ts alice tUSDC 200000
import { erc20Abi, parseAbi, parseUnits, type Hex } from "viem";
import { deployment, log, publicClient, walletFor } from "./lib/env.ts";
import { eercFor, privateBalance } from "./lib/eerc.ts";

const [who, sym, whole] = process.argv.slice(2);
const token = (sym === "tUSDC" ? deployment.tUSDC : deployment.tAVAX) as Hex;
const decimals = sym === "tUSDC" ? 6 : 18;
const deployer = walletFor("OFEL_LOCAL_PK");
const w = walletFor(`OFEL_${who.toUpperCase()}_PK`);
const amount = parseUnits(whole, decimals);
let h = await deployer.writeContract({ address: token, abi: parseAbi(["function mint(address,uint256)"]), functionName: "mint", args: [w.account.address, amount] });
await publicClient.waitForTransactionReceipt({ hash: h });
h = await w.writeContract({ address: token, abi: erc20Abi, functionName: "approve", args: [deployment.encryptedERC, amount] });
await publicClient.waitForTransactionReceipt({ hash: h });
const e = await eercFor(w);
const d = await e.deposit(amount, token, 2n);
await publicClient.waitForTransactionReceipt({ hash: d.transactionHash });
log(`deposit ${who} ${whole} ${sym}`, d.transactionHash);
log("private balance now", (await privateBalance(e, w.account.address, token)).decrypted);
process.exit(0);
