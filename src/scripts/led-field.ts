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

/* ---------- hold-to-charge / release-to-burst ----------
   Left-button hold anywhere in the hero charges (radius shrinks,
   density concentrates under the pointer); release expels particles
   radially through the SAME heat field — they decay, fade and die
   like the mouse trail. Zero new rAF loops, zero new colors. */
const MAX_HOLD_MS = 1400;        /* hold time for full charge */
const MIN_HOLD_MS = 140;         /* shorter release = plain click */
const MIN_RADIUS_FACTOR = 0.45;  /* brush shrinks to 45% at full charge */
const BURST_DURATION_MS = 900;   /* particle lifetime ceiling */
const BURST_REACH_MAX = 1.0;     /* charge=1 reaches the farthest corner */
const DAMPING = 4.2;             /* exponential velocity loss (per s) */
const BURST_POOL = 1400;         /* fixed particle pool — no per-frame alloc */
const REDUCED_BURST_SCALE = 0.3; /* prefers-reduced-motion reach/speed cut */

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

/* ---------- charge state ---------- */
let holding = false;
let holdStart = 0;
let holdCharge = 0;      /* eased 0..1 */
let radiusFactor = 1;    /* 1 = base brush; shrinks while holding */
let holdMinRadius = 1;   /* stats: smallest factor seen in this hold */

/* ---------- particle pool (structure of arrays, swap-remove) ---------- */
const P_X = new Float32Array(BURST_POOL);
const P_Y = new Float32Array(BURST_POOL);
const P_VX = new Float32Array(BURST_POOL);
const P_VY = new Float32Array(BURST_POOL);
const P_BORN = new Float32Array(BURST_POOL);
const P_LIFE = new Float32Array(BURST_POOL);
const P_BRIGHT = new Float32Array(BURST_POOL);
let pActive = 0;
let recycleSlot = 0;
const burstOrigin = { x: 0, y: 0 };
let burstMaxDist = 0; /* stats: farthest live particle from origin (px) */

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
  burst: () => ({
    holding,
    charge: +holdCharge.toFixed(3),
    radiusFactor: +radiusFactor.toFixed(3),
    holdMinRadius: +holdMinRadius.toFixed(3),
    particles: pActive,
    maxDist: Math.round(burstMaxDist),
    resting: !holding && pActive === 0 && radiusFactor >= 0.999,
  }),
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
  pActive = 0; /* stale host-local coords after a resize */
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
function brushR() {
  const hr = host!.getBoundingClientRect();
  return Math.max(56, Math.min(140, Math.min(hr.width, hr.height) * 0.10)) * LED_SCALE * radiusFactor;
}
function stamp(cx: number, cy: number) {
  if (!host) return;
  const hr = host.getBoundingClientRect();
  const lx = cx - hr.left, ly = cy - hr.top;
  const R = brushR();
  const r = Math.ceil(R / cell);
  const ci = Math.round(lx / cell), cj = Math.round(ly / cell);
  /* the falloff knee tightens with charge: pixels concentrate
     towards the pointer while holding (identical at charge 0) */
  const knee = 0.35 + 0.4 * (holding ? holdCharge : 0);
  for (let j = cj - r; j <= cj + r; j++) {
    for (let i = ci - r; i <= ci + r; i++) {
      if (i < 0 || i >= cols || j < 0 || j >= rows) continue;
      const dx = (i * cell - lx), dy = (j * cell - ly);
      const d = Math.sqrt(dx * dx + dy * dy) / R;
      if (d > 1) continue;
      const p = d < knee ? 1 : 1 - (d - knee) / (1 - knee);
      const idx = j * cols + i;
      if (p > heat[idx]) heat[idx] = p;
    }
  }
}

function stampSegment(x0: number, y0: number, x1: number, y1: number) {
  const dist = Math.hypot(x1 - x0, y1 - y0);
  const R = brushR();
  const steps = Math.max(1, Math.ceil(dist / (R * 0.2)));
  for (let s = 0; s <= steps; s++) {
    stamp(x0 + (x1 - x0) * (s / steps), y0 + (y1 - y0) * (s / steps));
  }
}

/* single-cell heat stamp — particles write through the same field */
function stampHeatAt(x: number, y: number, v: number) {
  const i = Math.round(x / cell), j = Math.round(y / cell);
  if (i < 0 || i >= cols || j < 0 || j >= rows) return;
  const idx = j * cols + i;
  if (v > heat[idx]) heat[idx] = v;
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

  /* charge: eased fill while holding, elastic return after release */
  if (holding) {
    const t = Math.min(1, Math.max(0, (now - holdStart) / MAX_HOLD_MS));
    const e = 1 - Math.pow(1 - t, 3); /* easeOutCubic */
    holdCharge = e;
    radiusFactor = 1 - e * (1 - MIN_RADIUS_FACTOR);
    if (radiusFactor < holdMinRadius) holdMinRadius = radiusFactor;
  } else if (radiusFactor < 1) {
    radiusFactor += (1 - radiusFactor) * (1 - Math.exp(-dt * 7));
    if (radiusFactor > 0.999) radiusFactor = 1;
  }

  /* particles: damp, move, stamp heat, fade */
  if (pActive > 0) updateParticles(now, dt);

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

  if (hasHeat || torchOn || holding || pActive > 0 || radiusFactor < 1) {
    if (dissolve < 1) paintLight();
    raf = requestAnimationFrame(tick);
  }
  /* no heat + no torch + no charge = rAF stops; zero CPU */
}

