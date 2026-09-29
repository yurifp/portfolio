/*
  lime-pixels — PIXEL-LEVEL acceptance for the lime scene.
  Real Chromium, mouse.wheel, deviceScaleFactor 1. Measures actual
  screenshot pixels: FILL ratio, STROKE darker-than-fill, CHANFRO,
  column LINES, dark TEXT/ICON pixels. Exit 1 on any failure.
  Usage: node scripts/lime-pixels.mjs <url> <outJson> [--selftest]
    --selftest hides [data-lime-shape] + .lime-line via CSS injection
    and expects items 1–4 to FAIL (test of the test).
*/
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const url = process.argv[2] || 'http://localhost:4322/';
const out = process.argv[3] || 'evidence/lime-pixels.json';
const selftest = process.argv.includes('--selftest');

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 2576, height: 1338 }, deviceScaleFactor: 1 });
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(6000);
if (selftest) {
  await page.addStyleTag({ content: '[data-lime-shape]{display:none!important}.lime-line{display:none!important}' });
}
for (let i = 0; i < 80; i++) {
  const pr = await page.evaluate(() => (window.__flipbook ? window.__flipbook.progress() : 0));
  if (pr > 0.269) break;
  await page.mouse.move(1288, 669);
  await page.mouse.wheel(0, 120);
  await page.waitForTimeout(50);
}
await page.waitForTimeout(1600);

const shot = await page.screenshot();
const { data, width } = await (async () => {
  const sharp = (await import('sharp')).default;
  const raw = await sharp(shot).raw().toBuffer({ resolveWithObject: true });
  return { data: raw.data, width: raw.info.width };
})();
const px = (x, y) => {
  const i = (y * width + x) * 3;
  return [data[i], data[i + 1], data[i + 2]];
};
const lum = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

const geo = await page.evaluate(() => {
  const cells = [...document.querySelectorAll('[data-lime-cell]')].map((c) => {
    const r = c.getBoundingClientRect();
    const label = c.querySelector('[data-lime-label]')?.getBoundingClientRect();
    const num = (c.querySelector('[data-lime-odo]') || c.querySelector('[data-dither-icon]'))?.getBoundingClientRect();
    const shape = c.querySelector('[data-lime-shape]')?.getBoundingClientRect();
    return {
      x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
      label: label ? { y: Math.round(label.y), b: Math.round(label.bottom), x: Math.round(label.x), w: Math.round(label.width) } : null,
      num: num ? { y: Math.round(num.y), b: Math.round(num.bottom), x: Math.round(num.x), w: Math.round(num.width) } : null,
      shape: shape ? { x: Math.round(shape.x), y: Math.round(shape.y), w: Math.round(shape.width), h: Math.round(shape.height) } : null,
    };
  });
  const grid = document.querySelector('.lime-grid').getBoundingClientRect();
  const lines = [...document.querySelectorAll('.lime-line')].map((l) => {
    const r = l.getBoundingClientRect();
    return Math.round(r.x + r.width); /* border-right x */
  });
  return { cells, grid: { l: Math.round(grid.left), r: Math.round(grid.right), t: Math.round(grid.top) }, lines };
});

const failures = [];
const results = { fill: [], stroke: [], chamfer: [], lines: [], text: [], geometry: [] };

/* background reference: empty cell (2,1) area pixel */
const bgPix = px(Math.round(geo.grid.l + geo.cells[0].w * 1.5), Math.round(geo.cells[0].h * 0.5 + geo.grid.t));
const bgL = lum(bgPix);

/* 1. FILL — 3 interior points per card, clear of label/num rects */
geo.cells.forEach((c, i) => {
  const pts = [];
  const pad = 14;
  /* candidate grid of interior points, pick 3 far from text rects */
  for (let fy = 0.3; fy <= 0.85; fy += 0.18) {
    for (let fx = 0.3; fx <= 0.8; fx += 0.16) {
      const X = Math.round(c.x + c.w * fx);
      const Y = Math.round(c.y + c.h * fy);
      const inText = (r) => r && X >= r.x - 8 && X <= r.x + r.w + 8 && Y >= r.y - 8 && Y <= r.b + 8;
      if (!inText(c.label) && !inText(c.num)) pts.push([X, Y]);
    }
  }
  const chosen = pts.slice(0, 3).concat(pts.slice(-3)).slice(0, 3);
  const ratios = chosen.map(([X, Y]) => +(lum(px(X, Y)) / bgL).toFixed(3));
  const ok = ratios.every((r) => r >= 0.55 && r <= 0.82);
  results.fill.push({ card: i, ratios, ok });
  if (!ok) failures.push(`FILL card${i}: ${ratios.join(',')}`);
});

/* 2. STROKE — edge pixels of the card's LIVE shape rect (parallax
   shifts the card ±8px inside its cell) */
const c0 = geo.cells[0].shape || geo.cells[0];
const strokePts = [
  px(c0.x + Math.round(c0.w * 0.5), c0.y + 1),
  px(c0.x + 1, Math.round(c0.y + c0.h * 0.55)),
  px(c0.x + Math.round(c0.w * 0.5), c0.y + c0.h - 1),
  px(c0.x + c0.w - 1, Math.round(c0.y + c0.h * 0.5)),
];
const fillRef = results.fill[0].ratios.reduce((a, b) => a + b, 0) / 3 * bgL;
const strokeRatios = strokePts.map((p) => +(lum(p) / bgL).toFixed(3));
/* ≥5% darker on 3 of 4 edges; the 4th may straddle the AA blend
   between the 1.5px stroke ring and the fill inset */
