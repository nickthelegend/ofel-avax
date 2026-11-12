import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// QA builds only (VITE_QA=1): inject the local test keys so Playwright can sign as the demo roles.
// Production builds never contain a key; `grep -r OFEL_ dist` must stay empty.
function qaKeys(): Record<string, string> | null {
  if (process.env.VITE_QA !== "1") return null;
  const envPath = fileURLToPath(new URL("../.env", import.meta.url));
  if (!existsSync(envPath)) throw new Error("QA build needs ../.env with OFEL_ALICE_PK, OFEL_BOB_PK, OFEL_AGENT_PK");
  const env = Object.fromEntries(
    readFileSync(envPath, "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
  );
  return { alice: env.OFEL_ALICE_PK, bob: env.OFEL_BOB_PK, agent: env.OFEL_AGENT_PK };
}

export default defineConfig({
  plugins: [react()],
  define: { __OFEL_QA_KEYS__: JSON.stringify(qaKeys()) },
  server: { port: 5361, fs: { allow: [".."] } },
  build: { chunkSizeWarningLimit: 4000, target: "es2022" },
  optimizeDeps: { esbuildOptions: { target: "es2022" } },
});
