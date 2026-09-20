"""Raw-evidence collector for the hero mesh on production.
Two browser contexts (animated / reduced-motion), console captured,
canvas pixel-counted, animation detected by frame diff, amber repulsion
sampled around the cursor. Prints JSON to stdout. No assertions hidden.
"""
import json
import os
from playwright.sync_api import sync_playwright

URL = 'https://yurifp-portfolio.vercel.app/'
OUT = os.path.join(os.path.dirname(__file__), '..', 'evidence')
os.makedirs(OUT, exist_ok=True)

PIXEL_SAMPLE = """() => {
  const c = document.querySelector('section#top canvas');
  if (!c) return null;
  const ctx = c.getContext('2d');
  const img = ctx.getImageData(0, 0, c.width, c.height).data;
  let painted = 0;
  const stride = [];
  for (let i = 3; i < img.length; i += 4) {
    if (img[i] > 0) painted++;
    if (i % 397 === 3) stride.push(img[i]);
  }
  return {
    size: c.width + 'x' + c.height,
    paintedPixels: painted,
    inDOM: document.contains(c),
    insideIsland: !!c.closest('astro-island'),
    strideAlpha: stride.join(','),
  };
}"""

AMBER_NEAR = """(x, y) => {
  const c = document.querySelector('section#top canvas');
  const ctx = c.getContext('2d');
  const r = 160;
  const x0 = Math.max(0, x - r), y0 = Math.max(0, y - r);
  const img = ctx.getImageData(x0, y0, Math.min(r * 2, c.width - x0), Math.min(r * 2, c.height - y0)).data;
  let amber = 0;
  for (let i = 0; i < img.length; i += 4) {
    const R = img[i], G = img[i + 1], B = img[i + 2], A = img[i + 3];
    if (A > 120 && R > 190 && G > 130 && G < 215 && B < 120) amber++;
  }
  return amber;
}"""


def collect_console(page, sink):
    page.on('console', lambda m: sink.append({'type': m.type, 'text': m.text[:300]}))
    page.on('pageerror', lambda e: sink.append({'type': 'pageerror', 'text': str(e)[:300]}))


def main():
    out = {}
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)

        # ── Context 1: motion allowed (the "normal visitor") ──────────────
        ctx = browser.new_context(
            reduced_motion='no-preference', viewport={'width': 1440, 'height': 900})
        page = ctx.new_page()
        logs = []
        collect_console(page, logs)
        page.goto(URL, wait_until='networkidle')
        page.wait_for_timeout(1500)
        initial = page.evaluate(PIXEL_SAMPLE)
        sample_a = initial['strideAlpha']
        page.wait_for_timeout(600)  # no mouse: twinkle alone should change pixels
        after_twinkle = page.evaluate(PIXEL_SAMPLE)
        sample_b = after_twinkle['strideAlpha']
        page.mouse.move(1100, 430)
        page.wait_for_timeout(140)
        page.mouse.move(1130, 445)
        page.wait_for_timeout(300)
        amber = page.evaluate("""(pt) => {
          const c = document.querySelector('section#top canvas');
          const ctx = c.getContext('2d');
          const r = 160;
          const x0 = Math.max(0, pt.x - r), y0 = Math.max(0, pt.y - r);
          const img = ctx.getImageData(x0, y0, Math.min(r * 2, c.width - x0), Math.min(r * 2, c.height - y0)).data;
          let amber = 0;
          for (let i = 0; i < img.length; i += 4) {
            const R = img[i], G = img[i + 1], B = img[i + 2], A = img[i + 3];
            if (A > 120 && R > 190 && G > 130 && G < 215 && B < 120) amber++;
          }
          return amber;
        }""", {'x': 1115, 'y': 438})
        page.screenshot(path=os.path.join(OUT, 'prod_animated_cursor.png'),
                        clip={'x': 700, 'y': 0, 'width': 740, 'height': 620})
        out['animated_context'] = {
            'canvas': initial,
            'frames_change_over_time_without_mouse': sample_a != sample_b,
            'amber_pixels_near_cursor_after_move': amber,
            'console': logs,
        }
        ctx.close()

        # ── Context 2: prefers-reduced-motion: reduce ─────────────────────
        ctx = browser.new_context(
            reduced_motion='reduce', viewport={'width': 1440, 'height': 900})
        page = ctx.new_page()
        logs = []
        collect_console(page, logs)
        page.goto(URL, wait_until='networkidle')
        page.wait_for_timeout(1500)
        first = page.evaluate(PIXEL_SAMPLE)
        page.wait_for_timeout(1200)
        second = page.evaluate(PIXEL_SAMPLE)
        page.screenshot(path=os.path.join(OUT, 'prod_reduced_static.png'),
                        clip={'x': 0, 'y': 0, 'width': 1440, 'height': 620})
        out['reduced_context'] = {
            'canvas': first,
            'static_frame_identical_over_1200ms': first['strideAlpha'] == second['strideAlpha'],
            'console': logs,
        }
        ctx.close()
        browser.close()

    print(json.dumps(out, indent=1))


if __name__ == '__main__':
    main()
