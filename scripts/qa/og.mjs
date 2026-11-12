// Renders the social card (web/public/og.jpg, 1200x630) from the ChatGPT scene web/public/art/og-bg.webp plus real
// type, so the image itself never carries generated text. One headless Chrome under the shared lock.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { withChromeLock } from "/Volumes/Extreme SSD/Projects/grokbot/orchestration/chrome-lock.mjs";

const web = fileURLToPath(new URL("../../web/public/", import.meta.url));
const bg = readFileSync(web + "art/og-bg.webp").toString("base64");
const mark = readFileSync(web + "art/mark.webp").toString("base64");
const html = `<!doctype html><html><head>
<link href="https://fonts.googleapis.com/css2?family=Epilogue:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  html,body{margin:0;width:1200px;height:630px;background:#11130f;font-family:Epilogue,sans-serif;color:#ebe5d8}
  .bg{position:absolute;inset:0;background:url(data:image/webp;base64,${bg}) 70% 18%/cover no-repeat}
  .shade{position:absolute;inset:0;background:linear-gradient(90deg,#11130f 0%,rgba(17,19,15,.85) 38%,rgba(17,19,15,0) 62%)}
  .t{position:absolute;left:72px;top:92px;width:600px}
  .brand{display:flex;align-items:center;gap:14px;font-weight:600;font-size:30px;letter-spacing:-.02em}
  .brand img{width:44px;height:44px}
  h1{margin:56px 0 0;font-weight:500;font-size:76px;line-height:.98;letter-spacing:-.05em}
  p{margin:28px 0 0;font-size:25px;line-height:1.4;color:#c8c2b4;max-width:520px}
</style></head><body><div class="bg"></div><div class="shade"></div>
<div class="t"><div class="brand"><img src="data:image/webp;base64,${mark}">Ofel</div>
<h1>Trade size without being front-run.</h1><p>Private block trading for funds, DAOs and treasuries, on its own Avalanche L1.</p></div>
</body></html>`;

await withChromeLock(async () => {
  const b = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const p = await b.newPage({ viewport: { width: 1200, height: 630 } });
    await p.setContent(html, { waitUntil: "networkidle" });
    await p.evaluate(() => document.fonts.ready);
    await p.screenshot({ path: web + "og.jpg", type: "jpeg", quality: 86 });
  } finally {
    await b.close();
  }
});
console.log("wrote web/public/og.jpg");
