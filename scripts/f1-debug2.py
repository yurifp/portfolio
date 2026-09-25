from playwright.sync_api import sync_playwright
import json

with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    ctx = b.new_context(reduced_motion='no-preference', viewport={'width': 1440, 'height': 900})
    pg = ctx.new_page()
    logs = []
    pg.on('console', lambda m: logs.append(f"[{m.type}] {m.text[:250]}"))
    pg.on('pageerror', lambda e: logs.append(f"[pageerror] {str(e)[:250]}"))
    pg.goto('http://localhost:4324/', wait_until='networkidle')
    pg.wait_for_timeout(1500)

    # programmatic click bypasses actionability entirely
    toggled = pg.evaluate("""() => {
      const btn = document.getElementById('settings-btn');
      btn.click();
      return document.getElementById('settings-panel').dataset.open;
    }""")
    print(json.dumps({'prog_click_dataOpen': toggled, 'console': logs}, indent=1))
    b.close()
