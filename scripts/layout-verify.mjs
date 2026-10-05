/* Layout lint + state screenshots for the Shaft Runner layout round */
import { chromium } from 'playwright';
import fs from 'fs';

const URL = process.argv[2] || 'http://127.0.0.1:4322/';
const results = [];
const note = (id, pass, detail) => { results.push(!!pass); console.log((pass ? 'PASS' : 'FAIL') + ' ' + id + (detail ? ' — ' + detail : '')); };

const VIEWPORTS = [[1878, 946], [1440, 900], [1366, 768], [390, 844]];

const inter = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

async function lintState(p, state) {
  return p.evaluate((state) => {
    const inter = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    const g = window.__game;
    const hb = g.hudBoxes();
    const problems = [];
    const boxes = hb.boxes.filter((b) => b.w > 0 && b.h > 0);
    for (const b of boxes) {
      if (b.x < 0 || b.y < 0 || b.x + b.w > hb.W || b.y + b.h > hb.H) problems.push('fora: ' + b.n + '@' + b.x + ',' + b.y);
    }
    const byBand = { top: [], bot: [] };
    for (const b of boxes) if (byBand[b.band]) byBand[b.band].push(b);
    for (const band of ['top', 'bot']) {
      const arr = byBand[band];
      for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
        if (inter(arr[i], arr[j])) problems.push(band + ' overlap: ' + arr[i].n + ' x ' + arr[j].n);
      }
    }
    if (state === 'play') {
      const hudInField = boxes.filter((b) => b.band === 'field' && /^(score|fuel|hi\.|bomb\.|life\.|stage|combo)/.test(b.n));
      for (const b of hudInField) problems.push('hud no campo: ' + b.n);
    }
    return { problems, boxes, W: hb.W, H: hb.H };
  }, state);
}

