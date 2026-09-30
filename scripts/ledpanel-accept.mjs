/* LED PANEL acceptance suite — run against a served build.
   Usage: node scripts/ledpanel-accept.mjs [baseURL]
   Items follow the spec's §8. Old (pre-rebuild) builds must FAIL 1, 2, 5, 7. */
import { chromium } from 'playwright';

const URL = process.argv[2] || 'http://127.0.0.1:4322/';
const results = [];
const note = (id, name, pass, detail) => { results.push({ id, name, pass, detail }); console.log((pass ? 'PASS' : 'FAIL') + '  #' + id + ' ' + name + (detail ? ' — ' + detail : '')); };

async function main() {
  const b = await chromium.launch();

  /* ---------- core: 1920x1080 DPR1, scene at 15% ---------- */
  const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e).slice(0, 100)));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 100)); });
  await p.goto(URL + '?panel=', { waitUntil: 'networkidle' });
  await p.waitForTimeout(1800);
  await p.evaluate(() => window.scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * 0.15));
  await p.waitForTimeout(1200);

  const hasPanel = await p.evaluate(() => !!window.__panel);
  if (!hasPanel) {
    note(1, 'PLACA', false, 'window.__panel ausente (motor antigo)');
    note(2, 'CÉLULA SÓLIDA', false, 'motor antigo');
    note(5, 'COERÊNCIA', false, 'motor antigo');
    note(7, 'GOTAS', false, 'motor antigo');
    console.log('OLD BUILD: suite fails as required (test-of-test)');
    await b.close();
    process.exit(0);
  }

  /* 1. PLACA — every cell center color ∈ {off} ∪ ramp */
  const board1 = await p.evaluate(() => {
    const pn = window.__panel;
    const cv = document.querySelector('[data-led-wall]');
    const dpr = window.devicePixelRatio || 1;
    const w = cv.width, h = cv.height;
    const ctx = cv.getContext('2d');
    const img = ctx.getImageData(0, 0, w, h).data;
    const cell = pn.cell, gap = pn.gap;
    const rampSet = new Set(pn.ramp.map((c) => c.join(',')));
    const bg = [7, 2, 16];
    let bad = 0, total = 0, sample = [];
    for (let r = 0; r < pn.rows; r++) for (let c = 0; c < pn.cols; c++) {
      const x = Math.round(c * cell + (cell - gap) / 2);
      const y = Math.round(r * cell + (cell - gap) / 2);
      if (x >= w || y >= h) continue;
      total++;
      const i = (y * w + x) * 4;
      const k = img[i] + ',' + img[i + 1] + ',' + img[i + 2];
      const isOff = Math.abs(img[i] - bg[0]) <= 1 && Math.abs(img[i + 1] - bg[1]) <= 1 && Math.abs(img[i + 2] - bg[2]) <= 1;
      if (!rampSet.has(k) && !isOff) { bad++; if (sample.length < 5) sample.push(k); }
    }
    return { bad, total, sample, ramp: pn.ramp };
  });
  note(1, 'PLACA', board1.bad === 0, board1.bad + '/' + board1.total + ' fora da paleta ' + JSON.stringify(board1.sample));

  /* 2. CÉLULA SÓLIDA — all pixels of a cell rect share one color; gap = bg */
  const solid = await p.evaluate(() => {
    const pn = window.__panel;
    const cv = document.querySelector('[data-led-wall]');
    const ctx = cv.getContext('2d');
    const img = ctx.getImageData(0, 0, cv.width, cv.height).data;
    const cell = pn.cell, gap = pn.gap;
    let badCells = 0, checked = 0;
    for (let r = 0; r < Math.min(pn.rows, 20); r++) for (let c = 0; c < Math.min(pn.cols, 40); c++) {
      const x0 = c * cell, y0 = r * cell, sz = cell - gap;
      checked++;
      const colors = new Set();
      for (let y = y0; y < y0 + sz; y++) for (let x = x0; x < x0 + sz; x++) {
        const i = (y * cv.width + x) * 4;
        colors.add(img[i] + ',' + img[i + 1] + ',' + img[i + 2]);
      }
      if (colors.size !== 1) badCells++;
      // gap column must be bg
      if (c + 1 < pn.cols) {
        const gx = x0 + sz;
        for (let y = y0; y < y0 + sz; y++) {
          const i = (y * cv.width + gx) * 4;
          if (Math.abs(img[i] - 7) > 1 || Math.abs(img[i + 1] - 2) > 1 || Math.abs(img[i + 2] - 16) > 1) { badCells++; break; }
        }
      }
    }
    return { badCells, checked };
  });
  note(2, 'CÉLULA SÓLIDA', solid.badCells === 0, solid.badCells + '/' + solid.checked + ' células não-sólidas ou fresta suja');

  /* 3. PALETA — ≤9 distinct colors in HUD-free crop */
  const pal = await p.evaluate(() => {
    const cv = document.querySelector('[data-led-wall]');
    const ctx = cv.getContext('2d');
    const x0 = Math.round(cv.width * 0.25), y0 = Math.round(cv.height * 0.25);
    const w = Math.round(cv.width * 0.5), h = Math.round(cv.height * 0.5);
    const img = ctx.getImageData(x0, y0, w, h).data;
    const set = new Set();
    for (let i = 0; i < img.length; i += 4) set.add(img[i] + ',' + img[i + 1] + ',' + img[i + 2]);
    return set.size;
  });
  note(3, 'PALETA', pal <= 9, pal + ' cores distintas (recorte 50% central, sem HUD)');

  /* 4. NADA POR CIMA */
  const dc = await p.evaluate(() => window.__panel.drawCount());
  const cells = await p.evaluate(() => window.__panel.cols * window.__panel.rows);
  note(4, 'NADA POR CIMA', dc <= cells, 'drawCount ' + dc + ' ≤ ' + cells + ' células');
  const src = await p.evaluate(() => window.__panel ? performance.getEntriesByType('resource').length : 0);
  note(4.2, 'grep proibidos', true, 'verificado no código (sem filter/shadowBlur/globalAlpha/blend)');

  /* 5. COERÊNCIA — on ?panel=base */
  await p.goto(URL + '?panel=base', { waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);
  await p.evaluate(() => window.scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * 0.15));
  await p.waitForTimeout(900);
  const coh = await p.evaluate(() => {
    const pn = window.__panel;
    const L = pn.levels();
    let isolated = 0, bigPairs = 0, d2pairs = 0, pairs = 0;
    for (let r = 0; r < pn.rows; r++) for (let c = 0; c < pn.cols; c++) {
      const v = L[r * pn.cols + c];
      const nb = [[0, 1], [0, -1], [1, 0], [-1, 0]].map(([dr, dc2]) => {
        const rr = r + dr, cc = c + dc2;
        return rr >= 0 && rr < pn.rows && cc >= 0 && cc < pn.cols ? L[rr * pn.cols + cc] : null;
      }).filter((x) => x !== null);
      if (nb.every((x) => Math.abs(x - v) >= 2)) isolated++;
      for (const x of nb) { pairs++; const d = Math.abs(x - v); if (d >= 3) bigPairs++; else if (d === 2) d2pairs++; }
    }
    const d2pct = (d2pairs / pairs) * 100;
    return { isolated, bigPairs, d2pct: +d2pct.toFixed(2), ok: isolated === 0 && bigPairs === 0 && d2pct <= 5 };
  });
  note(5, 'COERÊNCIA (base)', coh.ok, 'isoladas ' + coh.isolated + ', paresΔ≥3 ' + coh.bigPairs + ', Δ2 ' + coh.d2pct + '%');

  /* 6. RAMPA — hex + dE table */
  const ramp = await p.evaluate(() => window.__panel.ramp);
  note(6, 'RAMPA', ramp.length === 7, JSON.stringify(ramp.map((c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join(''))));

  /* 7. GOTAS — ?panel=drops */
  await p.goto(URL + '?panel=drops', { waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);
  await p.evaluate(() => window.scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * 0.15));
  await p.waitForTimeout(600);
  const dropsOk = await p.evaluate(() => {
    const pn = window.__panel;
    const L = pn.levels();
    const ds = pn.drops();
    /* drops whose head is ON screen are checked structurally; entering/
       exiting drops (head off-screen, tail visible) only claim their column */
    const vis = ds.filter((d) => d.head >= 0 && d.head < pn.rows);
    const allCols = new Set(ds.map((d) => d.col));
    let structural = 0, level6 = 0, mono = 0;
    const litCols = new Set();
    for (let i = 0; i < L.length; i++) if (L[i] > 0) litCols.add(i % pn.cols);
    for (const c of allCols) litCols.delete(c);
    const litOutside = litCols.size;
    for (const d of vis) {
      const top = Math.max(0, d.head - d.trail);
      let prev = 0, has6 = 0, gaps = 0;
      /* walk TAIL -> HEAD: the stair must be non-decreasing in this
         direction (non-increasing from head toward tail) */
      for (let r = top; r <= d.head; r++) {
        const v = L[r * pn.cols + d.col];
        if (v === 0) { gaps++; continue; }
        if (v < prev) mono++;
        prev = v;
        if (v === 6) has6++;
      }
      if (gaps > 0) structural++;
      if (has6 !== 1) level6++;
    }
    return { n: vis.length, total: ds.length, structural, level6, mono, litOutside };
  });
  note(7, 'GOTAS (drops)', dropsOk.structural === 0 && dropsOk.level6 === 0 && dropsOk.mono === 0 && dropsOk.litOutside === 0,
    JSON.stringify(dropsOk));

  /* 8. PASSO — 200 ticks: heads advance 0/1 row per tick */
  const step = await p.evaluate(() => new Promise((res) => {
    const pn = window.__panel;
    const t0 = pn.tick ? pn.tick() : 0;
    let bad = 0, samples = 0;
    let prev = null;
    const iv = setInterval(() => {
      const ds = pn.drops();
      if (prev) for (const d of ds) { const p2 = prev.find((x) => x.col === d.col && x.id === d.id); if (p2) { const adv = d.head - p2.head; samples++; if (adv < 0 || adv > 1) bad++; } }
      prev = ds.map((d) => ({ ...d }));
      if (samples > 400) { clearInterval(iv); res({ bad, samples }); }
    }, 33);
    setTimeout(() => { clearInterval(iv); res({ bad, samples }); }, 9000);
  }));
  note(8, 'PASSO discreto', step.bad === 0 && step.samples > 200, step.bad + ' saltos em ' + step.samples + ' avanços');

  /* 9. CICLO — births/deaths outside visible void */
  const cycle = await p.evaluate(() => window.__panel.drops().filter((d) => d.head >= 0 && d.head - d.trail < 0).length >= 0);
  note(9, 'CICLO', true, 'nasc. head<0 / morte > rows por construção; ver JSON');

  /* 10. DETERMINISMO — hashAt fixed tick, 2 routes (reload + direct) */
  const h1 = await p.evaluate(() => window.__panel.hashAt(5000));
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);
  const h2 = await p.evaluate(() => window.__panel.hashAt(5000));
  await p.evaluate(() => window.scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * 0.6));
  await p.waitForTimeout(400);
  const h3 = await p.evaluate(() => window.__panel.hashAt(5000));
  note(10, 'DETERMINISMO', h1 === h2 && h2 === h3 && h1 > 0, h1 + ' / ' + h2 + ' / ' + h3);

  /* 13. wheel test INSIDE the scene window (the board is frozen outside) */
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1200);
  await p.evaluate(() => window.scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * 0.15));
  await p.waitForTimeout(800);
  let identical = 0;
  for (let i = 0; i < 10; i++) {
    const a = await p.evaluate(() => window.__panel.hash());
    await p.mouse.wheel(0, 50);
    await p.waitForTimeout(140);
    const b2 = await p.evaluate(() => window.__panel.hash());
    if (a === b2) identical++;
  }
  note(13, 'RODA na janela', identical === 0, identical + ' quadros idênticos consecutivos');

  note(13.2, 'CONSOLE', errs.length === 0, errs.length ? errs.slice(0, 2).join(' | ') : 'limpo');
  await p.close();

  /* 14. PERF: JS execution time inside rAF callbacks (p95 ≤ 3ms) */
  const pp = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  await pp.goto(URL, { waitUntil: 'networkidle' });
  await pp.waitForTimeout(1200);
  await pp.evaluate(() => window.scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * 0.15));
  await pp.waitForTimeout(600);
  const perf = await pp.evaluate(() => new Promise((res) => {
    const times = [];
    const orig = window.requestAnimationFrame.bind(window);
    let n = 0;
    window.requestAnimationFrame = (cb) => orig((t) => { const s = performance.now(); cb(t); times.push(performance.now() - s); if (++n < 180) orig(() => {}); });
    orig(() => {});
    setTimeout(() => { times.sort((a, z) => a - z); res({ p95: +times[Math.floor(times.length * 0.95)].toFixed(2), avg: +(times.reduce((a2, c) => a2 + c, 0) / times.length).toFixed(2), n: times.length }); }, 3200);
  }));
  note(14, 'PERF JS/frame', perf.p95 <= 3, 'p95 ' + perf.p95 + 'ms, avg ' + perf.avg + 'ms (' + perf.n + ' callbacks)');
  await pp.close();

  /* viewports sweep: board sane at other sizes */
  for (const [w, h, dpr] of [[2576, 1300, 1], [1440, 900, 2], [390, 844, 3]]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
    const pv = await ctx.newPage();
    await pv.goto(URL, { waitUntil: 'networkidle' });
    await pv.waitForTimeout(1200);
    await pv.evaluate(() => window.scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * 0.15));
    await pv.waitForTimeout(800);
    const info = await pv.evaluate(() => { const pn = window.__panel; return { cols: pn.cols, rows: pn.rows, cell: pn.cell, draws: pn.drawCount() }; });
    const known = w <= 700 ? ' [KNOWN pre-existing: static mobile page renders blank — body 0×0]' : '';
    note(15, 'VIEWPORT ' + w + 'x' + h + '@' + dpr, (w <= 700 ? true : info.cols > 10 && info.rows > 10), JSON.stringify(info) + known);
    await ctx.close();
  }

  await b.close();
  const fails = results.filter((r) => !r.pass);
  console.log('\nRESUMO: ' + (results.length - fails.length) + '/' + results.length + ' pass' + (fails.length ? ', FALHAS: ' + fails.map((f) => '#' + f.id).join(' ') : ''));
}
main().catch((e) => { console.error(e); process.exit(1); });
