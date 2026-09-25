from playwright.sync_api import sync_playwright
import json, os

EV = os.path.join(os.path.dirname(__file__), '..', 'evidence')
URL = 'http://localhost:4330/'

FPS_JS = """async () => {
  return await new Promise(res => {
    let frames = 0; const t0 = performance.now();
    const loop = () => { frames++; if (performance.now() - t0 < 2000) requestAnimationFrame(loop); else res(Math.round(frames / 2)); };
    requestAnimationFrame(loop);
  });
}"""

with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    out = {}

    # ── 1. animated desktop: beats + FPS + stations ──────────────────────
    ctx = b.new_context(reduced_motion='no-preference', viewport={'width': 1440, 'height': 900})
    pg = ctx.new_page()
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)[:200]))
    pg.on('console', lambda m: errs.append(m.text[:200]) if m.type == 'error' else None)
    pg.goto(URL, wait_until='networkidle')
    pg.wait_for_timeout(2500)
    out['fps_beat1_idle'] = pg.evaluate(FPS_JS)
    info1 = pg.evaluate("() => ({ points: document.querySelector('#gl-host canvas') ? 'canvas-ok' : 'NO-CANVAS', counter: document.querySelector('[data-story-count]')?.textContent })")
    pg.screenshot(path=os.path.join(EV, 'f4-beat1.png'))
    # scroll to station 2 (arc) ~ p=0.5
    for _ in range(12): pg.mouse.wheel(0, 500); pg.wait_for_timeout(80)
    pg.wait_for_timeout(900)
    pg.screenshot(path=os.path.join(EV, 'f4-beat3-arc.png'))
    out['fps_mid'] = pg.evaluate(FPS_JS)
    # to the end (grid)
    for _ in range(14): pg.mouse.wheel(0, 600); pg.wait_for_timeout(70)
    pg.wait_for_timeout(900)
    pg.screenshot(path=os.path.join(EV, 'f4-beat5-grid.png'))
    out['desktop'] = {**info1, 'counter_end': pg.evaluate("document.querySelector('[data-story-count]')?.textContent"), 'pageerrors': errs}
    ctx.close()

    # ── 2. quality switch → rebuild density ─────────────────────────────
    ctx2 = b.new_context(reduced_motion='no-preference', viewport={'width': 1440, 'height': 900})
    pg2 = ctx2.new_page()
    pg2.goto(URL, wait_until='networkidle')
    pg2.wait_for_timeout(1800)
    high = pg2.evaluate("document.querySelector('#gl-host canvas').width")
    pg2.click('#settings-btn'); pg2.wait_for_timeout(300)
    pg2.click('.opt[data-quality="medium"]'); pg2.wait_for_timeout(900)
    med = pg2.evaluate("document.querySelector('#gl-host canvas').width")
    pg2.click('.opt[data-quality="low"]'); pg2.wait_for_timeout(900)
    low = pg2.evaluate("document.querySelector('#gl-host canvas').width")
    out['quality_canvas_widths'] = {'high(1440 vp)': high, 'medium': med, 'low': low}
    ctx2.close()

    # ── 3. WebGL disabled → fallback ────────────────────────────────────
    b2 = p.chromium.launch(headless=True, args=['--disable-webgl', '--disable-webgl2'])
    ctx3 = b2.new_context(reduced_motion='no-preference', viewport={'width': 1440, 'height': 900})
    pg3 = ctx3.new_page()
    errs3 = []
    pg3.on('pageerror', lambda e: errs3.append(str(e)[:150]))
    pg3.goto(URL, wait_until='networkidle')
    pg3.wait_for_timeout(1500)
    out['no_webgl'] = {
        'canvas_in_host': pg3.evaluate("document.querySelector('#gl-host canvas') !== null"),
        'counter': pg3.evaluate("document.querySelector('[data-story-count]')?.textContent"),
        'errors': errs3,
    }
    pg3.screenshot(path=os.path.join(EV, 'f4-no-webgl.png'))
    b2.close()

    # ── 4. mobile real viewport ─────────────────────────────────────────
    ctx4 = b.new_context(reduced_motion='no-preference', viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True, device_scale_factor=2)
    pg4 = ctx4.new_page()
    errs4 = []
    pg4.on('pageerror', lambda e: errs4.append(str(e)[:150]))
    pg4.goto(URL, wait_until='networkidle')
    pg4.wait_for_timeout(2200)
    pg4.screenshot(path=os.path.join(EV, 'f4-mobile-beat1.png'))
    for _ in range(8): pg4.touchscreen.tap(195, 400); pg4.mouse.wheel(0, 600); pg4.wait_for_timeout(90)
    pg4.wait_for_timeout(800)
    pg4.screenshot(path=os.path.join(EV, 'f4-mobile-mid.png'))
    out['mobile'] = {'counter': pg4.evaluate("document.querySelector('[data-story-count]')?.textContent"), 'errors': errs4}
    ctx4.close()
    b.close()

print(json.dumps(out, indent=1))