async function main() {
  const b = await chromium.launch({ headless: false });
  const ctx = await b.newContext({ viewport: { width: 1878, height: 946 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e).slice(0, 150)));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 150)); });
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(2500);
  await p.evaluate(() => window.scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * (132 / 1420 + 0.8 * 300 / 1420)));
  await p.waitForTimeout(800);
  await p.waitForFunction(() => !!window.__game, null, { timeout: 15000 });

  const lintTable = [];
  let lintOk = true;
  for (const [w, h] of VIEWPORTS) {
    await p.setViewportSize({ width: w, height: h });
    await p.waitForTimeout(500);
    await p.evaluate(() => window.scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * (132 / 1420 + 0.8 * 300 / 1420)));
    await p.waitForTimeout(600);
    const states = w <= 700
      ? [['demo', async () => { await p.evaluate(() => { window.__game.reset(1); window.__game.autopilot(true); }); await p.waitForTimeout(400); }]]
      : [
        ['menu', async () => { const box = await p.evaluate(() => { const r = window.__host.windows().w1.rect; return { x: r.left + r.width / 2, y: r.top + 40 }; }); await p.mouse.click(box.x, box.y); await p.waitForTimeout(400); }],
        ['play', async () => { await p.keyboard.press('Space'); await p.waitForTimeout(800); await p.evaluate(() => window.__game.autopilot(true)); await p.waitForTimeout(1500); }],
        ['pause', async () => { await p.keyboard.press('Escape'); await p.waitForTimeout(350); }],
      ];
    for (const [name, setup] of states) {
      await setup();
      await p.waitForTimeout(300);
      const chip = await p.evaluate(() => document.querySelector('[data-win-label]').textContent);
      const lint = await lintState(p, name);
      const ok = lint.problems.length === 0;
      lintTable.push(`${w}x${h}/${name}: ${ok ? 'ok' : lint.problems.slice(0, 3).join('; ')} (chip=${chip}, boxes=${lint.boxes.length})`);
      if (!ok) lintOk = false;
      fs.mkdirSync(`evidence/layout-sheet/${w}`, { recursive: true });
      const clip = await p.evaluate(() => {
        const r = window.__host.windows().w1.rect;
        return { x: Math.max(0, r.left - 8), y: Math.max(0, r.top - 8), width: Math.min(innerWidth - r.left, r.width + 16), height: Math.min(innerHeight - r.top, r.height + 16) };
      });
      await p.screenshot({ path: `evidence/layout-sheet/${w}/${name}.png`, clip });
      await p.evaluate(() => window.__game.start(4242));
      await p.evaluate(() => window.__game.reset(1));
    }
  }
  note('LAYOUT LINT (estados x viewports)', lintOk, lintTable.join(' | '));

  /* crossing 700px reloads the page (static-mode toggle) — re-wait */
  await p.setViewportSize({ width: 1878, height: 946 });
  await p.waitForTimeout(2500);
  await p.waitForFunction(() => !!window.__game, null, { timeout: 15000 });
  await p.evaluate(() => window.scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * (132 / 1420 + 0.8 * 300 / 1420)));
  await p.waitForTimeout(800);
  const fill = await p.evaluate(() => {
    const r = window.__host.windows().w1.rect;
    const cv = document.querySelector('[data-win="w1"] canvas');
    const body = document.querySelector('[data-win="w1"] .win-body').getBoundingClientRect();
    return {
      canvasCss: Math.round(cv.getBoundingClientRect().width) + 'x' + Math.round(cv.getBoundingClientRect().height),
      dev: cv.width + 'x' + cv.height,
      scale: cv.width / 216,
      bodyW: +((cv.getBoundingClientRect().width) / body.width * 100).toFixed(1),
      fieldPct: +(((340 - 30) / 384) * 100).toFixed(1),
      winH: Math.round(r.height), winHpct: +(r.height / innerHeight * 100).toFixed(1),
    };
  });
  note('CORPO/tela >=97%', fill.bodyW >= 97, JSON.stringify(fill));
  note('CAMPO >=80% do canvas', fill.fieldPct >= 80, fill.fieldPct + '%');

  /* chip via REAL keyboard (the probe input() is a read-only copy) */
  const w1box = await p.evaluate(() => { const r = window.__host.windows().w1.rect; return { x: r.left + r.width / 2, y: r.top + 40 }; });
  await p.mouse.click(w1box.x, w1box.y);
  await p.waitForTimeout(450);
  const stMenu = await p.evaluate(() => window.__game.state);
  await p.keyboard.press('Space');
  await p.waitForTimeout(450);
  await p.evaluate(() => window.__game.autopilot(false));
  await p.waitForTimeout(250);
  const chips = {};
  chips.play = await p.evaluate(() => document.querySelector('[data-win-label]').textContent);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(350);
  chips.pause = await p.evaluate(() => document.querySelector('[data-win-label]').textContent);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(350);
  chips.demo = await p.evaluate(() => document.querySelector('[data-win-label]').textContent);
  note('CHIP por estado', chips.play === 'PLAYING' && chips.pause === 'PAUSED' && chips.demo === 'DEMO', JSON.stringify(chips) + ' stMenu=' + stMenu);

  const foot = await p.evaluate(() => {
    window.__host.input().fire = true;
    return new Promise((res) => setTimeout(() => {
      const t = document.querySelector('[data-footer]').textContent;
      window.__host.input().fire = false;
      res(t);
    }, 300));
  });
  note('FOOTER dinamico', /MOVE|SELECT|PLAY/.test(foot), foot.slice(0, 60));

  note('CONSOLE', errs.length === 0, errs.length ? errs[0] : 'limpo');

  await ctx.close();
  await b.close();
  const fails = results.filter((x) => !x).length;
  console.log('\nRESUMO: ' + (results.length - fails) + '/' + results.length + (fails ? ' — FALHAS' : ' — ALL PASS'));
}
main().catch((e) => { console.error(e); process.exit(1); });
