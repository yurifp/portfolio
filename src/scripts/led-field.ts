/*
  LED FIELD — the hero background as a matrix of square cells.
  Two canvases at CELL resolution (1 buffer px = 1 cell), scaled up
  via CSS image-rendering: pixelated. No circles, no arcs, no blur.

  BASE (static): ordered dither of low-frequency noise + vertical
  bias. Painted once; zero CPU at rest.

  LIGHT (dynamic): heat field H per cell. Mouse stamps a max-blend
  brush; exponential decay τ=380ms. Cells light when H > Bayer8
  threshold. A lit cell REPLACES the base bit.

  Dissolve: at 9-12% scroll, smoothstep raises the threshold and
  multiplies heat. At 12% everything is off, canvas hidden, rAF dead.
*/

/* ---------- scale: ONE number to tune the whole comet ---------- */
const LED_SCALE = 0.5; /* halves brush radius AND trail lifetime */

/* ---------- Bayer 8×8 (same matrix as the portrait) ---------- */
const BAYER = [
  [0, 32, 8, 40, 2, 34, 10, 42],
  [48, 16, 56, 24, 50, 18, 58, 26],
  [12, 44, 4, 36, 14, 46, 6, 38],
  [60, 28, 52, 20, 62, 30, 54, 22],
  [3, 35, 11, 43, 1, 33, 9, 41],
  [51, 19, 59, 27, 49, 17, 57, 25],
  [15, 47, 7, 39, 13, 45, 5, 37],
  [63, 31, 55, 23, 61, 29, 53, 21],
].map((r) => r.map((v) => (v + 0.5) / 64));

/* ---------- deterministic value noise (3 octaves, fixed seed) ---------- */
function hash(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7 + 42.0) * 43758.5453;
  return s - Math.floor(s);
}
function vnoise(x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm3(x: number, y: number): number {
  let f = 0, amp = 0.5;
  for (let o = 0; o < 3; o++) { f += amp * vnoise(x, y); x *= 2.3; y *= 2.3; amp *= 0.5; }
  return f;
}

/* ---------- module state ---------- */
let baseCv: HTMLCanvasElement | null = null;
let lightCv: HTMLCanvasElement | null = null;
let host: HTMLElement | null = null;
let cols = 0, rows = 0, cell = 4;
let heat: Float32Array = new Float32Array(0);
let baseDensity: Float32Array = new Float32Array(0);
let raf = 0;
let lastFrame = 0;
let lastMouse = { x: -9999, y: -9999 };
let torchOn = false;
let dissolve = 0; /* 0 = fully visible, 1 = fully dissolved */
let disposed = false;
let reduced = false;
let flood = false;

/* colors (resolved once) */
const COLS = { bg: [7, 2, 16], bit: [35, 28, 52], on: [157, 241, 51] };

/* probe */
(window as unknown as { __led?: Record<string, unknown> }).__led = {
  get cell() { return cell; },
  get cols() { return cols; },
  get rows() { return rows; },
  litCount: () => { let n = 0; for (let i = 0; i < heat.length; i++) if (heat[i] > 0.03) n++; return n; },
  heatAt: (x: number, y: number) => heat[Math.floor(y / cell) * cols + Math.floor(x / cell)] ?? 0,
  baseHash: () => { let h = 0; for (let i = 0; i < baseDensity.length; i++) h = (h * 31 + baseDensity[i] * 255) | 0; return h; },
};

/* ---------- rebuild grid ---------- */
function rebuild() {
  if (!host || disposed) return;
  const r = host.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) { requestAnimationFrame(rebuild); return; }
  const dpr = Math.min(devicePixelRatio || 1, 2);
  cell = Math.max(3, Math.min(6, Math.round(4 * (dpr > 1 ? 1 : 1))));
  cols = Math.ceil(r.width / cell);
  rows = Math.ceil(r.height / cell);
  for (const cv of [baseCv, lightCv]) {
    if (!cv) continue;
    cv.width = cols;
    cv.height = rows;
    cv.style.width = cols * cell + 'px';
    cv.style.height = rows * cell + 'px';
  }
  heat = new Float32Array(cols * rows);
  baseDensity = new Float32Array(cols * rows);
  /* static density: fbm3 noise + vertical bias, 0.05-0.30 */
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const n = fbm3(i / 48 + 7, j / 48 + 3);
      const bias = 0.04 * (j / rows); /* slightly denser at bottom */
      baseDensity[j * cols + i] = 0.05 + n * 0.25 + bias;
    }
  }
  paintBase();
  paintLight();
}

