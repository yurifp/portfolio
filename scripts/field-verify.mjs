/* LED-field engine verification (headed) — node scripts/field-verify.mjs [baseURL] */
import { chromium } from 'playwright';
import fs from 'fs';

const URL = process.argv[2] || 'http://127.0.0.1:4322/';
const results = [];
const note = (id, pass, detail) => { results.push(!!pass); console.log((pass ? 'PASS' : 'FAIL') + ' ' + id + (detail ? ' — ' + detail : '')); };

async function main() {
  const b = await chromium.launch({ headless: false });
  const p = await b.newPage({ viewport: { width: 1878, height: 946 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e).slice(0, 120)));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 120)); });
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(2200);
  await p.evaluate(() => window.scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * 0.21));
  await p.waitForTimeout(1200);

  /* 1. x-fraction uniformity (chi-square, 10 bins) — SPAWN positions only
     (persistent drops would correlate samples; only first sight counts) */
  const chi = await p.evaluate(() => new Promise((res) => {
    const bins = new Array(10).fill(0);
    const seen = new Set();
    let n = 0;
    const iv = setInterval(() => {
      for (const d of window.__panel.drops()) {
        const key = d.id + ':' + d.seq;
        if (seen.has(key)) continue;
        seen.add(key);
        bins[Math.min(9, Math.floor((d.x % 1) * 10))]++;
        n++;
      }
      if (n >= 1000) { clearInterval(iv); fin(); }
    }, 200);
    const fin = () => { const e = n / 10; let x2 = 0; for (const b2 of bins) x2 += (b2 - e) ** 2 / e; res({ x2: +x2.toFixed(2), n, bins: bins.map((v) => Math.round(v / n * 100)) }); };
    setTimeout(() => { clearInterval(iv); fin(); }, 25000);
  }));
  note('X-UNIFORME (nascimentos, n=' + chi.n + ')', chi.x2 < 16.92, 'χ²=' + chi.x2 + ' (crit 16.92), bins ' + JSON.stringify(chi.bins));

  /* 2. no uniform rectangle ≥5×10 for >0.5s */
  const rects = await p.evaluate(() => new Promise((res) => {
    let bad = 0, checks = 0;
    const seen = new Map();
    const iv = setInterval(() => {
      const pn = window.__panel;
      const E = pn.energy();
      for (let t = 0; t < 12; t++) {
        const r0 = Math.floor(Math.random() * (pn.rows - 10));
        const c0 = Math.floor(Math.random() * (pn.cols - 5));
        let s = 0, s2 = 0;
        for (let r = r0; r < r0 + 10; r++) for (let c = c0; c < c0 + 5; c++) { const v = E[r * pn.cols + c]; s += v; s2 += v * v; }
        const n = 50, mean = s / n;
        const std = Math.sqrt(Math.max(0, s2 / n - mean * mean));
        if (mean > 0.05 && std / Math.max(mean, 0.001) < 0.05) {
          const key = r0 + ':' + c0;
          const hit = (seen.get(key) || 0) + 1;
          seen.set(key, hit);
          if (hit >= 2) bad++;
        }
      }
      if (++checks >= 12) { clearInterval(iv); res({ bad }); }
    }, 500);
  }));
  note('SEM RETÂNGULO uniforme 5×10', rects.bad === 0, rects.bad + ' persistências');

  /* 3. aspect ratio: per-drop tail/kernel-width (curtains legitimately
     merge connected components, so component analysis under-counts) */
  const aspect = await p.evaluate(() => {
    const ds = window.__panel.drops();
    const ratios = ds.filter((d) => d.y > 4 && d.y < window.__panel.rows - 2).map((d) => d.tail / Math.max(1, 2 * (d.layer === 2 ? 1.0 : d.layer === 1 ? 0.7 : 0.5)));
    ratios.sort((a, z) => a - z);
    return { median: +ratios[Math.floor(ratios.length / 2)].toFixed(2), n: ratios.length };
  });
  note('ASPECTO ≥3:1 (por gota: cauda/largura)', aspect.median >= 3, 'mediana ' + aspect.median + ':1 (' + aspect.n + ' gotas)');

  /* 4. heads monotonic per FRAME (parallel rAF sampler, id+seq match) */
  const mono = await p.evaluate(() => new Promise((res) => {
    let prev = null, regress = 0, jump = 0, n = 0, frames = 0;
    const loop = () => {
      const ds = window.__panel.drops();
      if (prev) for (const d of ds) {
        const q = prev.find((x) => x.id === d.id && x.seq === d.seq);
        if (q) { n++; if (d.y < q.y - 0.01) regress++; if (d.y - q.y > 1.05) jump++; }
      }
      prev = ds.map((d) => ({ ...d }));
      if (++frames > 200) { res({ regress, jump, n }); return; }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    setTimeout(() => res({ regress, jump, n, timeout: 1 }), 20000);
  }));
  note('CABEÇAS monotônicas s/ salto (por frame)', mono.regress === 0 && mono.jump <= 3, mono.regress + ' retrocessos, ' + mono.jump + ' saltos, ' + mono.n + ' amostras');

  /* 5. brightness stability p95 ≤ 25% per frame (parallel rAF) */
  const stab = await p.evaluate(() => new Promise((res) => {
    const pn = window.__panel;
    let prev = null; const hist = []; let frames = 0;
    const loop = () => {
      const E = pn.energy();
      if (prev) {
        const ds = pn.drops();
        for (let k = 0; k < prev.idx.length; k++) {
          const i = prev.idx[k];
          const nearHead = ds.some((d) => Math.abs(d.x - (i % pn.cols)) < 2 && Math.abs(d.y - Math.floor(i / pn.cols)) < 2);
          if (nearHead) continue;
          const a = prev.vals[k], b2 = E[i];
          if (a > 0.05 && b2 > 0.05) hist.push(Math.abs(b2 - a) / a);
        }
      }
      const idx = [], vals = [];
      for (let t = 0; t < 900 && idx.length < 60; t++) { const i = Math.floor(Math.random() * E.length); if (E[i] > 0.08) { idx.push(i); vals.push(E[i]); } }
      prev = { idx, vals };
      if (++frames > 150) { hist.sort((a, z) => a - z); res({ p95: +(hist[Math.floor(hist.length * 0.95)] * 100).toFixed(1), n: hist.length }); return; }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    setTimeout(() => res({ p95: -1 }), 20000);
  }));
  note('ESTABILIDADE ≤25%/frame', stab.p95 >= 0 && stab.p95 <= 25, 'p95 ' + stab.p95 + '% (' + stab.n + ')');

  /* 6. luminance band over 60s + histogram */
  const lum = await p.evaluate(() => new Promise((res) => {
    const lums = [];
    const iv = setInterval(() => lums.push(window.__panel.meanLum), 2000);
    setTimeout(() => {
      clearInterval(iv);
      const L = window.__panel.levels();
      let peaks = 0, off = 0;
      for (const v of L) { if (v >= 9) peaks++; if (v === 0) off++; }
      res({ min: Math.min(...lums), max: Math.max(...lums), mean: +(lums.reduce((a, x) => a + x, 0) / lums.length).toFixed(3), offPct: Math.round(off / L.length * 100), peaksPct: +(peaks / L.length * 100).toFixed(1) });
    }, 60000);
  }));
  note('LUMINÂNCIA 0.22-0.32 (60s)', lum.mean >= 0.22 && lum.mean <= 0.32, 'média ' + lum.mean + ' [' + lum.min.toFixed(3) + '-' + lum.max.toFixed(3) + ']; off ' + lum.offPct + '%, picos ' + lum.peaksPct + '%');

  /* 7. frame-rate independence via simulated-time rate */
  const rateAt = async (url) => {
    const pp = await b.newPage({ viewport: { width: 1878, height: 946 } });
    await pp.goto(url, { waitUntil: 'networkidle' });
    await pp.waitForTimeout(1500);
    await pp.evaluate(() => window.scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * 0.21));
    await pp.waitForTimeout(400);
    const r = await pp.evaluate(() => new Promise((res) => { const t0 = window.__panel.tick(); const rt0 = performance.now(); setTimeout(() => res(+((window.__panel.tick() - t0) / ((performance.now() - rt0) / 1000)).toFixed(3)), 2000); }));
    await pp.close();
    return r;
  };
  const v60 = await rateAt(URL);
  const v10 = await rateAt(URL + '?fps=6');
  note('TAXA-INDEPENDENTE 10 vs 60fps', Math.abs(v10 - v60) / v60 <= 0.03, 'sim/real: 60fps=' + v60 + ', 10fps=' + v10);

  /* 8. warm-up: rain at all heights on first visible frame */
  const pw = await b.newPage({ viewport: { width: 1878, height: 946 } });
  await pw.goto(URL, { waitUntil: 'domcontentloaded' });
  const first = await pw.evaluate(() => new Promise((res) => {
    const check = () => {
      const pn = window.__panel;
      if (!pn) { setTimeout(check, 100); return; }
      const ds = pn.drops();
      const bands = new Array(4).fill(0);
      for (const d of ds) { const b2 = Math.max(0, Math.min(3, Math.floor(d.y / pn.rows * 4))); bands[b2]++; }
      res({ n: ds.length, bands });
    };
    check();
  }));
  await pw.close();
  note('AQUECIMENTO', first.n > 20 && first.bands.every((x) => x > 0), JSON.stringify(first));

  /* 9. 60s no-repeat */
  const rep = await p.evaluate(() => new Promise((res) => {
    const hashes = [];
    const iv = setInterval(() => hashes.push(window.__panel.hash()), 100);
    setTimeout(() => {
      clearInterval(iv);
      const win = 30;
      let repeats = 0;
      const seen = new Set();
      for (let i = 0; i + win <= hashes.length; i += 5) {
        const k = hashes.slice(i, i + win).join(',');
        if (seen.has(k)) repeats++;
        seen.add(k);
      }
      res(repeats);
    }, 60000);
  }));
  note('SEM REPETIÇÃO (60s)', rep === 0, rep + ' janelas repetidas');

  /* 10. perf DPR1/2 */
  for (const dpr of [1, 2]) {
    const ctx = await b.newContext({ viewport: { width: 1878, height: 946 }, deviceScaleFactor: dpr });
    const pp = await ctx.newPage();
    await pp.goto(URL, { waitUntil: 'networkidle' });
    await pp.waitForTimeout(1500);
    await pp.evaluate(() => window.scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * 0.21));
    await pp.waitForTimeout(800);
    const perf = await pp.evaluate(() => new Promise((res2) => {
      const times = [];
      const orig = window.requestAnimationFrame.bind(window);
      let n = 0;
      window.requestAnimationFrame = (cb) => orig((t) => { const s = performance.now(); cb(t); times.push(performance.now() - s); if (++n < 180) orig(() => {}); });
      orig(() => {});
      setTimeout(() => { times.sort((a, z) => a - z); res2({ p95: +times[Math.floor(times.length * 0.95)].toFixed(2), sim: window.__panel.simMs }); }, 3200);
    }));
    note('PERF DPR' + dpr, perf.p95 <= 5.5, 'frame p95 ' + perf.p95 + 'ms (sim ' + perf.sim + 'ms)');
    await ctx.close();
  }

  /* 11. contact sheets: 10×100ms now + 30s later */
  fs.mkdirSync('evidence/field-after-seq', { recursive: true });
  for (let i = 0; i < 10; i++) { await p.screenshot({ path: 'evidence/field-after-seq/f' + String(i).padStart(2, '0') + '.png', clip: { x: 620, y: 170, width: 600, height: 600 } }); await p.waitForTimeout(100); }
  fs.mkdirSync('evidence/field-after-seq2', { recursive: true });
  await p.waitForTimeout(30000);
  for (let i = 0; i < 10; i++) { await p.screenshot({ path: 'evidence/field-after-seq2/f' + String(i).padStart(2, '0') + '.png', clip: { x: 620, y: 170, width: 600, height: 600 } }); await p.waitForTimeout(100); }

  /* 12. transitions screenshots */
  await p.evaluate(() => window.scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * 0.086));
  await p.waitForTimeout(900);
  await p.screenshot({ path: 'evidence/field-wave.png' });
  await p.evaluate(() => window.scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * 0.258));
  await p.waitForTimeout(900);
  await p.screenshot({ path: 'evidence/field-sweep.png' });

  note('CONSOLE', errs.length === 0, errs.length ? errs[0] : 'limpo');

  const red = await b.newPage({ viewport: { width: 1878, height: 946 }, reducedMotion: 'reduce' });
  await red.goto(URL, { waitUntil: 'networkidle' });
  await red.waitForTimeout(1000);
  const rstat = await red.evaluate(() => ({ static: document.querySelector('.flip-stage')?.hasAttribute('data-static'), drops: window.__panel?.drops().length }));
  note('REDUCED', !!rstat.static, JSON.stringify(rstat));
  await b.close();

  const fails = results.filter((x) => !x).length;
  console.log('\nRESUMO: ' + (results.length - fails) + '/' + results.length + (fails ? ' — FALHAS: ver acima' : ' — ALL PASS'));
}
main().catch((e) => { console.error(e); process.exit(1); });
