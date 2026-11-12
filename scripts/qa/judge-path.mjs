// The zero-setup judge path on the desk, driven in one headless Chrome (shared lock) with a brand-new Test wallet:
// Start with a test wallet → Get test funds → seal a buy → Try to open it now (refused) → close → one price →
// settle privately. Real transactions on the Ofel L1; screenshots of every step at 1440 (and the key ones at 375).
//   OFEL_QA_URL=https://ofel-desk.vercel.app OFEL_QA_OUT=<dir> node scripts/qa/judge-path.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";
import { withChromeLock } from "/Volumes/Extreme SSD/Projects/grokbot/orchestration/chrome-lock.mjs";

const BASE = process.env.OFEL_QA_URL ?? "http://127.0.0.1:5361";
const OUT = process.env.OFEL_QA_OUT ?? "/Volumes/Extreme SSD/Projects/grokbot/orchestration/shots/avax-ofel/desk-v2/judge-path";
mkdirSync(OUT, { recursive: true });
const log = [];
const say = (m) => {
  const line = `${new Date().toISOString().slice(11, 19)} ${m}`;
  log.push(line);
  console.log(line);
};

await withChromeLock(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const errors = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    let page = await ctx.newPage();
    let crashed = false;
    const watch = (p) => {
      p.on("pageerror", (e) => errors.push(String(e)));
      p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
      p.on("crash", () => (crashed = true));
    };
    watch(page);
    // The proofs run in the page, so a busy Mac can kill the renderer. The test wallet and the sealed order live in
    // this context's storage, so a fresh tab picks the run up where it was.
    const revive = async () => {
      if (!crashed) return;
      say("renderer crashed: reopening the desk in a new tab (same wallet)");
      crashed = false;
      page = await ctx.newPage();
      watch(page);
      await page.goto(`${BASE}/desk`, { waitUntil: "networkidle" });
      await page.waitForTimeout(8000);
    };
    const shot = async (name, opts = {}) => {
      await revive();
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${OUT}/${name}-1440.png`, fullPage: opts.full ?? false });
      if (opts.phone) {
        await page.setViewportSize({ width: 375, height: 812 });
        await page.waitForTimeout(1200);
        if (opts.phone !== true) await page.locator(opts.phone).first().scrollIntoViewIfNeeded().catch(() => {});
        await page.screenshot({ path: `${OUT}/${name}-375.png`, fullPage: opts.phoneFull ?? false });
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.waitForTimeout(800);
      }
      say(`shot ${name}`);
    };
    const btn = (name) => page.getByRole("button", { name });
    const until = async (what, fn, ms, reloadEvery = 0) => {
      const t0 = Date.now();
      let last = t0;
      while (Date.now() - t0 < ms) {
        await revive();
        if (reloadEvery && Date.now() - last > reloadEvery) {
          say(`no change for ${reloadEvery / 1000} s while waiting for ${what}: reloading the desk (same wallet)`);
          last = Date.now();
          await page.reload({ waitUntil: "networkidle" }).catch(() => (crashed = true));
          await page.waitForTimeout(8000);
        }
        if (await fn().catch(() => false)) return true;
        await page.waitForTimeout(1500);
      }
      throw new Error(`timed out waiting for ${what}`);
    };

    await page.goto(`${BASE}/desk`, { waitUntil: "networkidle" });
    await page.waitForTimeout(8000);
    await shot("01-desk-signed-out", { phone: true, phoneFull: true, full: true });

    await btn(/Start with a test wallet/).first().click();
    await until("the setup steps", async () => (await btn(/Get test funds|Finish setup/).count()) > 0, 30000);
    await shot("02-new-wallet-setup", { phone: "[data-film=setup]" });

    await btn(/Get test funds|Finish setup/).first().click();
    const seen = new Set();
    await until(
      "setup to finish",
      async () => {
        const t = (await page.locator("[data-film=get-funds]").textContent().catch(() => "")) ?? "";
        const key = t.replace(/[^A-Za-z ]/g, "").trim().slice(0, 30);
        if (t.includes("…") && key && !seen.has(key)) {
          seen.add(key);
          await shot(`03-setup-${seen.size}`);
        }
        const err = await page.locator(".setup .sheet-err").textContent().catch(() => null);
        if (err) throw new Error(`setup failed: ${err}`);
        return (await page.locator("[data-film=seal]").count()) > 0;
      },
      6 * 60000,
    );
    say("setup done");

    // A batch with at least 25 s left, so the order lands before the close.
    await until(
      "an open batch with time left",
      async () => {
        if (await page.locator("[data-film=seal]").isDisabled()) return false;
        const c = (await page.locator("[data-film=countdown]").textContent()) ?? "";
        const [m, s] = c.split(":").map(Number);
        return m * 60 + s >= 25;
      },
      4 * 60000,
    );
    await page.getByRole("button", { name: "1,000", exact: true }).click();
    await shot("04-ticket-ready", { phone: "[data-film=ticket]" });
    await page.locator("[data-film=seal]").click();
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${OUT}/05-sealing-1440.png` });
    say("shot 05-sealing");
    await until("the order status", async () => (await page.locator("[data-film=order-status]").count()) > 0, 120000);
    await page.waitForTimeout(5000);
    await shot("06-sealed", { full: true, phone: "[data-film=order-status]" });

    await page.locator("[data-film=try-open]").click();
    await until("the refusal", async () => (await page.locator("[data-film=refused]").count()) > 0, 60000);
    await page.locator("[data-film=sealed-book]").scrollIntoViewIfNeeded();
    await shot("07-refused", { phone: "[data-film=refused]" });

    await until("the batch to clear", async () => (await page.locator("[data-film=order-status] li.done").count()) >= 4, 6 * 60000);
    await page.waitForTimeout(3000);
    await shot("08-cleared", { full: true, phone: "[data-film=order-status]" });

    if (await page.locator("[data-film=settle]").count()) {
      await page.locator("[data-film=settle]").click();
      await shot("09-settling");
      await until("the pay-in", async () => (await page.locator("[data-film=settle]").count()) === 0, 5 * 60000);
      await shot("10-paid-in");
      await until("the agent's payout", async () => (await page.locator("[data-film=order-status] li.done").count()) >= 5, 8 * 60000, 120000).catch((e) => say(e.message));
      await shot("11-settled", { full: true, phone: "[data-film=order-status]" });
    } else say("no fill to settle (the limit did not cross)");

    for (const [tab, name] of [["tab-orders", "12-tab-orders"], ["tab-clears", "13-tab-clears"], ["tab-batches", "14-tab-batches"], ["tab-balances", "15-tab-balances"], ["tab-auditor", "16-tab-auditor"]]) {
      await page.locator(`[data-film=${tab}]`).click();
      await page.waitForTimeout(4000);
      await page.locator("[data-film=tabs]").scrollIntoViewIfNeeded();
      await shot(name, { phone: "[data-film=tabs]" });
    }
  } finally {
    writeFileSync(`${OUT}/judge-path.log`, log.join("\n") + `\nconsole errors: ${errors.length}\n${errors.join("\n")}\n`);
    say(`console errors: ${errors.length}`);
    await browser.close();
  }
});
