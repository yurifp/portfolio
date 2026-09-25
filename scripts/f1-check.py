from playwright.sync_api import sync_playwright
import json, os

OUT = os.path.join(os.path.dirname(__file__), '..', 'evidence', 'f1.png')
with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    ctx = b.new_context(reduced_motion='no-preference', viewport={'width': 1440, 'height': 900})
    pg = ctx.new_page()
    logs = []
    pg.on('console', lambda m: logs.append({'type': m.type, 'text': m.text}))
    pg.on('pageerror', lambda e: logs.append({'type': 'pageerror', 'text': str(e)}))
    pg.goto('http://localhost:4324/', wait_until='networkidle')
    pg.wait_for_timeout(1800)

    fonts = pg.evaluate("""async () => {
      await document.fonts.ready;
      return [...new Set([...document.fonts].filter(f => f.status === 'loaded').map(f => f.family))];
    }""")

    # open panel → pick low → verify persistence + aria state
    pg.click('#settings-btn')
    pg.wait_for_timeout(400)
    panel_open = pg.get_attribute('#settings-panel', 'data-open')
    pg.click('.opt[data-quality="low"]')
    pg.wait_for_timeout(200)
    low_pressed = pg.get_attribute('.opt[data-quality="low"]', 'aria-pressed')
    stored = pg.evaluate("localStorage.getItem('portfolio:quality')")
    pg.click('#settings-btn')
    pg.wait_for_timeout(300)
    panel_closed = pg.get_attribute('#settings-panel', 'data-open')

    dom = pg.evaluate("""() => ({
      rail: !!document.getElementById('scroll-rail-fill'),
      glHost: !!document.getElementById('gl-host'),
      h1Font: getComputedStyle(document.querySelector('h1')).fontFamily.slice(0, 60),
    })""")
    pg.screenshot(path=OUT)
    print(json.dumps({
        'fonts': fonts, 'panel_open': panel_open, 'low_pressed': low_pressed,
        'stored': stored, 'panel_closed': panel_closed, 'dom': dom,
        'console_errors': [l for l in logs if l['type'] in ('error', 'pageerror')],
    }, indent=1))
    b.close()
