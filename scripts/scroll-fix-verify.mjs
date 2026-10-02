/* Scroll-freeze fix verification — node scripts/scroll-fix-verify.mjs [baseURL] */
import { chromium } from 'playwright';
import fs from 'fs';

const URL = process.argv[2] || 'http://127.0.0.1:4322/';
const results = [];
const note = (id, pass, detail) => { results.push(!!pass); console.log((pass ? 'PASS' : 'FAIL') + ' ' + id + (detail ? ' — ' + detail : '')); };

async function runCombo(b, w, h, dpr) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e).slice(0, 100)));
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(2200);
  await p.evaluate(() => {
    window.__diag = { raf: [], t: [], p: [] };
    let last = performance.now();
    const loop = (now) => { window.__diag.raf.push(now - last); last = now; window.__diag.t.push(window.__panel.tick()); window.__diag.p.push(window.scrollY / (document.documentElement.scrollHeight - innerHeight)); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  });

  const legRate = () => p.evaluate((useLastRun) => {
    const d = window.__diag;
    /* contiguous in-window runs — take the first (leg 1) or the LAST
       (leg 2); spans across runs would include by-design frozen time */
    const runs = [];
    let s = -1;
    for (let i = 0; i < d.p.length; i++) {
      const inWin = d.p[i] > 0.10 && d.p[i] < 0.25;
      if (inWin && s < 0) s = i;
      if (!inWin && s >= 0) { runs.push([s, i - 1]); s = -1; }
    }
    if (s >= 0) runs.push([s, d.p.length - 1]);
    if (!runs.length) return { rate: -1 };
    const [a, b2] = useLastRun ? runs[runs.length - 1] : runs[0];
    const sim = d.t[b2] - d.t[a];
    const real = d.raf.slice(a, b2).reduce((x, y) => x + y, 0) / 1000;
    return { rate: +(sim / Math.max(0.001, real)).toFixed(3), sim: +sim.toFixed(2), real: +real.toFixed(2), run: [a, b2] };
  }, undefined);
  const rafStats = () => p.evaluate(() => { const r = [...window.__diag.raf].sort((a, z) => a - z); return { p50: +r[Math.floor(r.length / 2)].toFixed(1), p95: +r[Math.floor(r.length * 0.95)].toFixed(1), max: +Math.max(...window.__diag.raf).toFixed(1), over33: +(window.__diag.raf.filter((x) => x > 33).length / window.__diag.raf.length * 100).toFixed(1) }; });

  const scrollLeg = (from, to) => p.evaluate(async ([from, to]) => {
    const total = document.documentElement.scrollHeight - innerHeight;
    const start = performance.now();
    await new Promise((done) => {
      const tick = () => {
        const t = (performance.now() - start) / 4000;
        if (t >= 1) { done(); return; }
        window.scrollTo(0, total * (from + (to - from) * t));
        setTimeout(tick, 25);
      };
      tick();
    });
  }, [from, to]);

  /* 0% -> 100% continuous (~4s), then back */
  await scrollLeg(0, 1);
  const leg1 = await p.evaluate(() => {
    const d = window.__diag;
    let first = -1, last = -1;
    for (let i = 0; i < d.p.length; i++) { if (d.p[i] > 0.10 && d.p[i] < 0.25) { if (first < 0) first = i; last = i; } }
    if (first < 0) return { rate: -1 };
    const sim = d.t[last] - d.t[first];
    const real = d.raf.slice(first, last).reduce((a, x) => a + x, 0) / 1000;
    return { rate: +(sim / Math.max(0.001, real)).toFixed(3) };
  });
  await scrollLeg(1, 0);
  const leg2 = await p.evaluate(() => {
    const d = window.__diag;
    /* LAST contiguous in-window run (the return crossing) */
    const runs = [];
    let s = -1;
    for (let i = 0; i < d.p.length; i++) {
      const inWin = d.p[i] > 0.10 && d.p[i] < 0.25;
      if (inWin && s < 0) s = i;
      if (!inWin && s >= 0) { runs.push([s, i - 1]); s = -1; }
    }
    if (s >= 0) runs.push([s, d.p.length - 1]);
    if (!runs.length) return { rate: -1 };
    const [a, b2] = runs[runs.length - 1];
    const sim = d.t[b2] - d.t[a];
    const real = d.raf.slice(a, b2).reduce((x, y) => x + y, 0) / 1000;
    return { rate: +(sim / Math.max(0.001, real)).toFixed(3) };
  });
  const rafSorted = await rafStats();
  return { leg1, leg2, errs, rafSorted, p, ctx };
}

