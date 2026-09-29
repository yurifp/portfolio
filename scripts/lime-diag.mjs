/*
  Phase A diagnosis — real Chromium + real wheel against a URL.
  Usage: node scripts/lime-diag.mjs <url> [pct]
  Dumps: per-cell computed state, ancestor chain (first "hider"),
  rail progress, mode chosen, console + pageErrors.
*/
import { chromium } from 'playwright';

const url = process.argv[2] || 'https://yurifp-portfolio.vercel.app/';
const target = Number(process.argv[3] || 28) / 100;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 2576, height: 1338 } });

const consoleMsgs = [];
page.on('console', (m) => consoleMsgs.push(m.type() + ': ' + m.text().slice(0, 160)));
page.on('pageerror', (e) => consoleMsgs.push('PAGEERROR: ' + String(e).slice(0, 200)));

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(6000); // preloader

// real wheel until rail pct reaches target
for (let burst = 0; burst < 80; burst++) {
  const pct = await page.evaluate(() => {
    const el = document.querySelector('[data-progress-pct]');
    return el ? Number(el.textContent.replace('%', '')) : -1;
  });
  if (pct >= target * 100 - 0.6 && pct <= target * 100 + 1.5) break;
  await page.mouse.move(1288, 669);
  await page.mouse.wheel(0, pct < target * 100 ? 90 : -90);
  await page.waitForTimeout(120);
}
await page.waitForTimeout(1800); // Lenis settle

const diag = await page.evaluate(() => {
  const pick = (el) => {
    if (!el) return null;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      tag: el.tagName.toLowerCase(),
      cls: String(el.className).slice(0, 46),
      opacity: cs.opacity,
      visibility: cs.visibility,
      display: cs.display,
      clip: cs.clipPath !== 'none' ? cs.clipPath.slice(0, 60) : 'none',
      transform: cs.transform === 'none' ? 'none' : cs.transform.slice(0, 52),
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    };
  };
  const cells = [...document.querySelectorAll('[data-lime-card], [data-lime-marca]')].map((c) => {
    const chain = [];
    let a = c.parentElement;
    while (a && !a.classList.contains('lime-stage')) {
      const cs = getComputedStyle(a);
      chain.push({
        cls: String(a.className).slice(0, 40),
        opacity: cs.opacity, visibility: cs.visibility,
        clip: cs.clipPath !== 'none' ? cs.clipPath.slice(0, 48) : 'none',
        h: Math.round(a.getBoundingClientRect().height),
      });
      a = a.parentElement;
    }
    const inner = [...c.querySelectorAll('*')].slice(0, 4).map(pick);
    return { self: pick(c), chainUpToStage: chain, innerSample: inner };
  });
  const lines = [...document.querySelectorAll('.lime-line')].map((l) => {
    const cs = getComputedStyle(l);
    return { transform: cs.transform.slice(0, 30) };
  });
  return {
    railPct: document.querySelector('[data-progress-pct]')?.textContent,
    scrollY: Math.round(window.scrollY),
    docH: document.documentElement.scrollHeight,
    staticMode: !!document.querySelector('[data-flip-stage][data-static]'),
    limeFrame: pick(document.querySelector('[data-flip-frame="lime"]')),
    cells, lines,
    marcaStyle: (() => { const m = document.querySelector('[data-lime-marca] canvas'); if (!m) return null; const cs = getComputedStyle(m); const r = m.getBoundingClientRect(); return { h: Math.round(r.height), w: Math.round(r.width) }; })(),
    pageErrors: window.__pageErrors || [],
  };
});

console.log(JSON.stringify({ consoleMsgs: consoleMsgs.slice(0, 12), diag }, null, 1));
await browser.close();