/* ---------- burst particles ---------- */
function updateParticles(now: number, dt: number) {
  const hr = host!.getBoundingClientRect();
  const damp = Math.exp(-dt * DAMPING);
  let maxd = 0;
  for (let k = pActive - 1; k >= 0; k--) {
    P_VX[k] *= damp;
    P_VY[k] *= damp;
    P_X[k] += P_VX[k] * dt;
    P_Y[k] += P_VY[k] * dt;
    const t = (now - P_BORN[k]) / P_LIFE[k];
    if (t >= 1 || P_X[k] < -8 || P_Y[k] < -8 || P_X[k] > hr.width + 8 || P_Y[k] > hr.height + 8) {
      /* swap-remove: pool stays dense, zero allocation */
      pActive--;
      P_X[k] = P_X[pActive]; P_Y[k] = P_Y[pActive];
      P_VX[k] = P_VX[pActive]; P_VY[k] = P_VY[pActive];
      P_BORN[k] = P_BORN[pActive]; P_LIFE[k] = P_LIFE[pActive];
      P_BRIGHT[k] = P_BRIGHT[pActive];
      continue;
    }
    const fade = (1 - t) * (1 - t); /* ease-out: fast leave, soft death */
    stampHeatAt(P_X[k], P_Y[k], P_BRIGHT[k] * fade * 0.85);
    const dx = P_X[k] - burstOrigin.x, dy = P_Y[k] - burstOrigin.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > maxd) maxd = d;
  }
  if (maxd > burstMaxDist) burstMaxDist = maxd;
}

function burst(now: number) {
  const hr = host!.getBoundingClientRect();
  const ox = lastMouse.x - hr.left, oy = lastMouse.y - hr.top;
  burstOrigin.x = ox;
  burstOrigin.y = oy;
  burstMaxDist = 0;
  /* reach: with exponential damping, travel = v0 / DAMPING */
  const corners = [[0, 0], [hr.width, 0], [0, hr.height], [hr.width, hr.height]];
  let far = 0;
  for (const c of corners) far = Math.max(far, Math.hypot(c[0] - ox, c[1] - oy));
  const reach = far * BURST_REACH_MAX * (0.3 + 0.7 * holdCharge);
  const v0 = reach * DAMPING * (reduced ? REDUCED_BURST_SCALE : 1);
  const count = Math.round((reduced ? 0.5 : 1) * (140 + 760 * holdCharge));
  const life = BURST_DURATION_MS * (reduced ? 0.6 : 1);
  for (let n = 0; n < count; n++) {
    /* pool exhausted (rapid re-clicks): recycle round-robin, never grow */
    const k = pActive < BURST_POOL ? pActive++ : recycleSlot++ % BURST_POOL;
    const a = Math.random() * Math.PI * 2;
    const spd = v0 * (0.55 + 0.45 * Math.random());
    P_X[k] = ox; P_Y[k] = oy;
    P_VX[k] = Math.cos(a) * spd;
    P_VY[k] = Math.sin(a) * spd;
    P_BORN[k] = now;
    P_LIFE[k] = life * (0.6 + 0.4 * Math.random());
    P_BRIGHT[k] = 0.5 + 0.5 * Math.random();
  }
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

/* ---------- hold-to-charge input ---------- */
const INTERACTIVE = 'a, button, input, textarea, select, label, [role="button"], [role="switch"]';

function kickRAF() {
  if (!raf) { lastFrame = performance.now(); raf = requestAnimationFrame(tick); }
}

function onDown(e: PointerEvent) {
  if (disposed || dissolve >= 1) return;
  if (e.button !== 0 || !e.isPrimary) return;
  const t = e.target as Element | null;
  if (t && t.closest(INTERACTIVE)) return;
  if (!host) return;
  /* geometric containment, not DOM: the hero's own subtree is
     pointer-transparent (hit-test lands on .flip-stage), so a DOM
     contains() test would reject every hold */
  const hr = host.getBoundingClientRect();
  if (e.clientX < hr.left || e.clientX > hr.right || e.clientY < hr.top || e.clientY > hr.bottom) return;
  holding = true;
  holdStart = performance.now();
  holdCharge = 0;
  holdMinRadius = 1;
  lastMouse = { x: e.clientX, y: e.clientY };
  torchOn = true;
  document.documentElement.classList.add('is-holding');
  kickRAF();
}

function release() {
  if (!holding) return;
  holding = false;
  const heldMs = performance.now() - holdStart;
  if (heldMs >= MIN_HOLD_MS && dissolve < 1) burst(performance.now());
  holdCharge = 0; /* radiusFactor eases back inside tick */
  document.documentElement.classList.remove('is-holding');
}

function onUp() { release(); }
function onWinBlur() { release(); }
function onVisibility() { if (document.hidden) release(); }
function cancelHold() { /* dissolve/destroy path: quiet, no burst */
  if (!holding) return;
  holding = false;
  holdCharge = 0;
  document.documentElement.classList.remove('is-holding');
}

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
      cancelHold();
      pActive = 0;
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
  /* hold-to-charge: down filtered to the hero + non-interactive targets;
     up/cancel/blur on window so the state can never stick */
  addEventListener('pointerdown', onDown);
  addEventListener('pointerup', onUp);
  addEventListener('pointercancel', onUp);
  addEventListener('blur', onWinBlur);
  document.addEventListener('visibilitychange', onVisibility);
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
      cancelHold();
      pActive = 0;
      removeEventListener('pointermove', onMove);
      document.removeEventListener('mouseleave', onLeave);
      removeEventListener('resize', rebuild);
      removeEventListener('pointerdown', onDown);
      removeEventListener('pointerup', onUp);
      removeEventListener('pointercancel', onUp);
      removeEventListener('blur', onWinBlur);
      document.removeEventListener('visibilitychange', onVisibility);
      wrapper.remove();
    },
    setProgress: onScrollDissolve,
  };
}
