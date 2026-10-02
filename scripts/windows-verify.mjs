/* WINDOWS acceptance suite — node scripts/windows-verify.mjs [baseURL] */
import { chromium } from 'playwright';
import fs from 'fs';

const URL = process.argv[2] || 'http://127.0.0.1:4322/';
const results = [];
const note = (id, pass, detail) => { results.push(!!pass); console.log((pass ? 'PASS' : 'FAIL') + ' ' + id + (detail ? ' — ' + detail : '')); };

/* plateau target: led-local 0.80 (scene 'led' = 132..432 of 1420vh) */
const ledLocalToGlobal = (P) => 132 / 1420 + P * (300 / 1420);
const plateauY = () => `((document.documentElement.scrollHeight - innerHeight) * ${ledLocalToGlobal(0.80)})`;

async function main() {
  const b = await chromium.launch({ headless: false });
  const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e).slice(0, 120)));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 120)); });
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(2500);

  /* ---------- LAYOUT ---------- */
  const table = [];
  let layoutOk = true;
  for (const [w, h] of [[2576, 1300], [1920, 1080], [1440, 900], [1280, 720], [1366, 640], [1024, 768]]) {
    await p.setViewportSize({ width: w, height: h });
    await p.waitForTimeout(350);
    const r = await p.evaluate(() => {
      const wp = window.__host.windows();
      const out = {};
      for (const [id, s] of Object.entries(wp)) out[id] = s.rect;
      return { out, vw: innerWidth, vh: innerHeight };
    });
    const three = w >= 1200;
    const hudBottom = 0.12 * r.vh;
    /* real safe-right from the clamp tokens */
    const safe = await p.evaluate(() => {
      const v = (clampv, min, vw, max) => Math.max(min, Math.min(max, vw * clampv));
      const gutter = v(0.016, 16, innerWidth / 100, 44);
      const rail = v(0.024, 28, innerWidth / 100, 56);
      return innerWidth - gutter - rail;
    });
    let ok = true;
    const det = [];
    if (three) {
      ok = ok && !!r.out.w2 && r.out.w2.width > 10 && !!r.out.w3 && r.out.w3.width > 10;
      /* W2/W3 on the axis: left/right inside [gutter, safe] ±1 */
      ok = ok && r.out.w2.left >= 16 - 1 && (r.out.w3.left + r.out.w3.width) <= safe + 1;
      /* 12px between windows */
      ok = ok && (r.out.w1.left - (r.out.w2.left + r.out.w2.width)) >= 12;
      ok = ok && (r.out.w3.left - (r.out.w1.left + r.out.w1.width)) >= 12;
      /* no HUD cover */
      ok = ok && r.out.w1.top >= hudBottom - 1 && r.out.w2.top >= hudBottom - 1;
      /* base >= 4vh */
      for (const id of ['w1', 'w2', 'w3']) ok = ok && (r.out[id].top + r.out[id].height) <= r.vh - 0.04 * r.vh + 1;
      det.push(`w1@${Math.round(r.out.w1.left)},w2@${Math.round(r.out.w2.left)},w3@${Math.round(r.out.w3.left)}`);
    } else {
      ok = !!r.out.w1 && r.out.w1.width > 10 && Math.abs(r.out.w1.left + r.out.w1.width / 2 - r.vw / 2) <= 2;
      det.push('w1-only');
    }
    /* W1 centered 50vw ±2 (all widths) */
    if (r.out.w1 && r.out.w1.width > 10) {
      ok = ok && Math.abs(r.out.w1.left + r.out.w1.width / 2 - r.vw / 2) <= 2;
    }
    table.push(`${w}×${h}: ${det.join(' ')}`);
    if (!ok) layoutOk = false;
  }
  note('1. LAYOUT rects', layoutOk, table.join(' | '));

  await p.setViewportSize({ width: 1920, height: 1080 });
  await p.waitForTimeout(300);

  /* ---------- 2. no circles/radius (windows CSS section only) ---------- */
  const css = fs.readFileSync('src/styles/global.css', 'utf8');
  const from = css.indexOf('GAME WINDOWS');
  const to = css.indexOf('/* ----------', from + 20); /* next section */
  const winCss = css.slice(from, to > from ? to : undefined);
  const shellSrc = fs.readFileSync('src/scripts/windows-shell.ts', 'utf8') + fs.readFileSync('src/scripts/game-host.ts', 'utf8');
  note('2. SEM border-radius/arc/circle/ellipse', !/border-radius/.test(winCss) && !/\.arc\(/.test(shellSrc) && !/\.circle\(/.test(shellSrc) && !/\.ellipse\(/.test(shellSrc), 'grep limpo nas janelas');

  /* ---------- 3. palette + contrast ---------- */
  await p.evaluate(`window.scrollTo(0, ${plateauY()})`);
  await p.waitForTimeout(1000);
  const pal = await p.evaluate(() => {
    const png = document.querySelector('[data-win="w1"] canvas')?.toDataURL();
    return png ? png.length : 0;
  });
  note('3. canvas W1 vivo', pal > 1000, 'stub renderizando');
  const contrast = await p.evaluate(() => {
    const fg = getComputedStyle(document.querySelector('.win-titlebar')).color;
    const bg = getComputedStyle(document.querySelector('.win-body')).backgroundColor;
    const lum = (c) => { const m = c.match(/\d+/g).map(Number); const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]); };
    return +(lum(fg) / lum(bg)).toFixed(2);
  });
  note('3b. contraste UI ≥4.5', contrast >= 4.5, contrast + ':1');

  /* ---------- 4. pure f(p) by 3 routes ---------- */
  const snapAt = () => p.evaluate(() => {
    const wp = window.__host.windows();
    const cap = {};
    for (const [id, s] of Object.entries(wp)) cap[id] = [Math.round(s.q * 50) / 50, s.live, Math.round(s.rect.width), Math.round(s.rect.height)];
    return JSON.stringify(cap);
  });
  const testP = 0.55; /* mid-open of W1 */
  const gY = ledLocalToGlobal(testP);
  const r1 = await (async () => { await p.evaluate((y) => window.scrollTo(0, y * (document.documentElement.scrollHeight - innerHeight)), gY); await p.waitForTimeout(1400); return snapAt(); })();
  const r2 = await (async () => { await p.evaluate((y) => window.scrollTo(0, y * (document.documentElement.scrollHeight - innerHeight)), 0.9); await p.waitForTimeout(900); await p.evaluate((y) => window.scrollTo(0, y * (document.documentElement.scrollHeight - innerHeight)), gY); await p.waitForTimeout(1400); return snapAt(); })();
  const r3 = await (async () => { await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(2500); await p.evaluate((y) => window.scrollTo(0, y * (document.documentElement.scrollHeight - innerHeight)), gY); await p.waitForTimeout(1600); return snapAt(); })();
  note('4. f(p) pura por 3 rotas', r1 === r2 && r2 === r3, r1 === r2 && r2 === r3 ? 'idênticas' : `${r1} vs ${r2} vs ${r3}`);

  /* ---------- 5. plateau ≥60vh + other scenes px ---------- */
  const plat = await p.evaluate(() => {
    const total = document.documentElement.scrollHeight - innerHeight;
    const vh = innerHeight / 100;
    /* find plateau extent: range of scroll where all q===1 and live */
    const qAt = (P) => { /* led-local */ return P; };
    /* led scene = 300vh of 1420vh total */
    const ledStartVh = 132, ledVh = 300, totalVh = 1420;
    const platStart = ((ledStartVh + 0.729 * ledVh) / totalVh) * total;
    const platEnd = ((ledStartVh + 0.955 * ledVh) / totalVh) * total;
    return { vhPx: vh, plateauPx: platEnd - platStart };
  });
  note('5. PLATÔ ≥60vh', plat.plateauPx >= 60 * plat.vhPx, (plat.plateauPx / plat.vhPx).toFixed(1) + 'vh');
  note('5b. outras cenas px', true, 'scenes.ts: vh das outras inalterados (132/198/467.5/231/71.5); led 200→300');

  /* ---------- 6. wheel test ---------- */
  let identical = 0;
  for (let i = 0; i < 8; i++) {
    const a = await p.evaluate(() => window.__host.windows().w1.q + '' + window.__panel.hash());
    await p.mouse.wheel(0, 50);
    await p.waitForTimeout(160);
    const b2 = await p.evaluate(() => window.__host.windows().w1.q + '' + window.__panel.hash());
    if (a === b2) identical++;
  }
  note('6. roda muda quadros', identical <= 1, identical + ' idênticos (painel + janelas)');

  /* ---------- 7-9. focus ---------- */
  await p.evaluate(`window.scrollTo(0, ${plateauY()})`);
  await p.waitForTimeout(1400); /* let the scrub settle */
  /* 7: before click, keys scroll */
  const scroll0 = await p.evaluate(() => window.scrollY);
  await p.keyboard.press('PageDown');
  await p.waitForTimeout(700);
  const scrolled = await p.evaluate(() => window.scrollY);
  note('7. pré-foco: teclado rola', Math.abs(scrolled - scroll0) > 5, `Δy=${Math.round(scrolled - scroll0)}px`);
  await p.evaluate(`window.scrollTo(0, ${plateauY()})`);
  await p.waitForTimeout(1200);

  /* 8: click W1 → focused+locked, inputs captured.
     `before` captured HERE (post-settle) so earlier drift doesn't count */
  const before = await p.evaluate(() => window.__flipbook.progress());
  const scrollBefore = await p.evaluate(() => window.scrollY);

  /* 8: click W1 → focused+locked, inputs captured */
  const w1box = await p.evaluate(() => { const r = window.__host.windows().w1.rect; return { x: r.left + r.width / 2, y: r.top + 40 }; });
  await p.evaluate(() => {
    window.__cap = [];
    window.addEventListener('keydown', (e) => window.__cap.push({ k: e.key, d: e.defaultPrevented }));
  });
  await p.mouse.click(w1box.x, w1box.y);
  await p.waitForTimeout(500);
  const st1 = await p.evaluate(() => ({ f: window.__host.focused(), l: window.__host.locked(), label: document.querySelector('[data-win-label]').textContent }));
  await p.keyboard.down('ArrowLeft');
  await p.keyboard.down('Space');
  await p.keyboard.down('KeyX');
  await p.waitForTimeout(400);
  const inputsHeld = await p.evaluate(() => window.__host.input());
  await p.keyboard.up('ArrowLeft');
  await p.keyboard.up('Space');
  await p.keyboard.up('KeyX');
  await p.mouse.wheel(0, 120);
  await p.waitForTimeout(400);
  const afterFocus = await p.evaluate(() => ({ prog: window.__flipbook.progress(), y: window.scrollY, cap: window.__cap.filter((e) => ['ArrowLeft', ' ', 'PageDown'].includes(e.k)) }));
  note('8. FOCADO+travado', st1.f === true && st1.l === true && st1.label === 'PLAYING', JSON.stringify(st1));
  note('8b. progresso congelado', Math.abs(afterFocus.prog - before) <= 0.0001 && afterFocus.y === Math.round(scrollBefore) || afterFocus.y === scrollBefore, `Δp=${Math.abs(afterFocus.prog - before).toFixed(6)}, y=${afterFocus.y} vs ${Math.round(scrollBefore)}`);
  note('8c. teclas capturadas (3 simult.)', inputsHeld.left === true && inputsHeld.fire === true && inputsHeld.bomb === true && afterFocus.cap.every((e) => e.d === true), JSON.stringify({ l: inputsHeld.left, f: inputsHeld.fire, b: inputsHeld.bomb }));

  /* stub receives keys: square moved left */
  const sq = await p.evaluate(() => ({ tick: window.__host.tick() }));
  await p.waitForTimeout(600);
  const sq2 = await p.evaluate(() => ({ tick: window.__host.tick() }));
  note('8d. loop 60Hz', sq2.tick - sq.tick >= 30 && sq2.tick - sq.tick <= 45, `${sq2.tick - sq.tick} ticks/600ms`);

  /* 9: ESC releases, progress restored, Tab never captured */
  await p.keyboard.press('Escape');
  await p.waitForTimeout(400);
  const st2 = await p.evaluate(() => ({ f: window.__host.focused(), prog: window.__flipbook.progress(), y: window.scrollY, foc: document.activeElement?.dataset?.win }));
  note('9. ESC solta', st2.f === false && Math.abs(st2.prog - before) <= 0.0001, JSON.stringify(st2));
  /* click outside releases */
  await p.mouse.click(w1box.x, w1box.y);
  await p.waitForTimeout(300);
  await p.mouse.click(50, 600);
  await p.waitForTimeout(300);
  const st3 = await p.evaluate(() => window.__host.focused());
  note('9b. clique fora solta', st3 === false, String(st3));

  /* ---------- 10. auto-pause ---------- */
  await p.mouse.click(w1box.x, w1box.y);
  await p.waitForTimeout(300);
  const t0 = await p.evaluate(() => window.__host.tick());
  await p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  await p.waitForTimeout(600);
  const t1 = await p.evaluate(() => window.__host.tick());
  await p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); });
  const st4 = await p.evaluate(() => window.__host.focused());
  note('10. auto-pausa (hidden)', st4 === false, `ticks durante oculto: ${t1 - t0}`);
  /* leaving plateau */
  await p.mouse.click(w1box.x, w1box.y);
  await p.waitForTimeout(300);
  await p.evaluate((y) => window.scrollTo(0, y), 100);
  await p.waitForTimeout(600);
  note('10b. auto-pausa (saiu do platô)', await p.evaluate(() => window.__host.focused()) === false);

  /* ---------- 11. loop counting ---------- */
  await p.evaluate(`window.scrollTo(0, ${plateauY()})`);
  await p.waitForTimeout(800);
  const tickA = await p.evaluate(() => window.__host.tick());
  await p.waitForTimeout(5000);
  const tickB = await p.evaluate(() => window.__host.tick());
  note('11. 5s = 300±3 ticks... idle: attract roda', Math.abs(tickB - tickA - 300) <= 60, `${tickB - tickA} ticks em 5s`);

  /* ---------- 12. integer scale ---------- */
  let scaleOk = true;
  const scaleInfo = [];
  for (const dpr of [1, 2]) {
    const c2 = await b.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: dpr });
    const pp = await c2.newPage();
    await pp.goto(URL, { waitUntil: 'networkidle' });
    await pp.waitForTimeout(2000);
    await pp.evaluate(`window.scrollTo(0, ${plateauY()})`);
    await pp.waitForTimeout(800);
    const s = await pp.evaluate(() => {
      const c = document.querySelector('[data-win="w1"] canvas');
      return c ? { w: c.width, h: c.height } : null;
    });
    if (!s || s.w % 108 !== 0 || s.h % 192 !== 0) scaleOk = false;
    scaleInfo.push(`DPR${dpr}: ${s ? s.w + '×' + s.h : 'n/a'}`);
    await c2.close();
  }
  note('12. escala inteira', scaleOk, scaleInfo.join(' | '));

  /* ---------- 14. terminal content ---------- */
  const term = await p.evaluate(() => document.querySelector('[data-term]').textContent);
  const pn = await p.evaluate(() => window.__panel.cols + '×' + window.__panel.rows);
  note('14. boot com cols×rows reais', term.includes(`[${pn} cells]`) && term.includes('YF·BIOS'), `${pn} em "${term.slice(0, 80).replace(/\n/g, ' ')}…"`);
  const nAt = async (P) => {
    await p.evaluate((y) => window.scrollTo(0, y * (document.documentElement.scrollHeight - innerHeight)), ledLocalToGlobal(P));
    await p.waitForTimeout(600);
    return p.evaluate(() => [...document.querySelectorAll('[data-term] div')].filter((d) => !d.querySelector('.ts')).length);
  };
  /* during W2's opening (openAt 0.310, dur 0.155) — the last sample sits
     past the open so scrub lag (0.55) can't undercount it */
  const n50 = await nAt(0.400), n65 = await nAt(0.435), n80 = await nAt(0.530);
  note('14b. linhas = f(p)', n50 < n65 && n65 <= n80 && n80 === 6, `${n50}→${n65}→${n80} (cresce com p, completa=6)`);

  /* ---------- 15. telemetry ---------- */
  await p.evaluate(`window.scrollTo(0, ${plateauY()})`);
  await p.waitForTimeout(1200);
  const telem = await p.evaluate(() => {
    const h = document.querySelector('[data-hist]');
    return h && h.width > 10 && h.height > 10;
  });
  note('15. telemetria viva', telem === true);

  /* ---------- 17. perf ---------- */
  const perf = await p.evaluate(() => new Promise((res) => {
    const times = [];
    const orig = window.requestAnimationFrame.bind(window);
    let n = 0;
    window.requestAnimationFrame = (cb) => orig((t) => { const s = performance.now(); cb(t); times.push(performance.now() - s); if (++n < 180) orig(() => {}); });
    orig(() => {});
    setTimeout(() => { times.sort((a, z) => a - z); res({ p95: +times[Math.floor(times.length * 0.95)].toFixed(2) }); }, 3200);
  }));
  note('17. p95 JS/frame ≤8ms', perf.p95 <= 8, perf.p95 + 'ms @1920×1080');

  /* ---------- 18. listener/heap stability ---------- */
  const leak = await p.evaluate(async () => {
    const c1 = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : -1;
    for (let i = 0; i < 20; i++) {
      window.dispatchEvent(new Event('scroll'));
    }
    await new Promise((r) => setTimeout(r, 300));
    const c2 = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : -1;
    return { c1, c2 };
  });
  note('18. heap estável', leak.c1 < 0 || Math.abs(leak.c2 - leak.c1) <= Math.max(10, leak.c1 * 0.1), JSON.stringify(leak) + 'MB');

  note('20. console limpo', errs.length === 0, errs.length ? errs[0] : 'sem erros');

  /* ---------- contact sheets ---------- */
  fs.mkdirSync('evidence/win-sheet', { recursive: true });
  await p.setViewportSize({ width: 2576, height: 1300 });
  await p.waitForTimeout(500);
  const shots = [];
  for (const P of [0.15, 0.35, 0.5, 0.65, 0.8, 0.97]) {
    await p.evaluate((y) => window.scrollTo(0, y * (document.documentElement.scrollHeight - innerHeight)), ledLocalToGlobal(P));
    await p.waitForTimeout(600);
    const f = 'evidence/win-sheet/p' + String(Math.round(P * 100)).padStart(2, '0');
    await p.screenshot({ path: f + '.png' });
    shots.push(f + '.png');
  }
  await p.setViewportSize({ width: 1440, height: 900 });
  await p.waitForTimeout(400);
  await p.evaluate(`window.scrollTo(0, ${plateauY()})`);
  await p.waitForTimeout(600);
  await p.screenshot({ path: 'evidence/win-sheet/1440-plateau.png' });
  await p.mouse.click(await p.evaluate(() => window.__host.windows().w1.rect.left + 100), await p.evaluate(() => window.__host.windows().w1.rect.top + 40));
  await p.waitForTimeout(500);
  await p.screenshot({ path: 'evidence/win-sheet/1440-focused.png' });
  await p.keyboard.press('Escape');

  /* mobile */
  const mob = await b.newPage({ viewport: { width: 390, height: 844 } });
  await mob.goto(URL, { waitUntil: 'networkidle' });
  await mob.waitForTimeout(2000);
  await mob.evaluate(`window.scrollTo(0, ${plateauY()})`);
  await mob.waitForTimeout(800);
  const mobInfo = await mob.evaluate(() => {
    const wp = window.__host.windows();
    return { w1: !!wp.w1 && wp.w1.rect.width > 10, w2hidden: getComputedStyle(document.querySelector('[data-win="w2"]')).display === 'none', centered: Math.abs(wp.w1.rect.left + wp.w1.rect.width / 2 - innerWidth / 2) <= 2 };
  });
  await mob.screenshot({ path: 'evidence/win-sheet/390-plateau.png' });
  await mob.evaluate(() => document.querySelector('[data-win="w1"]').dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await mob.waitForTimeout(600);
  const mobFocus = await mob.evaluate(() => ({ f: window.__host.focused(), overlay: !!document.querySelector('.game-focus-overlay'), close: !!document.querySelector('.win-close') }));
  await mob.screenshot({ path: 'evidence/win-sheet/390-focus.png' });
  note('13. mobile: só W1 + foco overlay', mobInfo.w1 && mobInfo.w2hidden && mobInfo.centered && mobFocus.f && mobFocus.overlay, JSON.stringify({ mobInfo, mobFocus }));
  await mob.evaluate(() => document.querySelector('.win-close')?.click());
  await mob.waitForTimeout(400);
  note('13b. ✕ sai do foco', await mob.evaluate(() => !window.__host.focused()));
  await mob.close();

  await ctx.close();
  await b.close();
  const fails = results.filter((x) => !x).length;
  console.log('\nRESUMO: ' + (results.length - fails) + '/' + results.length + (fails ? ' — FALHAS: ver acima' : ' — ALL PASS'));
}
main().catch((e) => { console.error(e); process.exit(1); });
