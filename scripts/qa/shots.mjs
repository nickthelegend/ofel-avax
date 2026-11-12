// Screenshots of every route at 1440 and 375 from the QA build (web/dist-qa served on :5362),
// one headless Chrome at a time (shared lock). Fails on horizontal overflow or console errors.
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";
import { withChromeLock } from "/Volumes/Extreme SSD/Projects/grokbot/orchestration/chrome-lock.mjs";

const BASE = process.env.OFEL_QA_URL ?? "http://localhost:5362";
const OUT = "/Volumes/Extreme SSD/Projects/grokbot/orchestration/shots/avax-ofel";
mkdirSync(OUT, { recursive: true });
const batch = process.env.OFEL_QA_BATCH ?? "50";
const ROUTES = [
  { name: "landing", path: "/" },
  { name: "desk", path: "/desk", as: "alice", click: ["Decrypt my orders"] },
  { name: "batches", path: "/batches" },
  { name: "batch-detail", path: `/batches/${batch}`, click: ["Fetch and verify signatures"] },
  { name: "portfolio", path: "/portfolio", as: "alice", click: ["Decrypt my balances", "Decrypt my orders"] },
  { name: "auditor", path: "/auditor", as: "agent", click: ["Derive the auditor key and decrypt"] },
  { name: "auditor-locked", path: "/auditor", as: "bob" },
  { name: "validators", path: "/validators" },
];
const report = [];
await withChromeLock(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    for (const width of [1440, 375]) {
      for (const r of ROUTES) {
        const ctx = await browser.newContext({ viewport: { width, height: width === 375 ? 812 : 900 }, deviceScaleFactor: width === 375 ? 2 : 1 });
        await ctx.addInitScript((who) => { try { if (who) sessionStorage.setItem("ofel.qaRole", who); } catch {} }, r.as ?? "");
        const page = await ctx.newPage();
        const errors = [];
        page.on("pageerror", (e) => errors.push(String(e)));
        page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
        await page.goto(BASE + r.path, { waitUntil: "networkidle" });
        await page.waitForTimeout(2500);
        for (const label of r.click ?? []) {
          const b = page.getByRole("button", { name: label });
          if (await b.count()) { await b.first().click(); await page.waitForTimeout(5000); }
        }
        await page.waitForTimeout(1500);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        const file = `${OUT}/${r.name}-${width}.png`;
        await page.screenshot({ path: file, fullPage: true });
        report.push({ route: r.path, width, overflow, errors, file });
        console.log(`${r.name.padEnd(15)} ${width}  overflow ${overflow}px  errors ${errors.length}${errors.length ? "  " + errors[0].slice(0, 120) : ""}`);
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
  }
});
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
const bad = report.filter((x) => x.overflow > 0 || x.errors.length);
console.log(bad.length ? `FAIL: ${bad.length} route(s) with overflow or console errors` : `PASS: ${report.length} screenshots, no overflow, no console errors`);
process.exit(bad.length ? 1 : 0);