/* ---------- BASE painting (static dither) ---------- */
function paintBase() {
  if (!baseCv) return;
  const ctx = baseCv.getContext('2d');
  if (!ctx) return;
  const img = ctx.createImageData(cols, rows);
  const d = img.data;
  const dens = 1 - dissolve; /* dissolve reduces density */
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const idx = j * cols + i;
      const base = baseDensity[idx] * dens;
      const on = base > BAYER[j & 7][i & 7];
      const p = idx * 4;
      if (on) { d[p] = COLS.bit[0]; d[p + 1] = COLS.bit[1]; d[p + 2] = COLS.bit[2]; }
      else { d[p] = COLS.bg[0]; d[p + 1] = COLS.bg[1]; d[p + 2] = COLS.bg[2]; }
      d[p + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/* ---------- LIGHT painting (heat dither, replaces base bits) ---------- */
function paintLight() {
  if (!lightCv || !baseCv) return;
  const ctx = lightCv.getContext('2d');
  if (!ctx) return;
  const img = ctx.createImageData(cols, rows);
  const d = img.data;
  const dMul = 1 - dissolve;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const idx = j * cols + i;
      const h = heat[idx] * dMul;
      const p = idx * 4;
      if (h > 0.03) {
        const L = Math.pow(Math.min(1, h), 0.85);
        const lit = L > BAYER[j & 7][i & 7];
        if (lit) {
          d[p] = COLS.on[0]; d[p + 1] = COLS.on[1]; d[p + 2] = COLS.on[2];
        } else {
          d[p] = COLS.bg[0]; d[p + 1] = COLS.bg[1]; d[p + 2] = COLS.bg[2];
        }
      } else {
        d[p] = COLS.bg[0]; d[p + 1] = COLS.bg[1]; d[p + 2] = COLS.bg[2];
      }
      d[p + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/* ---------- brush stamping ---------- */
function stamp(cx: number, cy: number) {
  if (!host) return;
  const hr = host.getBoundingClientRect();
  const lx = cx - hr.left, ly = cy - hr.top;
  const R = Math.max(56, Math.min(140, Math.min(hr.width, hr.height) * 0.10)) * LED_SCALE;
  const r = Math.ceil(R / cell);
  const ci = Math.round(lx / cell), cj = Math.round(ly / cell);
  for (let j = cj - r; j <= cj + r; j++) {
    for (let i = ci - r; i <= ci + r; i++) {
      if (i < 0 || i >= cols || j < 0 || j >= rows) continue;
      const dx = (i * cell - lx), dy = (j * cell - ly);
      const d = Math.sqrt(dx * dx + dy * dy) / R;
      if (d > 1) continue;
      const p = d < 0.35 ? 1 : 1 - (d - 0.35) / 0.65;
      const idx = j * cols + i;
      if (p > heat[idx]) heat[idx] = p;
    }
  }
}

function stampSegment(x0: number, y0: number, x1: number, y1: number) {
  const dist = Math.hypot(x1 - x0, y1 - y0);
  const hr = host!.getBoundingClientRect();
  const R = Math.max(56, Math.min(140, Math.min(hr.width, hr.height) * 0.10)) * LED_SCALE;
  const steps = Math.max(1, Math.ceil(dist / (R * 0.2)));
  for (let s = 0; s <= steps; s++) {
    stamp(x0 + (x1 - x0) * (s / steps), y0 + (y1 - y0) * (s / steps));
  }
}

/* ---------- animation loop ---------- */
function tick(now: number) {
  raf = 0;
  if (disposed || !host) return;
  const dt = Math.min((now - lastFrame) / 1000, 0.05);
  lastFrame = now;

  /* torch: stamp at current position */
  if (torchOn && dissolve < 1) {
    stamp(lastMouse.x, lastMouse.y);
  }

  /* decay */
  const tau = (reduced ? 0.12 : 0.38) * LED_SCALE;
  const decay = Math.exp(-dt / tau);
  let hasHeat = false;
  for (let i = 0; i < heat.length; i++) {
    if (heat[i] > 0) {
      heat[i] *= decay;
      if (heat[i] < 0.03) heat[i] = 0;
      else hasHeat = true;
    }
  }

  if (hasHeat || torchOn) {
    if (dissolve < 1) paintLight();
    raf = requestAnimationFrame(tick);
  }
  /* no heat + no torch = rAF stops; zero CPU */
}

/* ---------- input ---------- */
function onMove(e: PointerEvent) {
  if (disposed || dissolve >= 1) return;
  torchOn = true;
  if (lastMouse.x > -999) stampSegment(lastMouse.x, lastMouse.y, e.clientX, e.clientY);
  else stamp(e.clientX, e.clientY);
  lastMouse = { x: e.clientX, y: e.clientY };
  if (!raf) { lastFrame = performance.now(); raf = requestAnimationFrame(tick); }
}
function onLeave() { torchOn = false; }

/* ---------- scroll dissolve ---------- */
let scrollRAF = 0;
function onScrollDissolve(progress: number) {
  if (scrollRAF || disposed) return;
  scrollRAF = requestAnimationFrame(() => {
    scrollRAF = 0;
    const p = Math.min(1, Math.max(0, (progress - 0.09) / 0.03));
    const s = p * p * (3 - 2 * p); /* smoothstep */
    if (Math.abs(s - dissolve) < 0.005 && s !== 0 && s !== 1) return;
    dissolve = s;
    paintBase();
    if (s >= 1) {
      /* fully dissolved: hide, stop everything */
      if (baseCv) baseCv.style.visibility = 'hidden';
      if (lightCv) lightCv.style.visibility = 'hidden';
      torchOn = false;
      heat.fill(0);
      paintLight();
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
    } else {
      if (baseCv) baseCv.style.visibility = 'visible';
      if (lightCv) lightCv.style.visibility = 'visible';
      paintLight();
    }
  });
}

/* ---------- mount ---------- */
export function mountLEDField(container: HTMLElement) {
  host = container;
  disposed = false;
  reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* resolve ?led=mint and ?led=flood */
  const url = new URL(location.href);
  if (url.searchParams.get('led') === 'mint') {
    COLS.on = [158, 255, 201];
  }
  if (url.searchParams.get('led') === 'flood') {
    flood = true;
  }

  /* create canvases */
  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:var(--z-ghost,1);overflow:hidden;';
  wrapper.setAttribute('aria-hidden', 'true');

  baseCv = document.createElement('canvas');
  baseCv.style.cssText = 'position:absolute;top:0;left:0;image-rendering:pixelated;image-rendering:crisp-edges;';
  lightCv = document.createElement('canvas');
  lightCv.style.cssText = 'position:absolute;top:0;left:0;image-rendering:pixelated;image-rendering:crisp-edges;';
  wrapper.appendChild(baseCv);
  wrapper.appendChild(lightCv);
  host.prepend(wrapper);

  /* ?led=gap overlay */
  if (url.searchParams.get('led') === 'gap') {
    const gap = document.createElement('div');
    gap.style.cssText = `position:absolute;inset:0;pointer-events:none;background-image:repeating-linear-gradient(0deg,transparent 0,transparent ${4 - 1}px,var(--color-void,#070210) ${4 - 1}px,var(--color-void,#070210) 4px),repeating-linear-gradient(90deg,transparent 0,transparent ${4 - 1}px,var(--color-void,#070210) ${4 - 1}px,var(--color-void,#070210) 4px);`;
    wrapper.appendChild(gap);
  }

  rebuild();
  /* ?led=flood: H=0.6 everywhere, no decay, no torch — uniformity proof */
  if (flood) {
    heat.fill(0.6);
    paintLight();
  }
  addEventListener('pointermove', onMove, { passive: true });
  document.addEventListener('mouseleave', onLeave);
  addEventListener('resize', rebuild);
  document.fonts?.ready.then(() => { paintBase(); });

  /* ?led=demo: deterministic gesture */
  if (url.searchParams.get('led') === 'demo') {
    setTimeout(() => {
      const hr = host!.getBoundingClientRect();
      const pts: Array<[number, number]> = [];
      const t0 = performance.now();
      const dur = 900;
      const anim = () => {
        const t = (performance.now() - t0) / dur;
        if (t > 1.3) return;
        if (t <= 1) {
          const x = hr.left + hr.width * (0.05 + 0.8 * t);
          const y = hr.top + hr.height * (0.4 + 0.15 * Math.sin(t * Math.PI));
          if (lastMouse.x > -999) stampSegment(lastMouse.x, lastMouse.y, x, y);
          else stamp(x, y);
          lastMouse = { x, y };
        } else { torchOn = true; }
        if (!raf) { lastFrame = performance.now(); raf = requestAnimationFrame(tick); }
        if (t <= 1.3) requestAnimationFrame(anim);
      };
      anim();
    }, 500);
  }

  return {
    destroy() {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      removeEventListener('pointermove', onMove);
      document.removeEventListener('mouseleave', onLeave);
      removeEventListener('resize', rebuild);
      wrapper.remove();
    },
    setProgress: onScrollDissolve,
  };
}
