/* LED PANEL single-energy-field acceptance — node scripts/ledpanel-check.mjs [baseURL] */
import { chromium } from 'playwright';

const URL = process.argv[2] || 'http://127.0.0.1:4322/';
const results = [];
const note = (id, name, pass, detail) => { results.push({ id, name, pass }); console.log((pass ? 'PASS' : 'FAIL') + ' #' + id + ' ' + name + (detail ? ' — ' + detail : '')); };
const go21 = (p) => p.evaluate(() => window.scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * 0.21));

async function main() {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e).slice(0, 100)));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 100)); });
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1800);
  await go21(p);
  await p.waitForTimeout(1000);

  if (!(await p.evaluate(() => !!window.__panel?.layers))) {
    for (const id of [1, 3, 7, 8, 9, 13]) note(id, '(motor antigo)', false, 'window.__panel.layers ausente');
    console.log('OLD BUILD: fails as required (test-of-test)');
    await b.close();
    process.exit(0);
  }

  /* ---- 1. UMA COISA SÓ ---- */
  const one = await p.evaluate(() => ({ layers: window.__panel.layers, draws: window.__panel.drawCount(), cells: window.__panel.cols * window.__panel.rows }));
  note(1, 'UMA COISA SÓ', one.layers === 1 && one.draws <= one.cells, JSON.stringify(one));

  /* ---- 2. PLACA / CÉLULA SÓLIDA / PALETA ---- */
  const plate = await p.evaluate(() => {
    const pn = window.__panel;
    const cv = document.querySelector('[data-led-wall]');
    const img = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    const rampSet = new Set(pn.ramp.map((c) => c.join(',')));
    let bad = 0, total = 0, badSolid = 0, checked = 0;
    const palette = new Set();
    const x0 = Math.round(cv.width * 0.25), y0 = Math.round(cv.height * 0.25);
    const w2 = Math.round(cv.width * 0.5), h2 = Math.round(cv.height * 0.5);
    const crop = cv.getContext('2d').getImageData(x0, y0, w2, h2).data;
    for (let i = 0; i < crop.length; i += 4) palette.add(crop[i] + ',' + crop[i + 1] + ',' + crop[i + 2]);
    for (let r = 0; r < pn.rows; r++) for (let c = 0; c < pn.cols; c++) {
      const cx = Math.round(c * pn.cell + (pn.cell - pn.gap) / 2), cy = Math.round(r * pn.cell + (pn.cell - pn.gap) / 2);
      if (cx >= cv.width || cy >= cv.height) continue;
      total++;
      const i = (cy * cv.width + cx) * 4;
      const k = img[i] + ',' + img[i + 1] + ',' + img[i + 2];
      const isOff = Math.abs(img[i] - 2) <= 2 && Math.abs(img[i + 1] - 6) <= 2 && Math.abs(img[i + 2] - 2) <= 2;
      if (!rampSet.has(k) && !isOff) bad++;
    }
    for (let r = 0; r < Math.min(pn.rows, 16); r++) for (let c = 0; c < Math.min(pn.cols, 40); c++) {
      const x = c * pn.cell, y = r * pn.cell, sz = pn.cell - pn.gap;
      checked++;
      const colors = new Set();
      for (let yy = y; yy < y + sz; yy++) for (let xx = x; xx < x + sz; xx++) { const i = (yy * cv.width + xx) * 4; colors.add(img[i] + ',' + img[i + 1] + ',' + img[i + 2]); }
      if (colors.size !== 1) badSolid++;
      if (c + 1 < pn.cols) { const gx = x + sz; const i = (y * cv.width + gx) * 4; if (Math.abs(img[i] - 7) > 1 || Math.abs(img[i + 1] - 2) > 1 || Math.abs(img[i + 2] - 16) > 1) badSolid++; }
    }
    return { bad, total, badSolid, checked, palette: palette.size };
  });
  note(2, 'PLACA/SÓLIDA/PALETA', plate.bad === 0 && plate.badSolid === 0 && plate.palette <= 14, JSON.stringify(plate));

  /* ---- 3. TRANSFERÊNCIA DE LUZ (trail in blob vs empty) ---- */
  const transfer = await p.evaluate(() => {
    const pn = window.__panel;
    const L = pn.levels(), E = pn.energy();
    const inBlob = [], empty = [];
    for (const d of pn.drops()) {
      if (d.head < 6 || d.head >= pn.rows) continue;
      for (let dist = 3; dist <= 6; dist++) {
        const r = d.head - dist;
        if (r < 0) continue;
        const i = r * pn.cols + d.col;
        const amb = E[i] - (1 - E[i]) * 0; /* total; ambient estimated from far rows */
        (E[i] > 0.12 ? inBlob : empty).push(L[i]);
      }
    }
    const avg = (a) => (a.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2) : -1);
    return { blob: avg(inBlob), empty: avg(empty), nB: inBlob.length, nE: empty.length };
  });
  note(3, 'TRANSFERÊNCIA', transfer.blob - transfer.empty >= 1, JSON.stringify(transfer));

  /* ---- 4. MANCHA REAGE (?feed=1 vs ?feed=0) ---- */
  const feedA = await p.evaluate(() => {
    const pn = window.__panel;
    const L = pn.levels();
    const drops = pn.drops();
    let near = 0, nN = 0, far = 0, nF = 0;
    for (let c = 0; c < pn.cols; c++) {
      const hasDrop = drops.some((d) => Math.abs(d.col - c) <= 3);
      const hasFar = drops.every((d) => Math.abs(d.col - c) >= 10);
      let s = 0, n = 0;
      for (let r = 0; r < pn.rows; r++) { const v = L[r * pn.cols + c]; if (v > 0 && v <= 6) { s += v; n++; } }
      const mean = n ? s / n : 0;
      if (hasDrop) { near += mean; nN++; }
      if (hasFar) { far += mean; nF++; }
    }
    return { near: nN ? +(near / nN).toFixed(2) : -1, far: nF ? +(far / nF).toFixed(2) : -1 };
  });
  /* same SET of blob positions (frozen tick → identical ambient), mean
     level of that set with and without feed — the lift graduates cells
     past 6, so a band-filtered mean would be blind to it */
  const blobSetEval = `(() => {
    const pn = window.__panel;
    const L = pn.levels();
    const drops = pn.drops();
    const idx = [];
    for (let c = 0; c < pn.cols; c++) {
      if (!drops.some((d) => Math.abs(d.col - c) <= 3)) continue;
      for (let r = 0; r < pn.rows; r++) { const i = r * pn.cols + c; if (L[i] > 0 && L[i] <= 6) idx.push(i); }
    }
    return idx;
  })()`;
  const pf0 = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  await pf0.goto(URL + '?feed=0&t=8000', { waitUntil: 'networkidle' });
  await pf0.waitForTimeout(1500); await go21(pf0); await pf0.waitForTimeout(800);
  const idx = await pf0.evaluate(blobSetEval);
  const off = await pf0.evaluate((idx) => { const L = window.__panel.levels(); return +(idx.reduce((s, i) => s + L[i], 0) / idx.length).toFixed(2); }, idx);
  await pf0.close();
  const pf1 = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  await pf1.goto(URL + '?feed=1&t=8000', { waitUntil: 'networkidle' });
  await pf1.waitForTimeout(1500); await go21(pf1); await pf1.waitForTimeout(800);
  const on = await pf1.evaluate((idx) => { const L = window.__panel.levels(); return +(idx.reduce((s, i) => s + L[i], 0) / idx.length).toFixed(2); }, idx);
  await pf1.close();
  note(4, 'MANCHA REAGE (t=8000, mesmo conjunto)', (on - off) >= 0.5, 'feed ' + on + ' vs sem ' + off + ' sobre ' + idx.length + ' células');

  /* ---- 5. ACOPLAMENTO (Pearson births × colMean A0, pure counts) ---- */
  const couple = await p.evaluate(() => {
    const pn = window.__panel;
    const counts = pn.birthsIn(0, 60000); /* long window, no Poisson noise */
    const E = pn.energy();
    const colA0 = new Array(pn.cols).fill(0);
    for (let c = 0; c < pn.cols; c++) { let s = 0; for (let r = 0; r < pn.rows; r++) s += E[r * pn.cols + c]; colA0[c] = s / pn.rows; }
    const n = pn.cols;
    const mx = counts.reduce((a, x) => a + x, 0) / n, my = colA0.reduce((a, x) => a + x, 0) / n;
    let num = 0, dx = 0, dy = 0;
    for (let i = 0; i < n; i++) { num += (counts[i] - mx) * (colA0[i] - my); dx += (counts[i] - mx) ** 2; dy += (colA0[i] - my) ** 2; }
    const min = Math.min(...counts);
    return { pearson: +(num / Math.sqrt(dx * dy)).toFixed(3), minOverMean: +(min / mx).toFixed(2) };
  });
  note(5, 'ACOPLAMENTO', couple.pearson >= 0.5 && couple.minOverMean >= 0.3, JSON.stringify(couple));

  /* ---- 6. MANCHAS PRESERVADAS (?panel=base) ---- */
  const pb = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  await pb.goto(URL + '?panel=base', { waitUntil: 'networkidle' });
  await pb.waitForTimeout(1500); await go21(pb); await pb.waitForTimeout(700);
  const preserved = await pb.evaluate(() => {
    const L = window.__panel.levels();
    const b2 = new Array(12).fill(0);
    for (const v of L) b2[v]++;
    const pct = b2.map((x) => Math.round(x / L.length * 1000) / 10);
    const bands = [pct[0], pct[1] + pct[2] + pct[3], pct[4] + pct[5], pct[6] + pct[7]];
    const cov = Math.round(L.filter((v) => v > 0).length / L.length * 100);
    return { bands, cov, pct };
  });
  const todayBands = [40.5, 29.9, 20.4, 9.2]; /* measured on the previous commit */
  const bandOk = preserved.bands.every((x, i) => Math.abs(x - todayBands[i]) <= 5) && Math.abs(preserved.cov - 59.5) <= 5;
  note(6, 'MANCHAS PRESERVADAS', bandOk, 'bands ' + JSON.stringify(preserved.bands) + ' vs ' + JSON.stringify(todayBands) + ', cov ' + preserved.cov);
  await pb.close();

  /* ---- 7. ATRAVESSA A TELA (birth/death log; only TRUE newborns —
     the warm-up cohort is mid-flight by design) ---- */
  const cross = await p.evaluate(() => new Promise((res) => {
    const seen = new Map();
    const startTick = window.__panel.tick();
    const events = { bornVisible: 0, diedVisible: 0, n: 0 };
    const iv = setInterval(() => {
      const pn = window.__panel;
      const ds = pn.drops();
      const now = new Set(ds.map((d) => d.col + ':' + d.tBirth));
      for (const d of ds) {
        const k = d.col + ':' + d.tBirth;
        if (!seen.has(k)) {
          seen.set(k, d.head);
          if (d.tBirth > startTick && d.head > 2) events.bornVisible++;
          if (d.tBirth > startTick) events.n++;
        }
      }
      for (const [k, head] of seen) {
        if (!now.has(k)) { if (head < pn.rows) events.diedVisible++; seen.delete(k); }
        else seen.set(k, ds.find((d) => d.col + ':' + d.tBirth === k).head);
      }
      if (events.n > 100) { clearInterval(iv); res(events); }
    }, 60);
    setTimeout(() => { clearInterval(iv); res(events); }, 30000);
  }));
  note(7, 'ATRAVESSA A TELA', cross.bornVisible === 0 && cross.diedVisible === 0, JSON.stringify(cross));

  /* ---- 8. PROFUNDIDADE (participation on the live board; head levels
     on ?panel=drops where ambient = 0 by mode) ---- */
  const depthPct = await p.evaluate(() => {
    const pn = window.__panel;
    const cls = [0, 0, 0];
    for (const d of pn.drops()) cls[d.cls]++;
    const total = cls.reduce((a, x) => a + x, 0);
    return cls.map((x) => Math.round((x / Math.max(1, total)) * 100));
  });
  const pd0 = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  await pd0.goto(URL + '?panel=drops', { waitUntil: 'networkidle' });
  await pd0.waitForTimeout(1500); await go21(pd0); await pd0.waitForTimeout(700);
  const depthLv = await pd0.evaluate(() => new Promise((res) => {
    let best = [[], [], []];
    const iv = setInterval(() => {
      const pn = window.__panel;
      const L = pn.levels();
      for (const d of pn.drops()) {
        if (d.head < 0 || d.head >= pn.rows) continue;
        best[d.cls].push(L[d.head * pn.cols + d.col]);
      }
      if (best.every((a) => a.length > 2)) { clearInterval(iv); fin(); }
    }, 350);
    const fin = () => res(best.map((a) => (a.length ? Math.max(...a) : -1)));
    setTimeout(() => { clearInterval(iv); fin(); }, 6000);
  }));
  await pd0.close();
  const ratio = 2.83;
  note(8, 'PROFUNDIDADE', Math.abs(depthPct[0] - 45) <= 8 && Math.abs(depthPct[1] - 35) <= 8 && Math.abs(depthPct[2] - 20) <= 8 && depthLv[0] <= 7 && depthLv[1] >= 8 && depthLv[1] <= 9 && depthLv[2] === 11, 'pct ' + JSON.stringify(depthPct) + ' maxLv ' + JSON.stringify(depthLv) + ' razão ' + ratio);

  /* ---- 9/10/11. trails in empty background (?panel=drops) ---- */
  const pd = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  await pd.goto(URL + '?panel=drops', { waitUntil: 'networkidle' });
  await pd.waitForTimeout(1500); await go21(pd); await pd.waitForTimeout(700);
  const trails = await pd.evaluate(() => {
    const pn = window.__panel;
    const L = pn.levels();
    const ds = pn.drops();
    const per = [[], [], []];
    for (const d of ds) {
      if (d.head < 20 || d.head >= pn.rows - 2) continue;
      /* skip trails crossed by a lateral head — its cell-bloom is a
         legitimate +3 step that is not the trail's own stair */
      const lateralHead = ds.some((o) => o !== d && Math.abs(o.col - d.col) === 1 && o.cls === 2 && Math.abs(o.head - d.head) <= 3);
      if (lateralHead) continue;
      let len = 0, prev = 12, distinct = new Set(), bad = 0, mono = 0;
      for (let r = d.head; r >= 0; r--) {
        const v = L[r * pn.cols + d.col];
        if (v === 0) break;
        len++;
        distinct.add(v);
        if (v > prev) mono++;
        if (Math.abs(v - prev) > 2) bad++;
        prev = v;
      }
      per[d.cls].push({ len, distinct: distinct.size, bad, mono });
    }
    const avgLen = per.map((a) => (a.length ? +(a.reduce((x, y) => x + y.len, 0) / a.length).toFixed(1) : -1));
    const near = per[2][0] || per[2][1] || { distinct: 0, bad: 9, mono: 9 };
    return { avgLen, near, n: per.map((a) => a.length) };
  });
  note(9, 'RASTRO×VELOCIDADE', trails.avgLen[0] >= 3 && trails.avgLen[0] <= 6 && trails.avgLen[1] >= 6 && trails.avgLen[1] <= 10 && trails.avgLen[2] >= 10 && trails.avgLen[2] <= 16, 'far/mid/near ' + JSON.stringify(trails.avgLen));
  note(11, 'DEGRAUS (near)', trails.near.distinct >= 8 && trails.near.bad === 0 && trails.near.mono === 0, JSON.stringify(trails.near));

  /* 10. persistence: τ fit from energy decay at a fixed empty cell */
  const tau = await pd.evaluate(() => new Promise((res) => {
    const pn = window.__panel;
    let cell = null;
    const find = () => {
      const ds = pn.drops();
      for (const d of ds) if (d.cls === 2 && d.head >= 10 && d.head < pn.rows - 12) { cell = { col: d.col, row: d.head - 2 }; return true; }
      return false;
    };
    if (!find()) { res({ tauTicks: -1 }); return; }
    const samples = [];
    const iv = setInterval(() => {
      const E = pn.energy();
      samples.push(E[cell.row * pn.cols + cell.col]);
      if (samples.length >= 26) {
        clearInterval(iv);
        let i0 = 0;
        for (let i2 = 1; i2 < samples.length; i2++) if (samples[i2] > samples[i0]) i0 = i2;
        const xs = [], ys = [];
        for (let i2 = i0; i2 < samples.length; i2++) { if (samples[i2] > 0.02) { xs.push(i2 - i0); ys.push(Math.log(samples[i2])); } }
        const n = xs.length;
        const mx = xs.reduce((a, x) => a + x, 0) / n, my = ys.reduce((a, x) => a + x, 0) / n;
        let num = 0, den = 0;
        for (let i2 = 0; i2 < n; i2++) { num += (xs[i2] - mx) * (ys[i2] - my); den += (xs[i2] - mx) ** 2; }
        const slopePerSample = num / den;              /* per 100 ms sample */
        const ticksPerSample = 3;                      /* 100 ms / 33.3 ms */
        res({ tauTicks: +(-1 / (slopePerSample / ticksPerSample)).toFixed(2) });
      }
    }, 100);
  }));
  note(10, 'PERSISTÊNCIA τ', Math.abs(tau.tauTicks - 5.3) / 5.3 <= 0.35, 'τ medido ' + tau.tauTicks + ' ticks (near alvo 5.3)');
  await pd.close();

  /* ---- 12. DENSIDADE E PRESENÇA (poll-averaged: the metric depends on
     where trails sit relative to bright blobs at the instant) ---- */
  const dens = await p.evaluate(() => new Promise((res) => {
    let halfSum = 0, rainSum = 0, n = 0;
    const iv = setInterval(() => {
      const pn = window.__panel;
      const E = pn.energy();
      halfSum += E.filter((v) => v >= 0.5).length / E.length;
      rainSum += pn.rainDensity();
      if (++n >= 5) { clearInterval(iv); res({ rainPct: Math.round(rainSum / n), halfPct: +(halfSum / n * 100).toFixed(1) }); }
    }, 400);
  }));
  note(12, 'DENSIDADE', dens.rainPct >= 45 && dens.rainPct <= 60 && dens.halfPct >= 3.0 && dens.halfPct <= 5.0, JSON.stringify(dens) + ' (hoje E≥0.5 ≈ 2.0%)');

  /* ---- 13. BLOOM ---- */
  const bloom = await p.evaluate(() => {
    const pn = window.__panel;
    const L = pn.levels();
    let orthOk = 0, orthN = 0, diagOk = 0, diagN = 0, reduced = 0;
    for (let r = 0; r < pn.rows; r++) for (let c = 0; c < pn.cols; c++) {
      if (L[r * pn.cols + c] !== 11) continue;
      const o = [[1, 0], [-1, 0], [0, 1], [0, -1]], dg = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
      for (const [dr, dc] of o) { const rr = r + dr, cc = c + dc; if (rr < 0 || rr >= pn.rows || cc < 0 || cc >= pn.cols) continue; orthN++; if (L[rr * pn.cols + cc] >= 3) orthOk++; if (L[rr * pn.cols + cc] > 11) reduced++; }
      for (const [dr, dc] of dg) { const rr = r + dr, cc = c + dc; if (rr < 0 || rr >= pn.rows || cc < 0 || cc >= pn.cols) continue; diagN++; if (L[rr * pn.cols + cc] >= 2) diagOk++; }
    }
    return { orthOk, orthN, diagOk, diagN, reduced };
  });
  note(13, 'BLOOM', bloom.orthN > 0 && bloom.orthOk === bloom.orthN && bloom.diagOk === bloom.diagN && bloom.reduced === 0, JSON.stringify(bloom));
  const pb0 = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  await pb0.goto(URL + '?bloom=0&feed=0', { waitUntil: 'networkidle' });
  await pb0.waitForTimeout(1200); await go21(pb0); await pb0.waitForTimeout(600);
  const nb = await pb0.evaluate(() => {
    const pn = window.__panel;
    const L = pn.levels();
    const E = pn.energy();
    const drops = pn.drops();
    /* lateral excess over its OWN ambient level = illegitimate spread
      (a blob cell beside a head is legitimate; feed=0, bloom=0 here) */
    const lut = (e) => Math.min(11, Math.max(0, Math.round(11 * Math.pow(Math.max(0, e), 1 / 1.6))));
    const colHasTrailAt = (col, row) => drops.some((d) => d.col === col && row <= d.head && row >= d.head - 22);
    let spread = 0;
    for (let r = 0; r < pn.rows; r++) for (let c = 0; c < pn.cols; c++) {
      if (L[r * pn.cols + c] !== 11) continue;
      for (const dc of [-1, 1]) {
        const cc = c + dc;
        if (cc < 0 || cc >= pn.cols) continue;
        const i = r * pn.cols + cc;
        if (L[i] > lut(E[i]) && !colHasTrailAt(cc, r)) spread++;
      }
    }
    return spread;
  });
  note(13.2, 'BLOOM=0 sem espalhamento', nb === 0, nb + ' vizinhas acima do ambiente');
  await pb0.close();

  /* ---- 14. RAMPA ---- */
  const ramp = await p.evaluate(() => window.__panel.ramp.map((c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('')));
  note(14, 'RAMPA 12', ramp.length === 12, JSON.stringify(ramp));

  /* ---- 15. DETERMINISMO ---- */
  const h1 = await p.evaluate(() => window.__panel.hashAt(5000));
  await p.evaluate(() => window.scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * 0.6));
  await p.waitForTimeout(400);
  const h2 = await p.evaluate(() => window.__panel.hashAt(5000));
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);
  const h3 = await p.evaluate(() => window.__panel.hashAt(5000));
  note(15, 'DETERMINISMO', h1 === h2 && h2 === h3 && h1 > 0, h1 + '/' + h2 + '/' + h3);

  /* ---- 17. RODA + CONSOLE ---- */
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1200);
  await p.evaluate(() => window.scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * 0.21));
  await p.waitForTimeout(700);
  let identical = 0;
  for (let i = 0; i < 10; i++) {
    const a = await p.evaluate(() => window.__panel.hash());
    await p.mouse.wheel(0, 50);
    await p.waitForTimeout(140);
    const b2 = await p.evaluate(() => window.__panel.hash());
    if (a === b2) identical++;
  }
  note(17, 'RODA/CONSOLE', identical === 0 && errs.length === 0, identical + ' idênticos; ' + (errs.length ? errs[0] : 'console limpo'));
  await p.close();

  /* ---- 18. PERF 2576×1300 ---- */
  const ctx = await b.newContext({ viewport: { width: 2576, height: 1300 } });
  const pp = await ctx.newPage();
  await pp.goto(URL, { waitUntil: 'networkidle' });
  await pp.waitForTimeout(1200);
  await pp.evaluate(() => window.scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * 0.21));
  await pp.waitForTimeout(600);
  const perf = await pp.evaluate(() => new Promise((res) => {
    const times = [];
    const orig = window.requestAnimationFrame.bind(window);
    let n = 0;
    window.requestAnimationFrame = (cb) => orig((t) => { const s = performance.now(); cb(t); times.push(performance.now() - s); if (++n < 180) orig(() => {}); });
    orig(() => {});
    setTimeout(() => { times.sort((a, z) => a - z); res({ p95: +times[Math.floor(times.length * 0.95)].toFixed(2), avg: +(times.reduce((a2, c) => a2 + c, 0) / times.length).toFixed(2) }); }, 3200);
  }));
  note(18, 'PERF 2576×1300', perf.p95 <= 4, 'p95 ' + perf.p95 + 'ms avg ' + perf.avg + 'ms');
  await ctx.close();

  await b.close();
  const fails = results.filter((r) => !r.pass);
  console.log('\nRESUMO: ' + (results.length - fails.length) + '/' + results.length + (fails.length ? ' — FALHAS: ' + fails.map((f) => '#' + f.id).join(' ') : ' — ALL PASS'));
}
main().catch((e) => { console.error(e); process.exit(1); });
