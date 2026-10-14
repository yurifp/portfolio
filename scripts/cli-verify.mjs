/* YF.CLI acceptance suite — node scripts/cli-verify.mjs [baseURL]
   Covers: shell lifecycle (open/boot/idle/drag/fullscreen/close), boot
   skip + session, sound proxy, game mount/keys/pause/Q, HUD lint (the
   old layout-verify core), hidden-tab pause, reduced-motion, mobile. */
import { chromium } from 'playwright';

const URL = process.argv[2] || 'http://127.0.0.1:4322/';
const results = [];
const note = (id, pass, detail) => { results.push(!!pass); console.log((pass ? 'PASS' : 'FAIL') + ' ' + id + (detail ? ' — ' + detail : '')); };

const openAndBoot = async (p) => {
  await p.waitForFunction(() => !document.querySelector('.preloader'), null, { timeout: 12000 });
  await p.locator('[data-cli-btn]').click();
  await p.waitForTimeout(2400); /* boot (cold) or straight idle (warm) */
};

async function main() {
  const b = await chromium.launch({ headless: false });

  /* ===== desktop shell ===== */
  {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(String(e).slice(0, 140)));
    p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 140)); });
    await p.goto(URL, { waitUntil: 'networkidle' });

    await openAndBoot(p);
    const mode1 = await p.evaluate(() => window.__cli.mode());
    note('1. BOOT → IDLE (cold session)', mode1 === 'idle' || mode1 === 'boot', 'mode=' + mode1);
    if (mode1 === 'boot') {
      await p.waitForTimeout(1800);
      note('2. BOOT termina sozinho', (await p.evaluate(() => window.__cli.mode())) === 'idle');
    } else {
      results.push(true); /* warm session: boot skipped counts as pass */
      console.log('PASS 2. BOOT pulado (sessão quente)');
    }

    /* drag stays inside the viewport */
    const r0 = await p.evaluate(() => window.__cli.rect());
    await p.mouse.move(r0.x + r0.w / 2, r0.y + 12);
    await p.mouse.down();
    await p.mouse.move(60, 400, { steps: 10 });
    await p.mouse.up();
    await p.waitForTimeout(200);
    const r1 = await p.evaluate(() => window.__cli.rect());
    note('3. ARRASTE move e fica na viewport', r1.x !== r0.x && r1.x >= 0 && r1.y >= 0, `${r0.x},${r0.y} → ${r1.x},${r1.y}`);

    /* fullscreen in/out */
    await p.locator('[data-cli-fs]').click();
    await p.waitForTimeout(400);
    const fsOn = await p.evaluate(() => window.__cli.fs() && window.__cli.rect().w > 1000);
    await p.locator('[data-cli-fs]').click();
    await p.waitForTimeout(300);
    note('4. FULLSCREEN entra/sai', fsOn && !(await p.evaluate(() => window.__cli.fs())));

    /* sound proxy — one source of truth */
    await p.locator('[data-cli-snd]').click();
    await p.waitForTimeout(250);
    const snd = await p.evaluate(() => ({
      site: document.querySelector('[data-sound-btn]').getAttribute('aria-checked'),
      bars: document.querySelector('[data-cli-snd]').classList.contains('is-on'),
    }));
    await p.locator('[data-cli-snd]').click();
    await p.waitForTimeout(200);
    note('5. SND espelha o toggle do site', snd.site === 'true' && snd.bars, JSON.stringify(snd));

    /* game mount + focus + kbd badge */
    await p.keyboard.press('Enter');
    await p.waitForFunction(() => !!window.__game, null, { timeout: 8000 });
    const r = await p.evaluate(() => window.__cli.rect());
    await p.mouse.click(r.x + r.w / 2, r.y + r.h * 0.5);
    await p.waitForTimeout(300);
    const focus = await p.evaluate(() => ({
      kbd: !document.querySelector('[data-cli-kbd]').hidden,
      gf: document.documentElement.classList.contains('game-focused'),
      rect: window.__cli.rect(),
      inVp: (() => { const w = window.__cli.rect(); return w.y >= 0 && w.y + w.h <= innerHeight + 2; })(),
    }));
    note('6. FOCO do jogo: badge KBD + janela dentro da viewport', focus.kbd && focus.gf && focus.inVp, JSON.stringify(focus));

    /* HUD lint (from the old layout-verify): bands + no overlaps */
    const lint = await p.evaluate(() => {
      const hb = window.__game.hudBoxes();
      const boxes = hb.boxes;
      const inter = (a, c) => a.x < c.x + c.w && c.x < a.x + a.w && a.y < c.y + c.h && c.y < a.y + a.h;
      const problems = [];
      for (const bx of boxes) if (bx.x < 0 || bx.y < 0 || bx.x + bx.w > hb.W || bx.y + bx.h > hb.H) problems.push('fora: ' + bx.n);
      const byBand = { top: [], bot: [] };
      for (const bx of boxes) if (byBand[bx.band]) byBand[bx.band].push(bx);
      for (const band of ['top', 'bot']) {
        const arr = byBand[band];
        for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) if (inter(arr[i], arr[j])) problems.push(band + ' overlap: ' + arr[i].n + '×' + arr[j].n);
      }
      return { problems, n: boxes.length };
    });
    note('7. HUD LINT (bandas, 0 sobreposições)', lint.problems.length === 0, `${lint.n} caixas — ${lint.problems.length ? lint.problems[0] : 'ok'}`);

    /* hidden tab → pause + input cleared */
    await p.keyboard.press('Space');
    await p.waitForTimeout(500);
    await p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
    await p.waitForTimeout(300);
    const hid = await p.evaluate(() => ({ foot: document.querySelector('[data-cli-foot]').textContent }));
    await p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
    await p.waitForTimeout(200);
    note('8. ABA OCULTA pausa', /RESUME/i.test(hid.foot), JSON.stringify(hid.foot));

    /* Q → back to idle, game destroyed, focus released */
    await p.keyboard.press('KeyQ');
    await p.waitForTimeout(500);
    const back = await p.evaluate(() => ({ mode: window.__cli.mode(), game: !window.__game, gf: document.documentElement.classList.contains('game-focused') }));
    note('9. Q volta ao CLI e destrói o jogo', back.mode === 'idle' && back.game && !back.gf, JSON.stringify(back));

    /* hero leaves → window auto-closes */
    await p.evaluate(() => scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * 0.25));
    await p.waitForTimeout(600);
    const away = await p.evaluate(() => ({ mode: window.__cli.mode(), hidden: document.querySelector('[data-cli-window]').hidden }));
    note('10. Sair da hero fecha a janela', away.mode === 'closed' && away.hidden, JSON.stringify(away));

    /* warm reload: no boot replay */
    await p.evaluate(() => scrollTo(0, 0));
    await p.reload({ waitUntil: 'networkidle' });
    await openAndBoot(p);
    note('11. Reload quente pula o boot', (await p.evaluate(() => window.__cli.mode())) === 'idle');

    /* close via the ✕ (window already open from item 11) + aria */
    await p.locator('[data-cli-close]').click();
    await p.waitForTimeout(500);
    note('12. CLOSE esconde e reseta o botão', (await p.evaluate(() => window.__cli.mode())) === 'closed' && (await p.locator('[data-cli-btn]').getAttribute('aria-expanded')) === 'false');

    note('13. console limpo', errs.length === 0, errs.length ? errs[0] : 'sem erros');
    await ctx.close();
  }

  /* ===== reduced motion ===== */
  {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const p = await ctx.newPage();
    await p.goto(URL, { waitUntil: 'networkidle' });
    await openAndBoot(p);
    note('14. REDUCED MOTION: sem boot longo', (await p.evaluate(() => window.__cli.mode())) === 'idle');
    await p.locator('[data-cli-close]').click().catch(() => {});
    await ctx.close();
  }

  /* ===== mobile 390 ===== */
  {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(String(e).slice(0, 120)));
    await p.goto(URL, { waitUntil: 'networkidle' });
    await openAndBoot(p);
    await p.keyboard.press('Enter');
    await p.waitForFunction(() => !!window.__game, null, { timeout: 8000 });
    const mob = await p.evaluate(() => {
      const w = window.__cli.rect();
      const strip = document.querySelector('.cli-touch');
      return { w, inVp: w.x >= 0 && w.x + w.w <= innerWidth, strip: strip ? strip.children.length : 0 };
    });
    note('15. MOBILE 390: janela na viewport + faixa de toque', mob.inVp && mob.strip >= 4, JSON.stringify({ w: mob.w.w, strip: mob.strip }));
    note('16. MOBILE console limpo', errs.length === 0, errs.length ? errs[0] : 'sem erros');
    await ctx.close();
  }

  await b.close();
  const fails = results.filter((x) => !x).length;
  console.log('\nRESUMO: ' + (results.length - fails) + '/' + results.length + (fails ? ' — FALHAS: ver acima' : ' — ALL PASS'));
}
main().catch((e) => { console.error(e); process.exit(1); });
