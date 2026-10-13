/* garage probe — drives bryangarage.dev via CDP for REA windows.
   Usage: node scripts/garage-probe.mjs <scenario> */
import { chromium } from 'playwright';
const sc = process.argv[2] || 'survey';
const b = await chromium.connectOverCDP('http://127.0.0.1:9222');
const ctx = b.contexts()[0];
const p = ctx.pages().find((x) => /bryangarage/.test(x.url())) || ctx.pages()[0];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (sc === 'survey') {
  const out = await p.evaluate(() => {
    const btns = [...document.querySelectorAll('button,a,[role=button]')].slice(0, 40).map((e) => ({ tag: e.tagName, txt: (e.textContent || '').trim().slice(0, 30), aria: e.getAttribute('aria-label'), cls: (e.className || '').toString().slice(0, 50) }));
    const canvases = [...document.querySelectorAll('canvas')].map((c) => ({ w: c.width, h: c.height, cls: (c.className || '').toString().slice(0, 40), style: (c.getAttribute('style') || '').slice(0, 60) }));
    const scripts = [...document.querySelectorAll('script[src]')].map((s) => s.src.split('/').pop());
    return { btns, canvases, scripts };
  });
  console.log(JSON.stringify(out, null, 1));
} else if (sc === 'open-terminal') {
  await sleep(1500);
  const btn = p.locator('button:has-text("terminal"), a:has-text("terminal"), [aria-label*=terminal i]').first();
  await btn.click({ timeout: 6000 }).catch((e) => console.log('click fail:', e.message));
  await sleep(3000);
  const info = await p.evaluate(() => {
    const win = [...document.querySelectorAll('body *')].find((e) => /terminal|garage-cli|console/i.test(e.className.toString()) && e.getBoundingClientRect().width > 200 && e.getBoundingClientRect().width < 900);
    if (!win) return { found: false };
    const r = win.getBoundingClientRect();
    /* dump the shell: titlebar buttons, canvas, resizer */
    const walker = [];
    for (const el of win.querySelectorAll('*')) {
      if (el.children.length === 0 && (el.tagName === 'BUTTON' || el.hasAttribute('title') || /handle|resize|drag|status/i.test(el.className.toString()))) {
        walker.push({ tag: el.tagName, cls: el.className.toString().slice(0, 50), txt: (el.textContent || '').trim().slice(0, 16), title: el.getAttribute('title') });
      }
      if (walker.length > 24) break;
    }
    return { found: true, cls: win.className.toString().slice(0, 80), rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }, walker };
  });
  console.log(JSON.stringify(info, null, 1));
} else if (sc === 'boot-watch') {
  /* reload the page so the REA window + this watcher catch the boot from t=0 */
  await sleep(1200);
  await p.evaluate(() => sessionStorage.clear());
  const log = await p.evaluate(() => new Promise((res) => {
    const rows = [];
    let last = '';
    const t0 = performance.now();
    const step = () => {
      const lines = [...document.querySelectorAll('[class*=terminal] [class*=line], [class*=boot] [class*=line], [class*=terminal] div, [class*=boot] div')].filter((e) => e.children.length === 0 && (e.textContent || '').trim()).slice(0, 30).map((e) => (e.textContent || '').trim().slice(0, 60));
      const key = lines.join('|');
      if (key && key !== last) { rows.push({ t: Math.round(performance.now() - t0), lines: lines.slice(0, 14) }); last = key; }
      if (performance.now() - t0 < 16000) setTimeout(step, 120); else res(rows);
    };
    step();
  })).catch(() => 'boot-log-failed');
  console.log(JSON.stringify(log, null, 1));
} else if (sc === 'idle-shot') {
  const info = await p.evaluate(() => {
    const cv = [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0];
    const html = cv ? cv.parentElement.outerHTML.slice(0, 500) : null;
    return { canvas: cv ? { w: cv.width, h: cv.height, css: getComputedStyle(cv).width + 'x' + getComputedStyle(cv).height } : null, html };
  });
  console.log(JSON.stringify(info, null, 1));
} else if (sc === 'game-keys') {
  /* from idle, press keys to start the game, then play */
  await sleep(1000);
  await p.keyboard.press('ArrowUp');
  await sleep(2500);
  const st1 = await p.evaluate(() => document.title);
  for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowLeft', 'Space', 'x', 'p']) {
    await p.keyboard.down(k); await sleep(180); await p.keyboard.up(k); await sleep(320);
  }
  await sleep(800);
  const st2 = await p.evaluate(() => ({ paused: !!document.querySelector('[class*=pause]'), canvases: [...document.querySelectorAll('canvas')].map((c) => c.width + 'x' + c.height) }));
  await p.keyboard.press('Escape');
  await sleep(600);
  await p.keyboard.press('q');
  await sleep(800);
  console.log(JSON.stringify({ st1, st2 }));
} else if (sc === 'drag') {
  const info = await p.evaluate(() => {
    const win = [...document.querySelectorAll('body *')].find((e) => /terminal/i.test(e.className.toString()) && e.getBoundingClientRect().width > 200);
    if (!win) return { found: false };
    const r = win.getBoundingClientRect();
    const bar = win.querySelector('[class*=title], [class*=header], [class*=bar]');
    return { found: true, rect: { x: r.x, y: r.y, w: r.width, h: r.height }, barCls: bar ? bar.className.toString().slice(0, 60) : null, winCls: win.className.toString().slice(0, 60) };
  });
  console.log(JSON.stringify(info));
}
await b.close({ runBeforeUnload: false });
