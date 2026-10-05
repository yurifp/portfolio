/* Visual rebuild verification: contrast table (before/after), black floor, crops */
import { chromium } from 'playwright';
import fs from 'fs';

const URL = process.argv[2] || 'http://127.0.0.1:4322/';
const PLATEAU = `((document.documentElement.scrollHeight - innerHeight) * ${(132 / 1420 + 0.8 * 300 / 1420).toFixed(6)})`;

/* luminance (WCAG) + ratio */
function lum(rgb) {
  const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
}
function ratio(a, b) { const l1 = lum(a), l2 = lum(b); return +(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)).toFixed(2)); }

async function main() {
  const b = await chromium.launch({ headless: false });
  const ctx = await b.newContext({ viewport: { width: 1878, height: 946 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e).slice(0, 150)));
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(2500);
  await p.evaluate(`window.scrollTo(0, ${PLATEAU})`);
  await p.waitForTimeout(800);
  await p.waitForFunction(() => !!window.__game, null, { timeout: 10000 });

  /* focus → menu → start */
  const box = await p.evaluate(() => { const r = window.__host.windows().w1.rect; return { x: r.left + r.width / 2, y: r.top + 40 }; });
  await p.mouse.click(box.x, box.y);
  await p.waitForTimeout(400);
  await p.keyboard.press('Space');
  await p.waitForTimeout(1500);

  /* play for a while so entities are on screen */
  await p.evaluate(() => window.__game.autopilot(true));
  await p.waitForTimeout(4000);

  /* sample: game canvas + windows */
  const data = await p.evaluate(() => {
    const cv = document.querySelector('[data-win="w1"] canvas');
    const x = cv.getContext('2d');
    const d = x.getImageData(0, 0, cv.width, cv.height).data;
    const w = cv.width, h = cv.height;
    const ship = window.__game.ship;
    const s = cv.width / 216; /* device px per logical cell */
    const at = (cx, cy) => { const i = (Math.round(cy * s) * w + Math.round(cx * s)) * 4; return [d[i], d[i + 1], d[i + 2]]; };
    /* new layout sample points (216×384 cells) */
    const regionMax = (x0, y0, x1, y1) => { let best = [0, 0, 0]; for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) { const c2 = at(cx, cy); if (c2[1] > best[1]) best = c2; } return best; };
    const scoreNum = regionMax(6, 13, 53, 21);
    const scoreBg = at(80, 5);
    const fuelFill = regionMax(42, 353, 120, 363);
    const fuelBg = at(14, 358);
    
    
    const wall = at(3, 100);
    const shaft = at(108, 100);
    const wl = window.__game ? window.__game.wall(Math.round(1)) : { l: 10, r: 98 };
    const border = at(wl.l * 2, 100);
    const shipPx = at(Math.round(ship.x * 2), Math.round(ship.y));
    /* chrome: titlebar text vs bg (DOM) */
    const title = getComputedStyle(document.querySelector('[data-win="w1"] .win-title')).color.match(/\d+/g).map(Number);
    const titleBg = [2, 10, 4];
    const stateLbl = getComputedStyle(document.querySelector('[data-win="w2"] .win-label')).color.match(/\d+/g).map(Number);
    /* terminal text */
    const term = getComputedStyle(document.querySelector('[data-term]')).color.match(/\d+/g).map(Number);
    /* enemy: find a drone cell via probe */
    let enemy = null, foeBullet = null, pickup = null;
    const es = window.__game.entities();
    for (const e of es) { if (e.type === 'drone' && e.sy > 32 && e.sy < 338) { enemy = at(Math.round(e.x * 2), Math.round(e.sy)); break; } }
    for (const e of es) { if (e.type === 'tank' && e.sy > 32 && e.sy < 338) { pickup = at(Math.round(e.x * 2), Math.round(e.sy)); break; } }
    const bs = window.__game.bullets();
    for (const bl of bs) { if (bl.foe && bl.sy > 32 && bl.sy < 338) { foeBullet = regionMax(Math.round(bl.x) - 3, Math.round(bl.sy) - 3, Math.round(bl.x) + 3, Math.round(bl.sy) + 3); break; } }
    return { scoreNum, scoreBg, fuelFill, fuelBg, wall, shaft, border, shipPx, title, titleBg, stateLbl, term, enemy, foeBullet, pickup, w, h };
  });

  /* screen-black floor: most common color in the canvas */
  const floor = await p.evaluate(() => {
    const cv = document.querySelector('[data-win="w1"] canvas');
    const x = cv.getContext('2d');
    const d = x.getImageData(0, 0, cv.width, cv.height).data;
    const count = new Map();
    for (let i = 0; i < d.length; i += 4) { const k = d[i] + ',' + d[i + 1] + ',' + d[i + 2]; count.set(k, (count.get(k) || 0) + 1); }
    const top = [...count.entries()].sort((a, z) => z[1] - a[1])[0][0].split(',').map(Number);
    const hex = '#' + top.map((v) => v.toString(16).padStart(2, '0')).join('');
    return { top, hex };
  });

  const rows = [
    ['HUD número (SCORE) vs placa', ratio(data.scoreNum, data.scoreBg)],
    ['HUD rótulo FUEL vs placa', ratio(data.fuelFill, data.fuelBg)],
    ['nave vs poço (fundo local)', ratio(data.shipPx, data.shaft)],
    ['inimigo (drone) vs poço', data.enemy ? ratio(data.enemy, data.shaft) : null],
    ['pickup (tanque) vs poço', data.pickup ? ratio(data.pickup, data.shaft) : null],
    ['tiro inimigo vs poço', data.foeBullet ? ratio(data.foeBullet, data.shaft) : null],
    ['borda do terreno vs poço', ratio(data.border, data.shaft)],
    ['parede vs poço', ratio(data.wall, data.shaft)],
    ['cromo título vs bg', ratio(data.title, data.titleBg)],
    ['cromo rótulo estado vs bg', ratio(data.stateLbl, data.titleBg)],
    ['terminal texto vs bg', data.term ? ratio(data.term, data.titleBg) : null],
  ];
  console.log('PRETO DA TELA (mais comum):', floor.hex, floor.hex <= '#031208' ? 'OK ≤ #031208' : 'CHECK');
  console.log('TABELA DE CONTRASTE (pixels finais, com CRT):');
  for (const [k, v] of rows) console.log('  ' + k + ': ' + (v === null ? 'sem amostra' : v + ':1'));
  console.log('errors:', errs.length ? errs : 'none');

  /* crops 1:1 */
  fs.mkdirSync('evidence/vis-after', { recursive: true });
  const clip = async () => p.evaluate(() => { const r = window.__host.windows().w1.rect; return { x: Math.max(0, r.left - 8), y: Math.max(0, r.top - 8), width: Math.min(innerWidth - r.left, r.width + 16), height: Math.min(innerHeight - r.top, r.height + 16) }; });
  await p.screenshot({ path: 'evidence/vis-after/game.png', clip: await clip() });
  await p.evaluate(() => { window.__game.step(2); });
  await p.screenshot({ path: 'evidence/vis-after/full-1878.png' });
  /* windows crops */
  for (const id of ['w1', 'w2', 'w3']) {
    const c = await p.evaluate((id) => { const r = window.__host.windows()[id].rect; return { x: Math.max(0, r.left - 6), y: Math.max(0, r.top - 6), width: r.width + 12, height: r.height + 12 }; }, id);
    await p.screenshot({ path: 'evidence/vis-after/win-' + id + '.png', clip: c });
  }
  await ctx.close();

  /* 50% version */
  const ctx2 = await b.newContext({ viewport: { width: 939, height: 473 } });
  const p2 = await ctx2.newPage();
  await p2.goto(URL, { waitUntil: 'networkidle' });
  await p2.waitForTimeout(2000);
  await p2.evaluate(`window.scrollTo(0, ${PLATEAU})`);
  await p2.waitForTimeout(700);
  await p2.screenshot({ path: 'evidence/vis-after/half-939.png' });
  await ctx2.close();
  await b.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
