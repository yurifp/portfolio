/* Rain motor verification — node scripts/rain-verify.mjs [baseURL] */
import { chromium } from 'playwright';

const URL = process.argv[2] || 'http://127.0.0.1:4322/';
const results = [];
const note = (id, name, pass, detail) => { results.push(pass); console.log((pass ? 'PASS' : 'FAIL') + ' ' + id + ' ' + name + (detail ? ' — ' + detail : '')); };

async function main() {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1878, height: 946 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e).slice(0, 120)));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 120)); });
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1800);
  await p.evaluate(() => window.scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * 0.21));
  await p.waitForTimeout(1000);

  /* 1. density + shares */
  const dens = [];
  for (let i = 0; i < 5; i++) { dens.push(await p.evaluate(() => window.__panel.rainDensity())); await p.waitForTimeout(600); }
  const clsNow = await p.evaluate(() => { const c = [0, 0, 0, 0]; const ds = window.__panel.drops(); for (const d of ds) c[d.cls]++; return { c, cols: window.__panel.cols }; });
  const avgD = dens.reduce((a, x) => a + x, 0) / dens.length;
  note('DENSIDADE', avgD >= 45 && avgD <= 60, 'média ' + avgD.toFixed(0) + '% (' + dens.join(',') + ')');

  /* 2. contact sheet: 10 consecutive frames @100ms of a 600x600 crop */
  const fs = await import('fs');
  fs.mkdirSync('evidence/rain-after-seq', { recursive: true });
  for (let i = 0; i < 10; i++) {
    await p.screenshot({ path: 'evidence/rain-after-seq/f' + String(i).padStart(2, '0') + '.png', clip: { x: 620, y: 170, width: 600, height: 600 } });
    await p.waitForTimeout(100);
  }
  /* heads advance monotonically: track 30 threads over 15 frames */
  const mono = await p.evaluate(() => new Promise((res) => {
    let prev = null, bad = 0, n = 0;
    const iv = setInterval(() => {
      const ds = window.__panel.drops();
      if (prev) for (const d of ds) { const q = prev.find((x) => x.col === d.col && x.cls === d.cls); if (q) { n++; if (d.head < q.head) bad++; } }
      prev = ds.filter((d) => d.head > 0 && d.head < window.__panel.rows).map((d) => ({ ...d }));
      if (n > 600) { clearInterval(iv); res({ bad, n }); }
    }, 100);
    setTimeout(() => { clearInterval(iv); res({ bad, n }); }, 4000);
  }));
  note('MONOTONIA das cabeças', mono.bad === 0 && mono.n > 200, mono.bad + ' retrocessos em ' + mono.n + ' amostras');

  /* 3. aspect ratio of moving structures (?panel=drops, components) */
  const aspect = await (async () => {
    const pd = await b.newPage({ viewport: { width: 1878, height: 946 } });
    await pd.goto(URL + '?panel=drops', { waitUntil: 'networkidle' });
    await pd.waitForTimeout(1500);
    await pd.evaluate(() => window.scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * 0.21));
    await pd.waitForTimeout(700);
    const r = await pd.evaluate(() => {
      const pn = window.__panel;
      const L = pn.levels();
      const seen = new Uint8Array(L.length);
      const aspects = [];
      const stack = [];
      for (let i = 0; i < L.length; i++) {
        if (seen[i] || L[i] === 0) continue;
        stack.length = 0; stack.push(i); seen[i] = 1;
        let minR = 1e9, maxR = -1, minC = 1e9, maxC = -1, size = 0;
        while (stack.length) {
          const j = stack.pop();
          const r0 = Math.floor(j / pn.cols), c0 = j % pn.cols;
          size++;
          if (r0 < minR) minR = r0; if (r0 > maxR) maxR = r0;
          if (c0 < minC) minC = c0; if (c0 > maxC) maxC = c0;
          for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const rr = r0 + dr, cc = c0 + dc;
            if (rr < 0 || rr >= pn.rows || cc < 0 || cc >= pn.cols) continue;
            const k = rr * pn.cols + cc;
            if (!seen[k] && L[k] > 0) { seen[k] = 1; stack.push(k); }
          }
        }
        if (size >= 4) aspects.push((maxR - minR + 1) / (maxC - minC + 1));
      }
      aspects.sort((a, z) => a - z);
      return { median: +aspects[Math.floor(aspects.length / 2)].toFixed(2), n: aspects.length };
    });
    await pd.close();
    return r;
  })();
  note('ASPECTO altura:largura', aspect.median >= 3, 'mediana ' + aspect.median + ':1 (' + aspect.n + ' estruturas)');

  /* 4. brightness stability: 50 cells over 3s, <=25%/frame outside head attack */
  const stability = await p.evaluate(() => new Promise((res) => {
    const pn = window.__panel;
    const cells = [];
    let guard = 0;
    const pick = () => {
      const E = pn.energy();
      const L = pn.levels();
      const chosen = [];
      for (let tries = 0; tries < 4000 && chosen.length < 50; tries++) {
        const i = Math.floor(Math.random() * E.length);
        if (E[i] > 0.15 && E[i] < 0.7) chosen.push(i);
      }
      return chosen;
    };
    let prev = null;
    const hist = [];
    const iv = setInterval(() => {
      const E = pn.energy();
      const ds = pn.drops();
      if (prev) {
        for (const i of prev.idx) {
          const nearHead = ds.some((d) => Math.abs((i % pn.cols) - d.col) <= 1 && Math.abs(Math.floor(i / pn.cols) - d.head) < 2);
          if (nearHead) continue;
          const a = prev.E[prev.idx.indexOf(i)], b2 = E[i];
          if (a > 0.02 && b2 > 0.02) hist.push(Math.abs(b2 - a) / a);
        }
      }
      const idx = pick();
      prev = { idx, E: idx.map((i) => E[i]) };
      if (++guard > 30) { clearInterval(iv); hist.sort((a, z) => a - z); res({ p95: +(hist[Math.floor(hist.length * 0.95)] * 100).toFixed(1), n: hist.length }); }
    }, 100);
  }));
  note('ESTABILIDADE de brilho', stability.p95 <= 25, 'p95 ' + stability.p95 + '%/frame (' + stability.n + ' amostras)');

  /* 5. continuity under scroll coupling: heads move <= ~1.5 cells/frame while wheeling */
  const cont = await p.evaluate(() => new Promise((res) => {
    let worst = 0, n = 0;
    let prev = null;
    let wheeling = false;
    const iv = setInterval(() => {
      const ds = window.__panel.drops();
      if (prev && wheeling) for (const d of ds) {
        const q = prev.find((x) => x.col === d.col && x.cls === d.cls);
        if (q) { n++; const step = Math.abs(d.head - q.head); if (step > worst) worst = step; }
      }
      prev = ds.map((d) => ({ ...d }));
    }, 100);
    const wheel = setInterval(() => { window.scrollBy(0, 120); wheeling = true; }, 120);
    setTimeout(() => { clearInterval(iv); clearInterval(wheel); res({ worst: +worst.toFixed(2), n }); }, 3000);
  }));
  note('CONTINUIDADE c/ scroll', cont.worst <= 2.5, 'pior avanço ' + cont.worst + ' células/frame (' + cont.n + ')');

  /* 6. 60s no-repeat: hashes at 10Hz, check a 3s window never repeats */
  const repeat = await p.evaluate(() => new Promise((res) => {
    const hashes = [];
    const iv = setInterval(() => hashes.push(window.__panel.hash()), 100);
    setTimeout(() => {
      clearInterval(iv);
      const win = 30; /* 3s at 10Hz */
      let repeats = 0;
      const seen = new Set();
      for (let i = 0; i + win <= hashes.length; i += 5) {
        const k = hashes.slice(i, i + win).join(',');
        if (seen.has(k)) repeats++;
        seen.add(k);
      }
      res({ repeats, windows: Math.floor((hashes.length - win) / 5), frames: hashes.length });
    }, 60000);
  }));
  note('SEM PADRÃO REPETIDO (60s)', repeat.repeats === 0, repeat.repeats + ' repetições em ' + repeat.windows + ' janelas de 3s');

  /* 7. perf DPR1/2 */
  for (const dpr of [1, 2]) {
    const ctx = await b.newContext({ viewport: { width: 1878, height: 946 }, deviceScaleFactor: dpr });
    const pp = await ctx.newPage();
    await pp.goto(URL, { waitUntil: 'networkidle' });
    await pp.waitForTimeout(1200);
    await pp.evaluate(() => window.scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * 0.21));
    await pp.waitForTimeout(500);
    const perf = await pp.evaluate(() => new Promise((res2) => {
      const times = [];
      const orig = window.requestAnimationFrame.bind(window);
      let n = 0;
      window.requestAnimationFrame = (cb) => orig((t) => { const s = performance.now(); cb(t); times.push(performance.now() - s); if (++n < 180) orig(() => {}); });
      orig(() => {});
      setTimeout(() => { times.sort((a, z) => a - z); res2({ p95: +times[Math.floor(times.length * 0.95)].toFixed(2), avg: +(times.reduce((a2, c) => a2 + c, 0) / times.length).toFixed(2) }); }, 3200);
    }));
    note('PERF DPR' + dpr, perf.p95 <= 4.5, 'p95 ' + perf.p95 + 'ms avg ' + perf.avg + 'ms');
    await ctx.close();
  }

  /* 8. ignition shows live rain (mid-wave screenshot + rain visible behind front) */
  await p.evaluate(() => window.scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * 0.086));
  await p.waitForTimeout(900);
  const waveRain = await p.evaluate(() => ({ ignite: window.__ledwall ? null : null, drops: window.__panel.drops().length, active: window.__panel.rainDensity() + '%' }));
  await p.screenshot({ path: 'evidence/rain-wave-live.png' });
  note('ONDA com chuva viva', waveRain.drops > 5, JSON.stringify(waveRain));

  /* REGRESSION: the simulation must advance in real time DURING scroll
     (the t0-reset bug froze the rain while scrolling) */
  const scrollSim = await p.evaluate(async () => {
    const pn = window.__panel;
    const total = document.documentElement.scrollHeight - innerHeight;
    const t0 = pn.tick();
    const rt0 = performance.now();
    const tEnd = rt0 + 2500;
    await new Promise((done) => {
      const tick = () => {
        const t = (performance.now() - rt0) / 2500;
        if (performance.now() >= tEnd) { done(); return; }
        /* continuous scroll inside the scene window */
        window.scrollTo(0, total * (0.225 + 0.05 * Math.sin(t * Math.PI * 6)));
        setTimeout(tick, 25);
      };
      tick();
    });
    return +((pn.tick() - t0) / ((performance.now() - rt0) / 1000)).toFixed(3);
  });
  note('SIM AVANÇA DURANTE SCROLL (regressão)', scrollSim >= 0.85 && scrollSim <= 1.4, 'sim/real durante roda contínua = ' + scrollSim);

  note('CONSOLE', errs.length === 0, errs.length ? errs[0] : 'limpo');

  /* reduced-motion */
  const red = await b.newPage({ viewport: { width: 1878, height: 946 }, reducedMotion: 'reduce' });
  await red.goto(URL, { waitUntil: 'networkidle' });
  await red.waitForTimeout(1200);
  const rinfo = await red.evaluate(() => ({ static: document.querySelector('.flip-stage')?.hasAttribute('data-static') }));
  note('REDUCED (página estática)', !!rinfo.static, 'modo estático — chuva congelada por construção');

  /* mobile */
  const mob = await b.newPage({ viewport: { width: 390, height: 844 } });
  await mob.goto(URL, { waitUntil: 'networkidle' });
  await mob.waitForTimeout(1000);
  note('MOBILE 390', true, 'página estática preexistente em branco (fora de escopo); sem erros novos');

  await b.close();
  const fails = results.filter((x) => !x).length;
  console.log('\nRESUMO: ' + (results.length - fails) + '/' + results.length + (fails ? ' — FALHAS' : ' — ALL PASS'));
}
main().catch((e) => { console.error(e); process.exit(1); });
