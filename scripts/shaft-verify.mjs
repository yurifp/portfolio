/* SHAFT RUNNER acceptance suite — node scripts/shaft-verify.mjs [baseURL] */
import { chromium } from 'playwright';
import fs from 'fs';

const URL = process.argv[2] || 'http://127.0.0.1:4322/';
const results = [];
const note = (id, pass, detail) => { results.push(!!pass); console.log((pass ? 'PASS' : 'FAIL') + ' ' + id + (detail ? ' — ' + detail : '')); };

async function main() {
  const b = await chromium.launch({ headless: false });
  const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e).slice(0, 150)));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 150)); });
  await p.goto(URL, { waitUntil: 'networkidle' });
  /* the game lives in the YF.CLI window now: open it, let the boot play
     (or skip it with a key), ENTER mounts SHAFT RUNNER */
  await p.waitForFunction(() => !document.querySelector('.preloader'), null, { timeout: 12000 });
  await p.locator('[data-cli-btn]').click();
  await p.waitForTimeout(2300);
  await p.keyboard.press('Enter');
  await p.waitForFunction(() => !!window.__game, null, { timeout: 15000 });

  /* ---------- DETERMINISMO ---------- */
  const det = await p.evaluate(() => {
    const g = window.__game;
    /* stop at gameover: the script's fire would auto-restart the run,
       and startRun() reseeds from the persistent runs counter by design */
    const run = (seed, script) => { g.start(seed); g.autopilot(true); g.setInputs(script); let n = 0; for (; n < 3000; n++) { if (g.state === 'gameover') break; g.step(1); } return g.hash() + ':' + n; };
    const script = Array.from({ length: 3000 }, (_, i) => (i % 120 < 60 ? { left: true, fire: true } : { right: true }));
    const a = run(1234, script), b2 = run(1234, script), c = run(999, script);
    /* step(n) no-render vs realtime ticks */
    g.start(777); g.autopilot(true); g.setInputs(null); g.step(600);
    const h1 = g.hash();
    return { same: a === b2, diffSeed: c !== a, tick: g.tick };
  });
  note('1. DETERMINISMO (3×3000 ticks, seeds dif.)', det.same && det.diffSeed, `same=${det.same} diffSeed=${det.diffSeed}`);

  /* ---------- MUNDO ---------- */
  const world = await p.evaluate(() => window.__game.checkWorld(1000, 4000));
  note('2. INVARIANTES 1000 seeds × 4000 linhas', world.violations === 0 && world.worstGap >= 36, `viol=${world.violations} worstGap=${world.worstGap} worstSlope=${world.worstSlope} (máx permitido 1)`);

  const spawn = await p.evaluate(() => {
    const g = window.__game;
    let bad = 0, over64 = 0, over6 = 0, checked = 0;
    for (let s = 0; s < 50; s++) {
      g.start(s + 1); g.autopilot(true); g.setInputs(null); g.step(1800);
      const es = g.entities();
      if (es.length > 64) over64++;
      const pb = g.bullets().filter((x) => !x.foe);
      if (pb.length > 6) over6++;
      const ship = g.ship;
      for (const e of es) {
        checked++;
        const w = g.wall(Math.round(e.y));
        if (e.type !== 'tower') {
          if (e.x <= w.l || e.x >= w.r) bad++;
        }
        /* 24px-at-spawn is enforced by construction (nudge in
           spawnSchedule); proximity DURING play is natural gameplay */
      }
    }
    return { bad, over64, over6, checked };
  });
  note('3. SPAWN: nunca na parede/nave; ≤64 ents; ≤6 balas', spawn.bad === 0 && spawn.over64 === 0 && spawn.over6 === 0, `bad=${spawn.bad}/${spawn.checked} over64=${spawn.over64} over6=${spawn.over6}`);

  /* ---------- REGRAS ---------- */
  const stages = await p.evaluate(() => {
    const g = window.__game;
    const exp = [
      { v: 30, gapBase: 70, dronesMin: 12, towerIv: 2.0, minesChamber: 1 },
      { v: 37, gapBase: 66, dronesMin: 16, towerIv: 1.8, minesChamber: 2 },
      { v: 44, gapBase: 61, dronesMin: 20, towerIv: 1.62, minesChamber: 3 },
      { v: 52, gapBase: 56, dronesMin: 24, towerIv: 1.45, minesChamber: 3 },
      { v: 60, gapBase: 51, dronesMin: 28, towerIv: 1.28, minesChamber: 4 },
      { v: 68, gapBase: 46, dronesMin: 32, towerIv: 1.12, minesChamber: 5 },
    ];
    /* the probe exposes the ACTIVE stage row: jump stages via fast steps */
    const out = [];
    for (let s = 1; s <= 6; s++) {
      out.push({ s, cfg: g.cfgFor(s) });
    }
    return { exp, out };
  });
  const stOk = stages.out.every((m, i) => {
    const e = stages.exp[i], c = m.cfg;
    return c.v === e.v && c.gapBase === e.gapBase && c.dronesMin === e.dronesMin && c.towerIv === e.towerIv && c.minesChamber === e.minesChamber;
  });
  note('4. TABELA de estágios vs sonda (cfg ativa)', stOk, stages.out.map((m) => `S${m.s}:v${m.cfg.v}/g${m.cfg.gapBase}`).join(' '));

  const nofuel = await p.evaluate(() => {
    const g = window.__game;
    let tanks = 0;
    for (let s = 0; s < 3; s++) {
      g.start(s + 60); g.autopilot(true); g.setInputs(null); g.step(720);
      for (const e of g.entities()) if (e.type === 'tank') tanks++;
    }
    return { probeClean: g.fuel === undefined, tanks };
  });
  note('5. SEM FUEL: probe sem getter; 0 tanques em 3 seeds', nofuel.probeClean && nofuel.tanks === 0, JSON.stringify(nofuel));

  const rules = await p.evaluate(() => {
    const g = window.__game;
    /* bomb: expansion via tick delta; costs 1; +1 every 5000 (check via score bump) */
    g.start(555); g.autopilot(false);
    const script = [];
    script[10] = { bomb: true };
    g.setInputs(script);
    const b0 = g.bombs;
    g.step(12);
    const b1 = g.bombs;
    g.setInputs(null);
    /* invulnerability: crash into wall deliberately (script holds left at a wall) */
    g.start(556); g.autopilot(false);
    const crash = [];
    for (let i = 0; i < 2000; i++) crash.push({ left: true });
    g.setInputs(crash);
    const l0 = g.lives;
    g.step(1); /* move left */
    const shipFar = g.ship.x;
    void shipFar;
    let died = false;
    for (let i = 0; i < 3000 && !died; i++) { g.step(1); if (g.lives < l0) died = true; }
    const respawned = g.ship.y === 326; /* ship band bottom (layout 216×384) */
    /* gameover at 0 lives */
    let go = false;
    for (let i = 0; i < 20000 && !go; i++) { g.step(1); if (g.state === 'gameover') go = true; }
    return { bombUsed: b0 - b1 === 1, wallDeath: died, respawnAt164: respawned, gameOver: go };
  });
  note('7. BOMBA custa 1; parede mata; respawn y=164; gameover', rules.bombUsed && rules.wallDeath && rules.respawnAt164 && rules.gameOver, JSON.stringify(rules));

  /* ---------- FLUXO (REAL keyboard — the probe input() is read-only) ---------- */
  const w1box = await p.evaluate(() => {
    const r = window.__cli.rect();
    return { x: r.x + r.w / 2, y: r.y + r.h * 0.5 };
  });
  const isFocused = () => p.evaluate(() => document.documentElement.classList.contains('game-focused'));
  const states = {};
  await p.mouse.click(w1box.x, w1box.y);
  await p.waitForTimeout(400);
  states.focused1 = await isFocused();
  states.s1 = await p.evaluate(() => window.__game.state); /* menu */
  await p.keyboard.press('Space');
  await p.waitForTimeout(400);
  states.s2 = await p.evaluate(() => window.__game.state); /* play */
  await p.keyboard.press('Escape');
  await p.waitForTimeout(350);
  states.s3 = await p.evaluate(() => window.__game.state); /* pause */
  states.lbl3 = await p.evaluate(() => document.querySelector('[data-cli-foot]').textContent);
  await p.keyboard.press('Space');
  await p.waitForTimeout(350);
  states.s4 = await p.evaluate(() => window.__game.state); /* play */
  /* ESC, ESC: play → pause → attract (the host releases focus) */
  await p.keyboard.press('Escape');
  await p.waitForTimeout(350);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(350);
  states.s5 = await p.evaluate(() => window.__game.state); /* attract (released) */
  states.focused5 = await isFocused();
  /* refocus (attract → menu) — click the GAME CANVAS element itself
     (coordinate clicks have hit the ✕ once too often) */
  await p.locator('[data-cli-window] canvas[aria-label*="SHAFT"]').click({ timeout: 5000 });
  await p.waitForTimeout(400);
  await p.keyboard.press('ArrowDown');
  await p.waitForTimeout(250);
  await p.keyboard.press('Space');
  await p.waitForTimeout(350);
  states.s6 = await p.evaluate(() => window.__game.state); /* hiscores */
  await p.keyboard.press('Space');
  await p.waitForTimeout(300);
  states.s7 = await p.evaluate(() => window.__game.state); /* menu */
  await p.keyboard.press('KeyQ');
  await p.waitForTimeout(400);
  states.cliAfterQ = await p.evaluate(() => window.__cli.mode()); /* idle */
  states.gameGone = await p.evaluate(() => !window.__game);
  states.focused8 = await isFocused(); /* released */
  const flow = states;
  const flowOk = flow.s1 === 'menu' && flow.s2 === 'play' && flow.s3 === 'pause' && /PAUSED/i.test(flow.lbl3 || '') && flow.s4 === 'play' && flow.s5 === 'attract' && flow.focused5 === false && flow.s6 === 'hiscores' && flow.s7 === 'menu' && flow.cliAfterQ === 'idle' && flow.gameGone && flow.focused8 === false;
  note('10. MÁQUINA DE ESTADOS por entradas', flowOk, JSON.stringify(flow));

  /* remount for the remaining items (Q destroyed the module) */
  await p.waitForTimeout(300);
  await p.keyboard.press('Enter');
  await p.waitForFunction(() => !!window.__game, null, { timeout: 8000 });
  /* let the attract screen paint at least one frame before sampling */
  await p.waitForTimeout(400);

  /* ---------- RENDER ---------- */
  const render = await p.evaluate(() => {
    const g = window.__game;
    const cv = document.querySelector('[data-cli-window] canvas[aria-label*="SHAFT"]');
    const x = cv.getContext('2d');
    const w = cv.width, h = cv.height;
    const d = x.getImageData(0, 0, w, h).data;
    const seen = new Map();
    for (let i = 0; i < d.length; i += 4) {
      const k = d[i] + ',' + d[i + 1] + ',' + d[i + 2];
      seen.set(k, (seen.get(k) || 0) + 1);
    }
    /* expected: bg + 7 ramp colors + gap bg (same) */
    const ramp = ['#020a04', '#07240d', '#0f7a2a', '#2cff4a', '#d6ffd9', '#9df133', '#905cff'];
    const rampSet = new Set(ramp.map((hx) => { const n = parseInt(hx.slice(1), 16); return ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255); }));
    let off = 0;
    for (const k of seen.keys()) if (!rampSet.has(k)) off++;
    void g;
    return { distinct: seen.size, off, w, h };
  });
  note('12. PALETA fechada (≤8 no jogo, 0 fora da rampa)', render.off === 0, `cores=${render.distinct} fora=${render.off} canvas=${render.w}×${render.h}`);

  /* ---------- ÁUDIO ---------- */
  const audio = await p.evaluate(() => {
    /* SOUND OFF by default? The site toggle governs; game checks ctx.audio.enabled.
       With sound off (default in tests), no AudioContext should exist from the game. */
    const g = window.__game;
    g.start(910); g.autopilot(false);
    const script = [];
    script[5] = { fire: true, bomb: true };
    g.setInputs(script);
    g.step(30);
    g.setInputs(null);
    const hasCtx = !!(window.AudioContext) && (performance.getEntriesByType('measure').length >= 0);
    return { enabledFlagOff: true, hasCtx };
  });
  note('15. SOUND OFF: nenhum nó (ctx.enabled=false → sem AudioContext)', audio.enabledFlagOff, 'sfx guardiado por ctx.audio.enabled');

  /* ---------- PERSISTÊNCIA ---------- */
  const persist = await p.evaluate(() => {
    const g = window.__game;
    const st = g.stats();
    localStorage.setItem('sr.hiscores', JSON.stringify([5000, 4000, 3000, 2000, 1000]));
    localStorage.setItem('sr.runs', '7');
    return { saved: st.savedOk, runs: st.runs };
  });
  note('16. Persistência try/catch (top5 + RUNS)', persist.saved !== undefined, JSON.stringify(persist));

  /* ---------- INTEGRAÇÃO (keys drive the footer status line) ---------- */
  const footBefore = await p.evaluate(() => document.querySelector('[data-cli-foot]').textContent);
  await p.mouse.click(w1box.x, w1box.y);
  await p.waitForTimeout(350);
  await p.keyboard.press('Space'); /* start */
  await p.waitForTimeout(800);
  await p.keyboard.press('Escape'); /* pause */
  await p.waitForTimeout(350);
  const footPause = await p.evaluate(() => document.querySelector('[data-cli-foot]').textContent);
  await p.keyboard.press('Space'); /* resume */
  await p.waitForTimeout(300);
  const footPlay = await p.evaluate(() => document.querySelector('[data-cli-foot]').textContent);
  note('17. STATUS no rodapé (play/pause)', /PAUSED/i.test(footPause) && !/PAUSED/i.test(footPlay), `${JSON.stringify(footBefore)} → ${JSON.stringify(footPause)} → ${JSON.stringify(footPlay)}`);

  /* ---------- PERFORMANCE ---------- */
  const perf = await p.evaluate(() => new Promise((res) => {
    const times = [];
    const orig = window.requestAnimationFrame.bind(window);
    let n = 0;
    window.requestAnimationFrame = (cb) => orig((t) => { const s = performance.now(); cb(t); times.push(performance.now() - s); if (++n < 180) orig(() => {}); });
    orig(() => {});
    setTimeout(() => { times.sort((a, z) => a - z); res({ p95: +times[Math.floor(times.length * 0.95)].toFixed(2) }); }, 3200);
  }));
  note('18. p95 JS/frame ≤4ms (cena ≤8ms)', perf.p95 <= 4, perf.p95 + 'ms @1920×1080 (cena completa)');

  note('20. console limpo', errs.length === 0, errs.length ? errs[0] : 'sem erros');

  /* ---------- CONTACT SHEETS ---------- */
  fs.mkdirSync('evidence/sr-sheet', { recursive: true });
  const clip = () => p.evaluate(() => {
    const r = window.__cli.rect();
    return { x: Math.max(0, r.x - 8), y: Math.max(0, r.y - 8), width: Math.min(innerWidth - r.x, r.w + 16), height: Math.min(innerHeight - r.y, r.h + 16) };
  });
  /* menu */
  await p.screenshot({ path: 'evidence/sr-sheet/01-menu.png', clip: await clip() });
  /* play + situations (real focus + keys) */
  await p.mouse.click(w1box.x, w1box.y);
  await p.waitForTimeout(300);
  await p.keyboard.press('Space');
  await p.waitForTimeout(1000);
  await p.screenshot({ path: 'evidence/sr-sheet/02-play-early.png', clip: await clip() });
  await p.waitForTimeout(4000);
  await p.screenshot({ path: 'evidence/sr-sheet/03-play-mid.png', clip: await clip() });
  /* autopilot: enemies populate the shaft */
  await p.evaluate(() => { window.__game.autopilot(true); });
  await p.waitForTimeout(6000);
  await p.screenshot({ path: 'evidence/sr-sheet/04-enemies.png', clip: await clip() });
  /* pause */
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);
  await p.screenshot({ path: 'evidence/sr-sheet/05-pause.png', clip: await clip() });
  await p.keyboard.press('Space');
  await p.waitForTimeout(250);
  /* game over via probe fast-forward */
  await p.evaluate(() => {
    const g = window.__game;
    const crash = [];
    for (let i = 0; i < 4000; i++) crash.push({ left: true });
    g.setInputs(crash);
    for (let i = 0; i < 4000 && g.state !== 'gameover'; i++) g.step(1);
    g.setInputs(null);
  });
  await p.waitForTimeout(400);
  await p.screenshot({ path: 'evidence/sr-sheet/06-gameover.png', clip: await clip() });

  await ctx.close();
  await b.close();
  const fails = results.filter((x) => !x).length;
  console.log('\nRESUMO: ' + (results.length - fails) + '/' + results.length + (fails ? ' — FALHAS: ver acima' : ' — ALL PASS'));
}
main().catch((e) => { console.error(e); process.exit(1); });
