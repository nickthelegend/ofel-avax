// A cross-process lock for wallets shared by several market processes (one agent and one house per market, all with
// the same key). Every transaction from such a wallet, and every eERC transfer (whose proof spends the current
// encrypted balance), runs inside the lock, so nonces and private balances never race between markets.
// The lock is a directory under OFEL_LOCK_DIR (a volume shared by the containers); with no OFEL_LOCK_DIR it is a no-op.
import { mkdirSync, rmSync, statSync } from "node:fs";

const DIR = process.env.OFEL_LOCK_DIR;
const STALE_MS = 180_000;

export async function withLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  if (!DIR) return fn();
  const path = `${DIR}/${name}.lock`;
  for (;;) {
    try {
      mkdirSync(path);
      break;
    } catch {
      try {
        if (Date.now() - statSync(path).mtimeMs > STALE_MS) rmSync(path, { recursive: true, force: true });
      } catch {}
      await new Promise((r) => setTimeout(r, 200 + Math.random() * 300));
    }
  }
  try {
    return await fn();
  } finally {
    rmSync(path, { recursive: true, force: true });
  }
}
