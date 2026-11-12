// Small public API next to the clearing agent: health, and the judge faucet relay.
//   GET  /api/health          -> agent, book, L1 height, faucet stock
//   POST /api/faucet {address} -> OfelFaucet.drip(address), paid by the faucet operator (a new wallet has no gas)
// The faucet contract allows one drip per address; this adds a per-IP limit. CORS is open (public testnet faucet).
import http from "node:http";
import { formatEther, isAddress, parseAbi, type Hex } from "viem";
import { deployment, log, publicClient, walletFor } from "./env.ts";

const faucetAbi = parseAbi([
  "function drip(address to)",
  "function claimed(address) view returns (bool)",
  "function drips() view returns (uint256)",
  "function gasAmount() view returns (uint256)",
]);
const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);

export function startApi(port: number, agent: Hex) {
  const faucet = (deployment as Record<string, Hex>).faucet;
  const operator = faucet && process.env.OFEL_FAUCET_PK ? walletFor("OFEL_FAUCET_PK") : undefined;
  const perIp = new Map<string, number[]>();
  const LIMIT = Number(process.env.OFEL_FAUCET_PER_IP_PER_HOUR ?? 5);
  let queue: Promise<unknown> = Promise.resolve(); // one drip at a time: the operator's nonce stays in order

  const send = (res: http.ServerResponse, code: number, body: unknown) => {
    res.writeHead(code, { "content-type": "application/json", "access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "access-control-allow-methods": "GET, POST, OPTIONS" });
    res.end(JSON.stringify(body, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
  };

  http
    .createServer(async (req, res) => {
      try {
        if (req.method === "OPTIONS") return send(res, 204, {});
        const url = new URL(req.url ?? "/", "http://x");
        if (req.method === "GET" && url.pathname === "/api/health") {
          const height = await publicClient.getBlockNumber();
          let stock: Record<string, string> | string = "Setup required: no faucet in this deployment";
          if (faucet) {
            const [gas, a, u, drips] = await Promise.all([
              publicClient.getBalance({ address: faucet }),
              publicClient.readContract({ address: deployment.tAVAX, abi: erc20, functionName: "balanceOf", args: [faucet] }),
              publicClient.readContract({ address: deployment.tUSDC, abi: erc20, functionName: "balanceOf", args: [faucet] }),
              publicClient.readContract({ address: faucet, abi: faucetAbi, functionName: "drips" }),
            ]);
            stock = { OFEL: formatEther(gas), tAVAX: formatEther(a as bigint), tUSDC: (Number(u) / 1e6).toString(), drips: String(drips), relay: operator ? "on" : "Setup required: OFEL_FAUCET_PK" };
          }
          return send(res, 200, { ok: true, agent, book: deployment.ofelBook, l1Height: height, faucet: stock });
        }
        if (req.method === "POST" && url.pathname === "/api/faucet") {
          if (!faucet || !operator) return send(res, 503, { error: "Setup required: the faucet relay is not configured on this server" });
          const chunks: Buffer[] = [];
          for await (const c of req) chunks.push(c as Buffer);
          let to = "";
          try {
            to = String(JSON.parse(Buffer.concat(chunks).toString() || "{}").address ?? "");
          } catch {
            return send(res, 400, { error: "Body must be JSON: {\"address\": \"0x…\"}" });
          }
          if (!isAddress(to)) return send(res, 400, { error: "Not an address" });
          if (await publicClient.readContract({ address: faucet, abi: faucetAbi, functionName: "claimed", args: [to] })) return send(res, 409, { error: "This wallet already got test funds" });
          const ip = String(req.headers["x-real-ip"] ?? req.socket.remoteAddress ?? "?");
          const now = Date.now();
          const recent = (perIp.get(ip) ?? []).filter((t) => now - t < 3_600_000);
          if (recent.length >= LIMIT) return send(res, 429, { error: `Faucet limit: ${LIMIT} wallets per hour from one address` });
          perIp.set(ip, [...recent, now]);
          const job = queue.then(async () => {
            const hash = await operator.writeContract({ address: faucet, abi: faucetAbi, functionName: "drip", args: [to as Hex], chain: undefined });
            const r = await publicClient.waitForTransactionReceipt({ hash });
            if (r.status !== "success") throw new Error(`drip reverted in ${hash}`);
            return hash;
          });
          queue = job.catch(() => undefined);
          const tx = await job;
          log("faucet drip", `${to} ${tx}`);
          return send(res, 200, { tx });
        }
        send(res, 404, { error: "Not found" });
      } catch (e) {
        log("api", `error: ${(e as Error).message.split("\n")[0].slice(0, 200)}`);
        send(res, 500, { error: (e as Error).message.split("\n")[0].slice(0, 200) });
      }
    })
    .listen(port, "0.0.0.0", () => log("api", `listening on :${port}`));
}
