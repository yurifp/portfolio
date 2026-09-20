from playwright.sync_api import sync_playwright
import json

with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    ctx = b.new_context(reduced_motion='no-preference', viewport={'width': 1440, 'height': 900})
    pg = ctx.new_page()
    pg.goto('http://localhost:4324/', wait_until='networkidle')
    pg.wait_for_timeout(1500)
    pg.click('#settings-btn')
    pg.wait_for_timeout(600)
    info = pg.evaluate("""() => {
      const panel = document.getElementById('settings-panel');
      const opt = panel.querySelector('.opt[data-quality="low"]');
      const r = opt.getBoundingClientRect();
      const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
      const topEl = document.elementFromPoint(cx, cy);
      return {
        dataOpen: panel.dataset.open,
        panelPe: getComputedStyle(panel).pointerEvents,
        panelZ: getComputedStyle(panel).zIndex,
        optRect: { x: Math.round(cx), y: Math.round(cy) },
        topElement: topEl ? topEl.tagName + '.' + (topEl.className || '').toString().slice(0, 40) : null,
        topIsInsidePanel: !!(topEl && panel.contains(topEl)),
      };
    }""")
    print(json.dumps(info, indent=1))
    b.close()
