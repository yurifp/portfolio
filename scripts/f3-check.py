from playwright.sync_api import sync_playwright
import json, os

EV = os.path.join(os.path.dirname(__file__), '..', 'evidence')
with sync_playwright() as p:
    b = p.chromium.launch(headless=True)

    # ── animated context ────────────────────────────────────────────────
    ctx = b.new_context(reduced_motion='no-preference', viewport={'width': 1440, 'height': 900})
    pg = ctx.new_page()
    logs = []
    pg.on('console', lambda m: logs.append({'type': m.type, 'text': m.text[:200]}) if m.type == 'error' else None)
    pg.on('pageerror', lambda e: logs.append({'type': 'pageerror', 'text': str(e)[:200]}))
    pg.goto('http://localhost:4327/', wait_until='networkidle')
    pg.wait_for_timeout(2200)  # fonts + first maskLines

    def state():
        return pg.evaluate("""() => {
          const beats = [...document.querySelectorAll('.story-beat')];
          const story = document.querySelector('[data-story]');
          const counter = document.querySelector('[data-story-count]');
          const bg = document.querySelector('[data-story-bg]');
          return {
            counter: counter ? counter.textContent : null,
            storyH: story ? Math.round(story.getBoundingClientRect().height) : 0,
            stageSticky: document.querySelector('.story-stage') ? getComputedStyle(document.querySelector('.story-stage')).position : null,
            visible: beats.map((el, i) => ({ i, o: Math.round(parseFloat(el.style.opacity || '1') * 100) / 100 })).filter(x => x.o > 0.05),
            bg: bg ? bg.style.backgroundColor : null,
            titleFont: (() => { const t = document.querySelector('[data-story-title]'); return t ? getComputedStyle(t).fontFamily.slice(0, 40) : null; })(),
            maskLines: document.querySelectorAll('.mask-line-inner, [class*="mask-line"]').length,
          };
        }""")

    s1 = state()
    pg.screenshot(path=os.path.join(EV, 'f3-beat1.png'))
    # scroll deep into beat 3 (~55% of story)
    for _ in range(14):
        pg.mouse.wheel(0, 500)
        pg.wait_for_timeout(90)
    pg.wait_for_timeout(700)
    s2 = state()
    pg.screenshot(path=os.path.join(EV, 'f3-beat3.png'))
    # near the end
    for _ in range(10):
        pg.mouse.wheel(0, 500)
        pg.wait_for_timeout(90)
    pg.wait_for_timeout(700)
    s3 = state()
    pg.screenshot(path=os.path.join(EV, 'f3-beat5.png'))
    print(json.dumps({'beat1': s1, 'beat3': s2, 'beat5': s3, 'console_errors': logs}, indent=1))
    ctx.close()

    # ── reduced-motion context ──────────────────────────────────────────
    ctx2 = b.new_context(reduced_motion='reduce', viewport={'width': 1440, 'height': 900})
    pg2 = ctx2.new_page()
    logs2 = []
    pg2.on('pageerror', lambda e: logs2.append(str(e)[:200]))
    pg2.goto('http://localhost:4327/', wait_until='networkidle')
    pg2.wait_for_timeout(1200)
    r = pg2.evaluate("""() => {
      const beats = [...document.querySelectorAll('.story-beat')];
      const story = document.querySelector('[data-story]');
      return {
        storyH: Math.round(story.getBoundingClientRect().height),
        allVisible: beats.every(el => el.offsetHeight > 100 && getComputedStyle(el).position !== 'absolute'),
        total: beats.length,
      };
    }""")
    pg2.screenshot(path=os.path.join(EV, 'f3-reduced.png'))
    print(json.dumps({'reduced': r, 'pageerrors': logs2}, indent=1))
    b.close()
