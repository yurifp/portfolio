/* one-off patcher: host + shell wiring for the 216×384 layout */
import fs from 'fs';

/* ---------- game-host.ts ---------- */
let h = fs.readFileSync('src/scripts/game-host.ts', 'utf8');

if (!h.includes('shaft-runner/layout')) {
  h = h.replace("import { createShaftRunner } from '../games/shaft-runner';",
    "import { createShaftRunner } from '../games/shaft-runner';\nimport { LOGICAL, calcScale } from '../games/shaft-runner/layout';");
}

h = h.replace(/function fitCanvas\(host\?: HTMLElement\) \{[\s\S]*?\n\}/, `function fitCanvas(host?: HTMLElement) {
  if (!canvas) return;
  const box = (host || canvas.parentElement)!.getBoundingClientRect();
  const dpr = Math.min(devicePixelRatio || 1, 3);
  const devW = Math.max(60, box.width * dpr), devH = Math.max(60, box.height * dpr);
  scale = calcScale(devW, devH);
  canvas.width = LOGICAL.w * scale;
  canvas.height = LOGICAL.h * scale;
  /* CSS: prefer 1:1 device pixels; cap to the box (small viewports — the
     CRT softness hides the fractional downscale) */
  const k = Math.min(1, box.width / (canvas.width / dpr), box.height / (canvas.height / dpr));
  canvas.style.width = (canvas.width / dpr) * k + 'px';
  canvas.style.height = (canvas.height / dpr) * k + 'px';
}`);

h = h.replace("    setLabel: (t: string) => { if (state === 'focused') setLabel(t); },",
  "    setLabel: (t: string) => setLabel(t),");

h = h.replace(`function setLabel(t: string) {
  if (labelEl) labelEl.textContent = t;
  if (winEl) winEl.dataset.stateText = t;
}`, `const HINTS: Record<string, string> = {
  DEMO: '<span><span class="keycap">CLICK</span> PLAY</span>',
  MENU: '<span><span class="keycap">ARROWS</span> SELECT</span> <span><span class="keycap">SPACE</span> OK</span> <span><span class="keycap">Q</span> BACK</span>',
  PLAYING: '<span><span class="keycap">LEFT-RIGHT</span> MOVE</span> <span><span class="keycap">SPACE</span> FIRE</span> <span><span class="keycap">X</span> BOMB</span> <span><span class="keycap">P</span> AUTOPILOT</span> <span><span class="keycap">ESC</span> PAUSE</span>',
  PAUSED: '<span><span class="keycap">SPACE</span> RESUME</span> <span><span class="keycap">ESC</span> EXIT</span>',
  'GAME OVER': '<span><span class="keycap">SPACE</span> RETRY</span> <span><span class="keycap">ESC</span> EXIT</span>',
};

function setLabel(t: string) {
  if (labelEl) labelEl.textContent = t;
  if (winEl) winEl.dataset.stateText = t;
  const foot = winEl?.querySelector('[data-footer]');
  if (foot && HINTS[t]) foot.innerHTML = HINTS[t];
}`);

h = h.replace("  document.addEventListener('visibilitychange', () => { if (document.hidden) releaseGame('hidden'); });",
  "  document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'focused') { module?.setMode('paused'); setLabel('PAUSED'); } });");
h = h.replace("  window.addEventListener('resize', () => { releaseGame('resize'); fitCanvas(); });",
  "  window.addEventListener('resize', () => { if (state === 'focused') { module?.setMode('paused'); setLabel('PAUSED'); } fitCanvas(); });");

h = h.replace("  module.setMode('focused');\n  setLabel('PLAYING');\n  termEmit('game focused — keyboard captured');",
  "  module.setMode('focused');\n  termEmit('game focused — keyboard captured');");
h = h.replace("  module?.setMode('attract');\n  setLabel('CLICK TO PLAY');\n  termEmit(`game released (${reason})`);",
  "  module?.setMode('attract');\n  termEmit(`game released (${reason})`);");

fs.writeFileSync('src/scripts/game-host.ts', h);

/* ---------- windows-shell.ts ---------- */
let w = fs.readFileSync('src/scripts/windows-shell.ts', 'utf8');

if (!w.includes('shaft-runner/layout')) {
  w = w.replace("import { WINDOWS, LED_EXIT_AT } from '../data/windows';",
    "import { WINDOWS, LED_EXIT_AT } from '../data/windows';\nimport { calcScale } from '../games/shaft-runner/layout';");
}

w = w.replace(/    if \(mobile && w\.id !== 'w1'\) \{ rects\.set\(w\.id, \{ left: -9999, top: 0, width: 0, height: 0 \}\); continue; \}\n    let left: number, width: number;/, `    if (mobile && w.id !== 'w1') { rects.set(w.id, { left: -9999, top: 0, width: 0, height: 0 }); continue; }
    let left: number, width: number;`);

w = w.replace(/    \} else \{\n      \/\* W1: portrait — height drives width via the 9:16 screen \*\/[\s\S]*?left = g\.vw \/ 2 - width \/ 2;\n    \}/, `    } else {
      /* W1: portrait — the canvas drives the window (integer scale first) */
      const dpr = Math.min(devicePixelRatio || 1, 3);
      const chromeH = 28 + 22;
      const availHdev = Math.max(320, (g.vh * 0.9 - chromeH)) * dpr;
      const availWdev = Math.max(320, (g.vw - 2 * g.gutter)) * dpr;
      const s = calcScale(availWdev, availHdev);
      const screenW = (216 * s) / dpr, screenH = (384 * s) / dpr;
      width = screenW + 2;
      const height = chromeH + screenH + 2;
      left = g.vw / 2 - width / 2;
      rects.set(w.id, { left, top: Math.max(40, (g.vh - height) * 0.42), width, height });
      continue;
    }`);

w = w.replace(/    const height = w\.cols && !mobile\n      \? Math\.min\(w\.maxHVh \/ 100 \* g\.vh, g\.vh - \(w\.topVh \/ 100 \* g\.vh\) - \(8 \/ 100 \* g\.vh\)\)\n      : 0;\n    if \(w\.id !== 'w1'\) rects\.set\(w\.id, \{ left, top: w\.topVh \/ 100 \* g\.vh, width, height \}\);/, `    const height = w.cols && !mobile
      ? Math.min(w.maxHVh / 100 * g.vh, g.vh - (w.topVh / 100 * g.vh) - (8 / 100 * g.vh))
      : 0;
    if (w.id !== 'w1') rects.set(w.id, { left, top: w.topVh / 100 * g.vh, width, height });`);

fs.writeFileSync('src/scripts/windows-shell.ts', w);
console.log('host + shell patched');
