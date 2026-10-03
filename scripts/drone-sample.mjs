/* drone contrast sampling — polls the live canvas until a drone is visible */
import { chromium } from 'playwright';

const URL = process.argv[2] || 'http://127.0.0.1:4322/';

async function main() {
  const b = await chromium.launch({ headless: false });
  const p = await b.newPage({ viewport: { width: 1878, height: 946 } });
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(2500);
  await p.evaluate(() => window.scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * (132 / 1420 + 0.8 * 300 / 1420)));
  await p.waitForTimeout(700);
  const box = await p.evaluate(() => { const r = window.__host.windows().w1.rect; return { x: r.left + r.width / 2, y: r.top + 40 }; });
  await p.mouse.click(box.x, box.y);
  await p.waitForTimeout(350);
  await p.keyboard.press('Space');
  await p.waitForTimeout(500);
  await p.evaluate(() => window.__game.autopilot(true));
  const r = await p.evaluate(() => new Promise((res) => {
    const cv = document.querySelector('[data-win="w1"] canvas');
    const x = cv.getContext('2d');
    const s = cv.width / 108;
    const iv = setInterval(() => {
      const d = x.getImageData(0, 0, cv.width, cv.height).data;
      const at = (cx, cy) => { const i = (Math.round(cy * s) * cv.width + Math.round(cx * s)) * 4; return [d[i], d[i + 1], d[i + 2]]; };
      for (const e of window.__game.entities()) {
        if (e.type === 'drone' && e.sy > 16 && e.sy < 176) {
          clearInterval(iv);
          const drone = at(Math.round(e.x), Math.round(e.sy));
          const shaft = at(54, 100);
          const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
          const L = (c) => 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
          res({ drone, shaft, ratio: +(((Math.max(L(drone), L(shaft)) + 0.05) / (Math.min(L(drone), L(shaft)) + 0.05)).toFixed(2)) });
          return;
        }
      }
    }, 150);
    setTimeout(() => { clearInterval(iv); res(null); }, 25000);
  }));
  console.log('DRONE:', JSON.stringify(r));
  await b.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
