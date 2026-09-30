/* Final consolidated verification for the LED wall v2 */
import { chromium } from 'playwright';

const URL = 'http://127.0.0.1:4322/';

async function main() {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1878, height: 946 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e).slice(0, 120)));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 120)); });
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1800);
  const scroll = (f) => p.evaluate((f) => window.scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * f), f);
  const wait = (ms) => p.waitForTimeout(ms);
  const st = () => p.evaluate(() => ({ i: window.__ledwall.ignite, s: window.__ledwall.sweep, t: document.body.dataset.theme }));

  await scroll(0); await wait(900);
  await p.screenshot({ path: 'evidence/final-hero-0.png' });
  console.log('hero-0:', JSON.stringify(await st()), 'ledwall inactive:', await p.evaluate(() => !window.__ledwall.active));

  await scroll(0.066); await wait(900); await p.screenshot({ path: 'evidence/final-wave-1.png' });
  await scroll(0.086); await wait(900); await p.screenshot({ path: 'evidence/final-wave-2.png' });
  console.log('wave mids:', JSON.stringify(await st()));

  for (let k = 1; k <= 3; k++) { await scroll(0.18); await wait(700); await p.screenshot({ path: `evidence/final-scene-${k}.png` }); await wait(500); }

  const pts = [0.253, 0.258, 0.263, 0.268, 0.273];
  for (let k = 0; k < pts.length; k++) { await scroll(pts[k]); await wait(900); console.log('sweep p=' + pts[k], JSON.stringify(await st())); await p.screenshot({ path: `evidence/final-sweep-${k + 1}.png` }); }
  await scroll(0.29); await wait(900);
  await p.screenshot({ path: 'evidence/final-lime-real.png' });
  for (let k = pts.length - 1; k >= 0; k--) await scroll(pts[k]);
  await wait(600);
  console.log('reversed to p=0.253:', JSON.stringify(await st()));

  /* contrast on final build */
  await scroll(0.18); await wait(800);
  const rects = await p.evaluate(() => {
    const r = (el) => { const x = el.getBoundingClientRect(); return { x: Math.round(x.x), y: Math.round(x.y), w: Math.round(x.width), h: Math.round(x.height) }; };
    return {
      logo: r(document.querySelector('[aria-label="Home"]')),
      clock: r(document.querySelector('[data-clock]')),
      menu: r(document.querySelector('[data-menu-btn]')),
      rail: r(document.querySelector('.progress-rail')),
      pct: r(document.querySelector('[data-progress-pct]')),
    };
  });
  const worst = {};
  for (let shot = 0; shot < 3; shot++) {
    const buf = await p.screenshot();
    const p2 = await b.newPage();
    const uri = 'data:image/png;base64,' + buf.toString('base64');
    const res = await p2.evaluate(async ([src, rects]) => {
      const img = new Image(); img.src = src; await img.decode();
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      const x = c.getContext('2d'); x.drawImage(img, 0, 0);
      const out = {};
      for (const [name, rc] of Object.entries(rects)) {
        const d = x.getImageData(rc.x, rc.y, Math.max(rc.w, 2), Math.max(rc.h, 2)).data;
        const lums = [], greens = [];
        for (let i = 0; i < d.length; i += 4) {
          const [r, g, bl] = [d[i], d[i + 1], d[i + 2]];
          const l = (r * 0.2126 + g * 0.7152 + bl * 0.0722) / 255;
          lums.push(l);
          if (g > 60 && g > r * 1.6) greens.push(l);
        }
        lums.sort((a, z) => a - z);
        greens.sort((a, z) => a - z);
        const text = lums[lums.length - 1];
        const bg = greens.length ? greens[greens.length - 1] : 0;
        out[name] = +((text + 0.05) / (bg + 0.05)).toFixed(2);
      }
      return out;
    }, [uri, rects]);
    for (const [k, v] of Object.entries(res)) worst[k] = Math.max(worst[k] || 0, v);
    await p2.close();
    await wait(700);
  }
  console.log('contrast worst-case:', JSON.stringify(worst), '| all>=4.5:', Object.values(worst).every((v) => v >= 4.5));

  console.log('errors:', errs.length ? errs : 'none');
  await b.close();

  /* mobile + reduced */
  const b2 = await chromium.launch();
  const mob = await b2.newPage({ viewport: { width: 390, height: 844 } });
  const mErrs = [];
  mob.on('pageerror', (e) => mErrs.push(String(e).slice(0, 80)));
  await mob.goto(URL, { waitUntil: 'networkidle' });
  await mob.waitForTimeout(1200);
  console.log('mobile 390:', JSON.stringify(await mob.evaluate(() => ({ mode: window.__ledwall?.mode, cols: window.__ledwall?.cols }))), mErrs.length ? 'pre-existing: ' + mErrs[0] : 'no NEW errors');
  const red = await b2.newPage({ viewport: { width: 1878, height: 946 }, reducedMotion: 'reduce' });
  await red.goto(URL, { waitUntil: 'networkidle' });
  await red.waitForTimeout(1200);
  console.log('reduced:', JSON.stringify(await red.evaluate(() => ({ staticMode: document.querySelector('.flip-stage')?.hasAttribute('data-static'), wall: window.__ledwall?.mode }))));
  await b2.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
