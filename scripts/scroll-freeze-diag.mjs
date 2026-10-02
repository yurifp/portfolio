/* Scroll-freeze diagnosis: measures rAF intervals, sim-dt and t_rain
   advance during continuous scroll vs at rest — node scripts/scroll-freeze-diag.mjs [baseURL] */
import { chromium } from 'playwright';

const URL = process.argv[2] || 'http://127.0.0.1:4322/';

async function main() {
  const b = await chromium.launch({ headless: false });
  const p = await b.newPage({ viewport: { width: 1878, height: 946 } });
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(2200);

  /* in-page instrument: rAF intervals + t_rain samples (no code changes needed) */
  await p.evaluate(() => {
    window.__diag = { raf: [], t: [], stamps: [] };
    let last = performance.now();
    const loop = (now) => {
      window.__diag.raf.push(now - last);
      last = now;
      window.__diag.t.push(window.__panel ? window.__panel.tick() : -1);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });

  const go = async (f) => p.evaluate((f) => window.scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * f), f);

  /* AT REST at 21% */
  await go(0.21);
  await p.waitForTimeout(1200);
  const still = await p.evaluate(() => {
    const d = window.__diag;
    const n0 = d.raf.length;
    const t0 = d.t.length;
    return new Promise((res) => setTimeout(() => {
      const raf = d.raf.slice(n0), t = d.t.slice(t0);
      const dt = t[t.length - 1] - t[0];
      res({ frames: raf.length, simAdvance: +dt.toFixed(3), simPerReal: +(dt / (raf.length / 60)).toFixed(3) });
    }, 2000));
  });

  /* reset buffers, then CONTINUOUS WHEEL SCROLL around the scene */
  await p.evaluate(() => { window.__diag.raf = []; window.__diag.t = []; });
  const scrollDur = 4000;
  await p.evaluate(async (dur) => {
    const total = document.documentElement.scrollHeight - innerHeight;
    const t0 = performance.now();
    await new Promise((done) => {
      const tick = () => {
        const t = (performance.now() - t0) / dur;
        if (t >= 1) { done(); return; }
        /* continuous small wheels: 0.15 -> 0.30 and back */
        const f = 0.225 + 0.075 * Math.sin(t * Math.PI * 4);
        window.scrollTo(0, total * f);
        setTimeout(tick, 30);
      };
      tick();
    });
  }, scrollDur);
  const wheel = await p.evaluate(() => {
    const d = window.__diag;
    const raf = d.raf, t = d.t;
    const dt = t[t.length - 1] - t[0];
    const sorted = [...raf].sort((a, z) => a - z);
    const pct = (q) => +sorted[Math.floor(sorted.length * q)].toFixed(1);
    return { frames: raf.length, simAdvance: +dt.toFixed(3), simPerReal: +(dt / (raf.reduce((a, x) => a + x, 0) / 1000)).toFixed(3), rafP50: pct(0.5), rafP95: pct(0.95), rafMax: +Math.max(...raf).toFixed(1), over33: +(raf.filter((x) => x > 33).length / raf.length * 100).toFixed(1) };
  });

  /* drop tracking: same drop id+seq across the scroll->still boundary */
  await p.evaluate(() => { window.__diag.drops = []; });
  await p.evaluate(async () => {
    const collect = () => { window.__diag.drops.push(window.__panel.drops().map((d) => ({ id: d.id, seq: d.seq, y: d.y }))); };
    const total = document.documentElement.scrollHeight - innerHeight;
    const t0 = performance.now();
    await new Promise((done) => {
      const tick = () => {
        const t = (performance.now() - t0) / 3000;
        collect();
        if (t < 0.66) window.scrollTo(0, total * (0.225 + 0.05 * Math.sin(t * 12)));
        else if (t >= 1) { done(); return; }
        setTimeout(tick, 100);
      };
      tick();
    });
  });
  const dropTrack = await p.evaluate(() => {
    const ds = window.__diag.drops;
    /* find a drop present across the boundary (sample ~2/3) */
    const boundary = Math.floor(ds.length * 0.66);
    const before = ds[boundary - 1], after = ds[boundary + 2];
    if (!before || !after) return null;
    let jump = -1, id = -1;
    for (const d of before) {
      const q = after.find((x) => x.id === d.id && x.seq === d.seq);
      if (q) { const j = Math.abs(q.y - d.y); if (j > jump) { jump = j; id = d.id; } }
    }
    return { boundaryIdx: boundary, maxJumpAtBoundary: +jump.toFixed(2), id };
  });

  /* keyboard: ArrowDown bursts INSIDE the scene window (PageDown jumps out,
     and pausing outside the active window is by design) */
  await p.evaluate(() => { window.__diag.raf = []; window.__diag.t = []; });
  await go(0.18);
  await p.waitForTimeout(300);
  for (let i = 0; i < 45; i++) { await p.keyboard.press('ArrowDown'); await p.waitForTimeout(30); }
  const keys = await p.evaluate(() => {
    const d = window.__diag;
    const t = d.t;
    const dt = t[t.length - 1] - t[0];
    const ms = d.raf.reduce((a, x) => a + x, 0);
    return { frames: d.raf.length, simAdvance: +dt.toFixed(3), simPerReal: +(dt / (ms / 1000)).toFixed(3) };
  });

  console.log('PARADO  :', JSON.stringify(still));
  console.log('WHEEL   :', JSON.stringify(wheel));
  console.log('TECLADO :', JSON.stringify(keys));
  console.log('GOTA    :', JSON.stringify(dropTrack));
  await b.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
