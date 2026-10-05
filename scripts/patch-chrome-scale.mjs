/* one-off: fixed chrome + scale ownership (shell sets dataset.scale) */
import fs from 'fs';

let c = fs.readFileSync('src/styles/global.css', 'utf8');
c = c.replace('    min-height: 28px;\n  }\n  .win-handle {', '    height: 28px;\n    overflow: hidden;\n    flex: none;\n  }\n  .win-handle {');
c = c.replace('    min-height: 28px;\n    align-items: center;\n  }\n  .keycap {', '    height: 24px;\n    overflow: hidden;\n    flex-wrap: nowrap;\n    white-space: nowrap;\n    align-items: center;\n    flex: none;\n  }\n  .keycap {');
fs.writeFileSync('src/styles/global.css', c);

let w = fs.readFileSync('src/scripts/windows-shell.ts', 'utf8');
const wStart = w.indexOf('    } else {\n      /* W1: portrait');
if (wStart >= 0) {
  const wEnd = w.indexOf('continue;\n    }', wStart);
  w = w.slice(0, wStart) + `    } else {
      /* W1: portrait — fixed chrome (titlebar 28 + hints 24); the scale
         comes from the height budget; the canvas then fills the screen
         1:1 device (fitCanvas reads root.dataset.scale) */
      const dpr = Math.min(devicePixelRatio || 1, 3);
      const s = calcScale(216 * 20, Math.max(320, g.vh * 0.9 - 52) * dpr);
      const screenW = (216 * s) / dpr, screenH = (384 * s) / dpr;
      width = screenW + 2;
      const height = 52 + screenH + 2;
      left = g.vw / 2 - width / 2;
      rects.set(w.id, { left, top: Math.max(40, (g.vh - height) * 0.42), width, height });
      els.get(w.id)!.root.dataset.scale = String(s);
      continue;
    }` + w.slice(wEnd + 'continue;\n    }'.length);
} else {
  throw new Error('W1 branch not found');
}
fs.writeFileSync('src/scripts/windows-shell.ts', w);

let h = fs.readFileSync('src/scripts/game-host.ts', 'utf8');
const hStart = h.indexOf('function fitCanvas(host?: HTMLElement) {');
const hEnd = h.indexOf('\n}\n', hStart);
h = h.slice(0, hStart) + `function fitCanvas(host?: HTMLElement) {
  if (!canvas) return;
  const dpr = Math.min(devicePixelRatio || 1, 3);
  if (host) {
    /* focus overlay: scale from the overlay box itself */
    const box = host.getBoundingClientRect();
    scale = calcScale(box.width * dpr, box.height * dpr);
  } else if (winEl?.dataset.scale) {
    scale = parseInt(winEl.dataset.scale, 10); /* the shell owns W1 scale */
  } else {
    const box = canvas.parentElement!.getBoundingClientRect();
    scale = calcScale(box.width * dpr, box.height * dpr);
  }
  canvas.width = LOGICAL.w * scale;
  canvas.height = LOGICAL.h * scale;
  canvas.style.width = canvas.width / dpr + 'px';
  canvas.style.height = canvas.height / dpr + 'px';
}` + h.slice(hEnd);
fs.writeFileSync('src/scripts/game-host.ts', h);
console.log('chrome fixed + scale ownership applied');
