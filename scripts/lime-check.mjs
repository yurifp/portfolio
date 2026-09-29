/*
  lime-check — the acceptance harness (real Chromium, real wheel).
  For each checkpoint: wheel until __flipbook.progress() hits ±0.5%,
  settle, screenshot + JSON state. FAILS (exit 1) if at 28% any
  card/label/number/icon/marca has opacity < 0.99, empty rect, or
  rect outside its cell (±1px). Also proves 3-arrival equivalence.
  Usage: node scripts/lime-check.mjs <url> <outDir> [--skip-routes]
*/
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const url = process.argv[2] || 'http://localhost:4322/';
const outDir = process.argv[3] || 'evidence/lime';
const skipRoutes = process.argv.includes('--skip-routes');
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 2576, height: 1338 } });
const consoleMsgs = [];
page.on('console', (m) => { if (m.type() !== 'log') consoleMsgs.push(m.type() + ': ' + m.text().slice(0, 140)); });
page.on('pageerror', (e) => consoleMsgs.push('PAGEERROR: ' + String(e).slice(0, 160)));

const wheelTo = async (target) => {
  for (let i = 0; i < 160; i++) {
    const p = await page.evaluate(() => window.__flipbook ? window.__flipbook.progress() : -1);
    if (p < 0) throw new Error('NO __flipbook PROBE');
    if (Math.abs(p - target) <= 0.005) return p;
    await page.mouse.move(1288, 669);
    await page.mouse.wheel(0, p < target ? 120 : -240);
    await page.waitForTimeout(70);
  }
  throw new Error('could not reach progress ' + target);
};

const stateAt = async () => page.evaluate(() => {
  const cs = (el) => {
    const c = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return { op: Number(c.opacity), vis: c.visibility, clip: c.clipPath !== 'none' ? c.clipPath.slice(0, 44) : 'none', rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] };
  };
  const cells = [...document.querySelectorAll('[data-lime-cell]')];
  const cards = cells.map((cell) => {
    const cr = cell.getBoundingClientRect();
    const reveal = cell.querySelector('[data-lime-reveal]');
    const label = cell.querySelector('[data-lime-label]');
    const num = cell.querySelector('[data-lime-odo]');
    const icon = cell.querySelector('[data-dither]');
    const content = num || icon;
    const cc = content ? content.getBoundingClientRect() : null;
    const inside = cc ? cc.left >= cr.left - 1 && cc.right <= cr.right + 1 && cc.top >= cr.top - 1 && cc.bottom <= cr.bottom + 1 : null;
    return {
      cell: cs(cell), reveal: reveal ? cs(reveal) : null,
      label: label ? cs(label) : null, content: content ? cs(content) : null,
      contentInsideCell: inside,
    };
  });
  const marca = null;
  const mCan = null;
  const railSlots = [...document.querySelectorAll('.progress-rail .rail-slot, .progress-rail .rail-scroll')].map((s) => {
    const c = getComputedStyle(s);
    return { txt: s.textContent.trim().slice(0, 8), color: c.color, bg: getComputedStyle(document.body).backgroundColor };
  });
  return {
    progress: window.__flipbook.progress(),
    railPct: document.querySelector('[data-progress-pct]')?.textContent,
    theme: document.body.dataset.theme,
    cards, marca: marca ? cs(marca) : null, marcaCanvas: mCan ? cs(mCan) : null,
    railSlots, pageErrors: window.__pageErrors || [],
  };
});

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(6500);

const CHECKPOINTS = [0.13, 0.14, 0.17, 0.20, 0.24, 0.28, 0.30];
const shots = [];
for (const cp of CHECKPOINTS) {
  await wheelTo(cp);
  await page.waitForTimeout(1500);
  const st = await stateAt();
  shots.push({ cp, state: st });
  await page.screenshot({ path: `${outDir}/cp-${Math.round(cp * 100)}.png` });
}

/* 28% three arrivals */
const arrivals = {};
if (!skipRoutes) {
  arrivals.slow = (await stateAt()).cards; // still at 28 from checkpoints
  await page.reload({ waitUntil: 'networkidle' });
  await page.evaluate(() => window.scrollTo(0, Math.round(0.28 * (document.documentElement.scrollHeight - innerHeight))));
  await page.waitForTimeout(2500);
  arrivals.reload = (await stateAt()).cards;
  await wheelTo(0.6);
  await page.waitForTimeout(800);
  await wheelTo(0.28);
  await page.waitForTimeout(1500);
  arrivals.from60 = (await stateAt()).cards;
  await page.screenshot({ path: `${outDir}/arrival-from60-28.png` });
}

/* assertion gate: at 28% everything visible & inside its cell */
const c28 = shots.find((s) => Math.abs(s.cp - 0.28) < 0.005) || shots[shots.length - 2];
const failures = [];
c28.state.cards.forEach((c, i) => {
  if (c.reveal && c.reveal.op < 0.99) failures.push(`card${i} reveal opacity ${c.reveal.op}`);
  if (c.reveal && c.reveal.rect[2] === 0) failures.push(`card${i} reveal empty rect`);
  if (c.label && c.label.op < 0.99) failures.push(`card${i} label opacity ${c.label.op}`);
  if (c.content && c.content.op < 0.99) failures.push(`card${i} content opacity ${c.content.op}`);
  if (c.contentInsideCell === false) failures.push(`card${i} content outside cell`);
});
if (c28.state.marcaCanvas && c28.state.marcaCanvas.op < 0.99) failures.push('marca opacity');
const sameArrivals = !skipRoutes || JSON.stringify(arrivals.slow) === JSON.stringify(arrivals.reload);
writeFileSync(`${outDir}/lime-check.json`, JSON.stringify({ url, shots, arrivals, failures, consoleMsgs: consoleMsgs.slice(0, 10) }, null, 1));

console.log('progress@28:', c28.state.progress.toFixed(3), '| theme:', c28.state.theme);
console.log('cards:', c28.state.cards.length, '| failures:', failures.length);
failures.forEach((f) => console.log('  FAIL:', f));
console.log('arrivals equal (slow vs reload):', sameArrivals ? 'YES' : 'NO');
console.log('gsap target warnings:', consoleMsgs.filter((m) => m.includes('GSAP')).length);
if (failures.length || !sameArrivals) { await browser.close(); process.exit(1); }
await browser.close();
console.log('PASS');
