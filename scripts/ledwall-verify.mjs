/* LED wall verification battery — run with: node scripts/ledwall-verify.mjs */
import { chromium } from 'playwright';

const URL = 'http://127.0.0.1:4322/';

async function main() {
  /* --- headless: histogram, tiers, errors --- */
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1878, height: 946 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e).slice(0, 120)));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 120)); });
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1800);
  const scroll = (f) => p.evaluate((f) => window.scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * f), f);
  await scroll(0.18);
  await p.waitForTimeout(1000);
  console.log('center hist:', JSON.stringify(await p.evaluate(() => window.__ledwall.histogram())));
  for (const t of [1, 2, 0]) {
    await p.evaluate((t) => window.__ledwall.setTier(t), t);
    await p.waitForTimeout(400);
    console.log('tier', t, 'hist:', JSON.stringify(await p.evaluate(() => window.__ledwall.histogram())));
  }
  console.log('headless errors:', errs.length ? errs : 'none');
  await b.close();

  /* --- headed: real-GPU fps in scene --- */
  const bh = await chromium.launch({ headless: false });
  for (const [w, h, dpr] of [[1878, 946, 1], [1878, 946, 2], [1440, 900, 1], [1440, 900, 2]]) {
    const ctx = await bh.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
    const pp = await ctx.newPage();
    await pp.goto(URL, { waitUntil: 'networkidle' });
    await pp.waitForTimeout(1500);
    for (let i = 0; i < 3; i++) { await pp.mouse.wheel(0, 500); await pp.waitForTimeout(120); }
    await pp.waitForTimeout(800);
    const f0 = await pp.evaluate(() => window.__ledwall.frames);
    await pp.waitForTimeout(1000);
    const m = await pp.evaluate(() => {
      const lw = window.__ledwall;
      return { p: +(window.__flipbook.progress().toFixed ? window.__flipbook.progress() : -1).toFixed(3), fps: lw.fps, tier: lw.tier, res: lw.resScale, active: lw.active };
    });
    m.framesIn1s = (await pp.evaluate(() => window.__ledwall.frames)) - f0;
    console.log(`HEADED ${w}x${h} DPR${dpr}:`, JSON.stringify(m));
    await ctx.close();
  }
  await bh.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