const darker = strokeRatios.filter((r) => r <= fillRef / bgL - 0.05).length;
const strokeOk = darker >= 3;
results.stroke = { ratios: strokeRatios, fillRef: +(fillRef / bgL).toFixed(3), ok: strokeOk };
if (!strokeOk) failures.push('STROKE not darker than fill');

/* 3. CHANFRO — left notch at 24% height = bg; 60% = painted; corner cut = bg */
const notch = px(c0.x + 4, Math.round(c0.y + c0.h * 0.24));
const mid = px(c0.x + 4, Math.round(c0.y + c0.h * 0.6));
const corner = px(c0.x + c0.w - 3, c0.y + c0.h - 3);
const nearCorner = px(c0.x + c0.w - 30, c0.y + c0.h - 3);
const ch = {
  notchIsBg: Math.abs(lum(notch) - bgL) < 12,
  midPainted: lum(mid) < bgL * 0.9,
  cornerIsBg: Math.abs(lum(corner) - bgL) < 12,
  nearCornerPainted: lum(nearCorner) < bgL * 0.95,
};
results.chamfer = ch;
if (!(ch.notchIsBg && ch.midPainted && ch.cornerIsBg && ch.nearCornerPainted)) failures.push('CHANFRO: ' + JSON.stringify(ch));

/* 4. LINES — column borders; sample at 97vh (below the grid, clear
   of the HUD text that overlaps 5vh); border-right paints at x-1 */
const H = 1338;
const lineY = Math.round(H * 0.97);
const lineChecks = [];
[geo.cells[0].x, ...geo.lines, geo.grid.r].slice(0, 7).forEach((x, i) => {
  if (i === 0) return;
  const on = Math.min(lum(px(x - 2, lineY)), lum(px(x - 1, lineY)), lum(px(x, lineY))) / bgL;
  const off = lum(px(x + 4, lineY)) / bgL;
  const ok = on >= 0.70 && on <= 0.97 && Math.abs(off - 1) < 0.08;
  lineChecks.push({ x, on: +on.toFixed(3), off: +off.toFixed(3), ok });
  if (!ok) failures.push(`LINE x=${x}: on ${on.toFixed(2)} off ${off.toFixed(2)}`);
});
results.lines = lineChecks;

/* 5. TEXT/ICONS — dark pixels inside label/num rects */
geo.cells.forEach((c, i) => {
  let dark = 0, total = 0;
  const rects = [c.label, c.num].filter(Boolean);
  rects.forEach((r) => {
    for (let Y = r.y; Y < r.b; Y += 3) {
      for (let X = r.x; X < r.x + r.w; X += 3) {
        total++;
        if (lum(px(X, Y)) <= bgL * 0.25) dark++;
      }
    }
  });
  const ok = dark > 8;
  results.text.push({ card: i, dark, ok });
  if (!ok) failures.push(`TEXT card${i}: only ${dark} dark px`);
});

/* 7. GEOMETRY — cards inside cells ±1, no cross, label↔num gap ≥24 */
const widths = geo.cells.map((c) => c.w);
const colSpread = Math.max(...widths) - Math.min(...widths);
geo.cells.forEach((c, i) => {
  if (c.label && c.num && (c.num.y - c.label.b) < 24) failures.push(`GAP card${i}: ${c.num.y - c.label.b}px`);
});
if (colSpread > 1) failures.push('COLUMNS spread ' + colSpread);
results.geometry = { colSpread, minGap: Math.min(...geo.cells.map((c) => (c.label && c.num ? c.num.y - c.label.b : 999))) };

/* 8. ICONS — slugs present, no fillText letters */
const iconInfo = await page.evaluate(() => ({
  slugs: [...document.querySelectorAll('[data-dither-icon]')].map((c) => c.dataset.ditherIcon),
  textDithers: document.querySelectorAll('canvas[data-dither]:not([data-dither-icon])').length,
}));
results.icons = iconInfo;
if (iconInfo.slugs.length !== 10 || iconInfo.textDithers !== 0) failures.push('ICONS: ' + JSON.stringify(iconInfo));

writeFileSync(out, JSON.stringify({ url, selftest, results, failures }, null, 1));
console.log(selftest ? '[SELFTEST — expecting items 1-4 to FAIL]' : '[RUN]');
console.log('fill ok:', results.fill.filter((f) => f.ok).length + '/' + results.fill.length, '| stroke:', results.stroke.ok, '| chamfer:', results.chamfer.notchIsBg && results.chamfer.cornerIsBg, '| lines ok:', lineChecks.filter((l) => l.ok).length, '| text ok:', results.text.filter((t) => t.ok).length + '/' + results.text.length);
console.log('failures:', failures.length);
failures.slice(0, 8).forEach((f) => console.log('  ✗', f));
await browser.close();
if (selftest) {
  const paintFails = failures.filter((f) => /^(FILL|STROKE|CHANFRO|LINE)/.test(f)).length;
  console.log(paintFails > 0 ? 'SELFTEST PASS (test sees the defect: ' + paintFails + ' paint failures)' : 'SELFTEST FAIL (test is blind!)');
  process.exit(paintFails > 0 ? 0 : 1);
}
process.exit(failures.length ? 1 : 0);