async function main() {
  const b = await chromium.launch({ headless: false });

  for (const [w, h, dpr] of [[1878, 946, 1], [1878, 946, 2], [1440, 900, 1], [1440, 900, 2]]) {
    const { leg1, leg2, errs, rafSorted, ctx } = await runCombo(b, w, h, dpr);
    note(`${w}×${h} DPR${dpr} — ida 0→100%`, rafSorted.p95 < 33 && leg1.rate >= 0.95 && leg1.rate <= 1.45, `rAF p50/p95/max ${rafSorted.p50}/${rafSorted.p95}/${rafSorted.max}ms, >33ms ${rafSorted.over33}%, sim/real na janela ${leg1.rate}`);
    note(`${w}×${h} DPR${dpr} — volta 100→0%`, leg2.rate >= 0.95 && leg2.rate <= 1.45, `sim/real na janela ${leg2.rate}`);
    note(`${w}×${h} DPR${dpr} — console`, errs.length === 0, errs.length ? errs[0] : 'limpo');
    await ctx.close();
  }

  /* drop per-frame tracking across scroll->still boundary */
  const p2 = await b.newPage({ viewport: { width: 1878, height: 946 } });
  await p2.goto(URL, { waitUntil: 'networkidle' });
  await p2.waitForTimeout(2000);
  await p2.evaluate(() => window.scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * 0.21));
  await p2.waitForTimeout(600);
  const boundary = await p2.evaluate(async () => {
    const pn = window.__panel;
    let prev = null, maxJump = 0, regress = 0, n = 0;
    const total = document.documentElement.scrollHeight - innerHeight;
    await new Promise((done) => {
      const t0 = performance.now();
      const loop = () => {
        const ds = pn.drops();
        if (prev) for (const d of ds) {
          const q = prev.find((x) => x.id === d.id && x.seq === d.seq);
          if (q) { n++; const j = d.y - q.y; if (j > maxJump) maxJump = j; if (j < -0.01) regress++; }
        }
        prev = ds.map((d) => ({ ...d }));
        const t = (performance.now() - t0) / 2600;
        if (t >= 1) { done(); return; }
        if (t < 0.7) window.scrollTo(0, total * (0.215 + 0.04 * Math.sin(t * 9))); /* scroll... */
        requestAnimationFrame(loop); /* ...then still */
      };
      requestAnimationFrame(loop);
    });
    return { maxJump: +maxJump.toFixed(2), regress, n };
  });
  note('GOTA na fronteira rolando→parado', boundary.regress === 0 && boundary.maxJump <= 1.05, 'pior avanço ' + boundary.maxJump + ' LED/frame, ' + boundary.regress + ' retrocessos (' + boundary.n + ' amostras)');

  /* contact sheet 10×100ms DURING scroll */
  fs.mkdirSync('evidence/scroll-sheet', { recursive: true });
  await p2.evaluate(() => window.scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * 0.16));
  await p2.waitForTimeout(400);
  const scrollLoop = p2.evaluate(async () => {
    const total = document.documentElement.scrollHeight - innerHeight;
    const t0 = performance.now();
    await new Promise((done) => {
      const tick = () => {
        const t = (performance.now() - t0) / 1400;
        if (t >= 1) { done(); return; }
        window.scrollTo(0, total * (0.19 + 0.03 * t));
        setTimeout(tick, 20);
      };
      tick();
    });
  });
  for (let i = 0; i < 10; i++) { await p2.screenshot({ path: 'evidence/scroll-sheet/f' + String(i).padStart(2, '0') + '.png', clip: { x: 620, y: 170, width: 600, height: 600 } }); await p2.waitForTimeout(100); }
  await scrollLoop;

  /* transitions DURING scroll: wave + sweep screenshots */
  await p2.evaluate(() => window.scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * 0.075));
  await p2.waitForTimeout(700);
  await p2.screenshot({ path: 'evidence/scroll-during-wave.png' });
  const waveAlive = await p2.evaluate(() => window.__panel.drops().length);
  note('ONDA durante scroll', waveAlive > 10, waveAlive + ' gotas em voo');
  await p2.evaluate(() => window.scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * 0.256));
  await p2.waitForTimeout(700);
  await p2.screenshot({ path: 'evidence/scroll-during-sweep.png' });

  /* tune HUD smoke (?tune=1) */
  const pt = await b.newPage({ viewport: { width: 1878, height: 946 } });
  await pt.goto(URL + '?tune=1', { waitUntil: 'networkidle' });
  await pt.waitForTimeout(1200);
  const hud = await pt.evaluate(() => {
    const el = [...document.querySelectorAll('pre')].find((p) => p.textContent.includes('rAF ms'));
    return el ? el.textContent.slice(0, 200) : 'NO HUD';
  });
  note('HUD ?tune=1', hud.includes('rAF ms') && hud.includes('mult'), JSON.stringify(hud.slice(0, 120)));
  await pt.close();

  await b.close();
  const fails = results.filter((x) => !x).length;
  console.log('\nRESUMO: ' + (results.length - fails) + '/' + results.length + (fails ? ' — FALHAS' : ' — ALL PASS'));
}
main().catch((e) => { console.error(e); process.exit(1); });
