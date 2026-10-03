/* Shaft Runner bot simulation — node scripts/sr-bot.mjs [baseURL] [seeds] */
import { chromium } from 'playwright';

const URL = process.argv[2] || 'http://127.0.0.1:4322/';
const N = parseInt(process.argv[3] || '20', 10);

async function main() {
  const b = await chromium.launch({ headless: false });
  const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(2500);
  /* wait for the game to mount */
  await p.waitForFunction(() => !!window.__game, null, { timeout: 15000 });
  await p.evaluate(() => window.scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * (132 / 1420 + 0.8 * 300 / 1420)));
  await p.waitForTimeout(600);
  const r = await p.evaluate((n) => {
    const g = window.__game;
    const results = [];
    for (let s = 1; s <= n; s++) {
      g.start(s * 17); g.autopilot(true); g.setInputs(null);
      g.step(10800); /* 180 simulated seconds */
      const st = g.stats();
      results.push({ stage: g.stage, state: g.state, deaths: st.deaths, tanks: st.tanksSpawned, got: st.tanksGot });
    }
    const s2 = results.filter((x) => x.stage >= 2).length;
    const s4 = results.filter((x) => x.stage >= 4).length;
    const all = results.flatMap((x) => x.deaths);
    const dist = all.reduce((m, c) => ((m[c] = (m[c] || 0) + 1), m), {});
    const tanks = results.reduce((a, x) => a + x.tanks, 0), got = results.reduce((a, x) => a + x.got, 0);
    return {
      seeds: n, s2Pct: +(s2 / n * 100).toFixed(0), s4Pct: +(s4 / n * 100).toFixed(0),
      deaths: all.length, dist, maxPct: +(Math.max(0, ...Object.values(dist)) / Math.max(1, all.length) * 100).toFixed(1),
      alive: results.filter((x) => x.state === 'play').length,
      collect: +(got / Math.max(1, tanks) * 100).toFixed(0) + '%',
      softlocks: results.filter((x) => x.state === 'play' && x.stage === 1 && x.deaths.length === 0).length,
    };
  }, N);
  console.log(JSON.stringify(r, null, 1));
  console.log('errors:', errs.length ? errs : 'none');
  await b.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
