from playwright.sync_api import sync_playwright
import os

html = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'evidence', 'fonts', 'compare.html'))
with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    pg = b.new_page(viewport={'width': 1240, 'height': 1250})
    pg.goto('file:///' + html.replace('\\', '/'))
    pg.wait_for_timeout(2500)
    pg.screenshot(path=os.path.join(os.path.dirname(html), 'compare.png'), full_page=True)
    b.close()
print('ok')
