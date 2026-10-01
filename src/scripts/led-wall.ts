/*
  LED PANEL — the board, driven by ONE energy field.

  The approved plate stays (integer grid, solid cells, gap, closed
  palette, scroll layers, dirty-cell repaint). The RAIN MOTOR was
  rewritten as an analytic, stateless, per-column model so threads read
  as rain — vertical filaments with continuous motion — while the
  organic field is demoted to a subtle, vertically-stretched ambient
  that lights up as rain passes:

    E_total = 1 - (1 - E_amb)(1 - E_rain)        soft sum, one buffer
    E_amb   = anisotropic noise (ambient, subtle) + κ·ρ rain glow
    E_rain  = per-column threads: continuous head h, phosphor trail,
              spill to neighbours, embers, sparkle; curtains via
              low-frequency 1D noise over columns; breathing density;
              rare comets. All pure functions of (seed, t_rain).
    level   = 12-level LUT with a soft quantization band (temporal)

  Time: t_rain accumulates dt × multiplier (never t × speed), so speed
  changes and scroll coupling never jump phases; hidden tabs resume
  without a snap. Reduced motion: 30% speed, no comets, no coupling.
*/

/* ---------- seed & driver ---------- */
const SEED = 0x9e37;
const TICK_MS = 33.3;
const MAX_CATCHUP = 5;
const RAIN_DT_CAP_MS = 50;

/* ---------- grid (unchanged from the approved board) ---------- */
const COLUMNS_PER_WIDTH = 17;
const COLUMNS_MIN = 36;
const COLUMNS_MAX = 120;

/* ---------- ambient: subtle, stretched, slow ---------- */
const FIELD_SCALE = 0.22;
const AMBIENT_ANISO = 9;         /* vertical stretch ≥ 8:1 — never balls */
const AMBIENT_DRIFT = 0.45;      /* cells/s downward, slow */
const OCTAVES = 3;
const OCTAVE_GAINS = [0.62, 0.24, 0.14];
const THRESH = [0.455, 0.555, 0.645, 0.725, 0.80];
const HYST = 0.03;
const AMBIENT_LEVEL = 0.22;      /* E ceiling — the field is a garnish now */
const MAP12 = [0, 2, 4, 7, 9, 11];
/* rain-glow feedback */
const KAPPA = 0.50;
const RHO_BOX_X = 3;
const RHO_BOX_Y = 4;
const RHO_NORM = 12;

/* ---------- rain: 3 depth layers (speed cells/s, tail cells, column
   share of RAINING columns, brightness) ---------- */
const RAIN_LAYERS = [
  { vMin: 6, vMax: 9, tailMin: 6, tailMax: 10, share: 0.52, bright: 0.30 },   /* far  */
  { vMin: 10, vMax: 16, tailMin: 10, tailMax: 18, share: 0.28, bright: 0.60 },/* mid  */
  { vMin: 18, vMax: 28, tailMin: 14, tailMax: 30, share: 0.22, bright: 1.0 }, /* near */
];
const LIVE_COLUMNS = 1.25;       /* cycle-liveness probability scale, calibrated: ~54% of columns on-screen */
const V_COL_JITTER = 0.15;       /* ±15% speed per column */
/* curtains */
const BAND_WIDTH_RANGE = [2, 6];
const BAND_COHERENCE = 0.78;
const SPILL = 0.22;              /* light leak to each side column */
const ANTICIPATE = 0.10;         /* faint light 1 cell ahead of the head */
/* LED persistence */
const DECAY_SHAPE = 1.15;        /* phosphor curve bend */
const EMBER_FRAC = 0.16;         /* trail cells that retain longer */
const EMBER_BRIGHT = 0.32;
const EMBER_TAIL = 1.7;          /* × tail reach of embers */
const SPARKLE_RATE = 6;          /* Hz */
const SPARKLE_AMP = 0.06;        /* ±6%, fading towards the tip */
/* rhythm */
const BREATH_PERIOD_S = 18;      /* slow global density breathing */
const BREATH_DEPTH = 0.35;
const COMET_INTERVAL_S = [5, 9];
const COMET_SPEED = 34;          /* cells/s */
const COMET_TAIL_FRAC = 0.85;    /* of rows */
/* scroll coupling */
const SCROLL_SPEED_COUPLING = 0.35;
const SPEED_SMOOTHING_MS = 400;

/* ---------- LUT ---------- */
const GAMMA = 1.6;
const N_LEVELS = 12;
const SOFT_BAND = 0.4;           /* 40% quantization blend band (temporal) */

/* ---------- scroll layers (unchanged windows) ---------- */
const WAVE_JITTER = 3;
const SWEEP_JITTER = 4;

/* ---------- palette: 12 levels, OKLCH H 142.5-142.8, literal ---------- */
const RAMP_GREEN = ['#020602', '#020f02', '#011e01', '#023502', '#034e04', '#036806', '#038409', '#02a00b', '#00be0e', '#12dc1b', '#72f16d', '#c9fbc4'];
const RAMP_LIME = ['#081301', '#122401', '#1d3502', '#2b4b02', '#3a6202', '#4a7a02', '#5c9204', '#6fa906', '#84c109', '#9cd90f', '#bbe03f', '#dcffa8'];
const COLOR_BG = '#070210';
const COLOR_LIME = '#9df133';

/* ---------- gap ---------- */
const GAP_RATIO = 0.06;

/* deterministic PRNG (mulberry32) + lattice hashes */
function mulberry32(a: number) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash2(x: number, y: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + SEED;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function hash3(x: number, y: number, z: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 2246822519) + SEED;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/* anisotropic ambient field: features are 9× taller than wide */
function field(ix: number, iy: number, tSec: number): number {
  const dy = tSec * AMBIENT_DRIFT;
  let f = 0, fx = ix * FIELD_SCALE, fy = (iy + dy) * FIELD_SCALE / AMBIENT_ANISO;
  for (let o = 0; o < OCTAVES; o++) {
    const xi = Math.floor(fx), yi = Math.floor(fy);
    const xf = fx - xi, yf = fy - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash2(xi, yi), b2 = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
    f += OCTAVE_GAINS[o] * (a + (b2 - a) * u + (c - a) * v + (a - b2 - c + d) * u * v);
    fx *= 2.13; fy *= 2.13;
  }
  return f / 0.985;
}
/* slow 1D noise (curtains over columns, breathing over time) */
function noise1(x: number): number {
  const xi = Math.floor(x), xf = x - xi;
  const u = xf * xf * (3 - 2 * xf);
  return hash2(xi, 101) * (1 - u) + hash2(xi + 1, 101) * u;
}
function quantize(I: number, prev: number): number {
  let lv = 0;
  while (lv < 5 && I > THRESH[lv]) lv++;
  if (lv > prev && I < THRESH[prev] + HYST && prev < 5) lv = prev;
  else if (lv < prev && I > THRESH[Math.max(0, prev - 1)] - HYST) lv = prev;
  return lv;
}
const lutE = (E: number) => Math.min(11, Math.max(0, 11 * Math.pow(Math.max(0, E), 1 / GAMMA)));

/* per-column thread parameters — deterministic, built once per resize */
interface Thread {
  col: number; cls: number;
  v: number;        /* cells/s of t_rain */
  tail: number;     /* cells */
  cycleLen: number; /* cells = rows + tail + gap */
  T: number;        /* seconds per cycle */
  phase: number;    /* seconds */
  gap: number;
}

export interface LedWallHandle {
  setIgnite(p: number): void;
  setSweep(p: number): void;
  setActive(on: boolean): void;
  setTier(t: number): void;
  histogram(): number[];
  destroy(): void;
}

let wall: LedWallHandle | null = null;
export function activeWall(): LedWallHandle | null { return wall; }

export function mountLedWall(canvas: HTMLCanvasElement): LedWallHandle {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const params = new URL(location.href).searchParams;
  const mode = params.get('panel') || '';
  const useLimeRamp = params.get('ramp') === 'lime';
  const bloomOn = params.get('bloom') !== '0';
  const feedOn = params.get('feed') !== '0';
  const freezeT = params.get('t');

  const RAMP = (useLimeRamp ? RAMP_LIME : RAMP_GREEN).map((h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]);
  const BG = [7, 2, 16];
  const LIME = [parseInt(COLOR_LIME.slice(1, 3), 16), parseInt(COLOR_LIME.slice(3, 5), 16), parseInt(COLOR_LIME.slice(5, 7), 16)];

  const ctx = canvas.getContext('2d', { alpha: true })!;
  let ignite = 1, sweep = 0;
  let filmActive = false, ioVisible = true, hidden = document.hidden;
  let disposed = false, raf = 0;
  let drawCount = 0;

  let cssW = 1, cssH = 1, cellDev = 17, gapDev = 1, cols = 0, rows = 0;
  let level = new Uint8Array(0);
  let quant = new Uint8Array(0);
  let prevQuant = new Uint8Array(0);
  let baseLv = new Uint8Array(0);
  let Eamb = new Float32Array(0);
  let Erain = new Float32Array(0);
  let Etot = new Float32Array(0);
  let rhoBuf = new Float32Array(0);
  let rhoTmp = new Float32Array(0);
  let rainMask = new Uint8Array(0);
  let painted = new Uint8Array(0);
  let scratch = new Uint8Array(0);
  const countTab = new Uint32Array(6);

  /* rain time + coupling */
  let tRain = 2.6;                 /* warm-up: threads already mid-flight */
  let t0 = performance.now();
  let speedMult = reduced ? 0.3 : 1;
  let lastScrollY = window.scrollY;
  let lastCoupleCheck = 0;

  /* threads (one per column, cycling) */
  let threads: Thread[] = [];
  let bandOf: number[] = [];

  function metrics() {
    const rect = canvas.getBoundingClientRect();
    cssW = Math.max(1, rect.width); cssH = Math.max(1, rect.height);
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const cssCell = cssW / Math.min(COLUMNS_MAX, Math.max(COLUMNS_MIN, Math.round(cssW / COLUMNS_PER_WIDTH)));
    cellDev = Math.max(3, Math.round(cssCell * dpr));
    gapDev = mode === 'nogap' ? 0 : Math.max(1, Math.round(cellDev * GAP_RATIO));
    const W = Math.round(cssW * dpr), H = Math.round(cssH * dpr);
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    cols = Math.ceil(W / cellDev);
    rows = Math.ceil(H / cellDev);
    const n = cols * rows;
    level = new Uint8Array(n); quant = new Uint8Array(n); prevQuant = new Uint8Array(n); baseLv = new Uint8Array(n);
    Eamb = new Float32Array(n); Erain = new Float32Array(n); Etot = new Float32Array(n);
    rhoBuf = new Float32Array(n); rhoTmp = new Float32Array(n); rainMask = new Uint8Array(n);
    painted = new Uint8Array(n); scratch = new Uint8Array(n);
    buildThreads();
    ctx.imageSmoothingEnabled = false;
  }

  /* deterministic curtains: bands of 2-6 columns share a correlated phase */
  function buildThreads() {
    threads = [];
    bandOf = new Array(cols).fill(0);
    const rndBand = mulberry32(SEED ^ 0x5eed);
    let col = 0, band = 0;
    while (col < cols) {
      const w = BAND_WIDTH_RANGE[0] + Math.floor(rndBand() * (BAND_WIDTH_RANGE[1] - BAND_WIDTH_RANGE[0] + 1));
      const bandPhase = rndBand() * 4096;
      for (let k = 0; k < w && col < cols; k++, col++) {
        bandOf[col] = band;
        const r1 = hash2(col, 71), r2 = hash2(col, 72), r3 = hash2(col, 73), r4 = hash2(col, 74);
        let acc = 0, cls = 0;
        for (; cls < 2; cls++) { acc += RAIN_LAYERS[cls].share; if (r1 < acc) break; }
        const L = RAIN_LAYERS[cls];
        let v = (L.vMin + (L.vMax - L.vMin) * r2) * (1 - V_COL_JITTER + 2 * V_COL_JITTER * r3);
        v = Math.max(L.vMin * (1 - V_COL_JITTER), Math.min(L.vMax * (1 + V_COL_JITTER), v));
        const tail = L.tailMin + (L.tailMax - L.tailMin) * r4;
        const gap = tail * (0.15 + 0.35 * hash2(col, 75));
        const cycleLen = rows + tail + gap;
        const T = cycleLen / v;
        /* band-correlated phase + small per-column jitter */
        const phase = bandPhase + (hash2(col, 76) - 0.5) * (1 - BAND_COHERENCE) * T;
        threads.push({ col, cls, v, tail, cycleLen, T, phase, gap });
      }
      band++;
    }
  }

  /* breathing: slow global density (deterministic in t_rain) */
  const breath = (t: number) => 1 - BREATH_DEPTH * 0.5 + BREATH_DEPTH * 0.5 * noise1(t / BREATH_PERIOD_S);

  /* comet schedule: birth every 5-9s (deterministic), never two at once */
  function cometAt(t: number): { col: number; t0: number } | null {
    if (reduced) return null;
    let t0 = 3 + hash2(1, 91) * 6;
    for (let i = 0; i < 512 && t0 <= t; i++) {
      const tail = rows * COMET_TAIL_FRAC;
      const dur = (rows + tail) / COMET_SPEED;
      if (t >= t0 && t <= t0 + dur) {
        return { col: Math.floor(hash2(i + 7, 92) * cols), t0 };
      }
      t0 += COMET_INTERVAL_S[0] + hash2(i + 3, 93) * (COMET_INTERVAL_S[1] - COMET_INTERVAL_S[0]);
    }
    return null;
  }

  /* ambient: today's blob pipeline (anisotropic), mapped into E */
  function computeAmbient(tickN: number) {
    const tSec = tRain;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        baseLv[i] = quantize(field(c, r, tSec), baseLv[i]);
      }
    }
    /* mode pass + Lipschitz (as approved) */
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const counts = countTab;
        counts[0] = counts[1] = counts[2] = counts[3] = counts[4] = counts[5] = 0;
        for (let dr = -1; dr <= 1; dr++) {
          const rr = r + dr;
          if (rr < 0 || rr >= rows) continue;
          for (let dc = -1; dc <= 1; dc++) {
            const cc = c + dc;
            if (cc < 0 || cc >= cols) continue;
            counts[baseLv[rr * cols + cc]]++;
          }
        }
        let best = baseLv[r * cols + c], bestN = -1;
        for (let k = 0; k < 6; k++) if (counts[k] > bestN) { bestN = counts[k]; best = k; }
        scratch[r * cols + c] = best;
      }
    }
    baseLv.set(scratch);
    for (let round = 0; round < 1; round++) {
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        let lo = 0, hi = 5;
        if (r > 0) { const v = baseLv[i - cols]; if (v - 1 > lo) lo = v - 1; if (v + 1 < hi) hi = v + 1; }
        if (c > 0) { const v = baseLv[i - 1]; if (v - 1 > lo) lo = v - 1; if (v + 1 < hi) hi = v + 1; }
        if (baseLv[i] < lo) baseLv[i] = lo;
        if (baseLv[i] > hi) baseLv[i] = hi;
      }
      for (let r = rows - 1; r >= 0; r--) for (let c = cols - 1; c >= 0; c--) {
        const i = r * cols + c;
        let lo = 0, hi = 5;
        if (r < rows - 1) { const v = baseLv[i + cols]; if (v - 1 > lo) lo = v - 1; if (v + 1 < hi) hi = v + 1; }
        if (c < cols - 1) { const v = baseLv[i + 1]; if (v - 1 > lo) lo = v - 1; if (v + 1 < hi) hi = v + 1; }
        if (baseLv[i] < lo) baseLv[i] = lo;
        if (baseLv[i] > hi) baseLv[i] = hi;
      }
    }
    for (let i = 0; i < baseLv.length; i++) {
      Eamb[i] = Math.min(AMBIENT_LEVEL, Math.pow(MAP12[baseLv[i]] / 11, GAMMA));
    }
  }

  /* RAIN — analytic per column; continuous head, phosphor trail, spill,
     embers, sparkle, curtains, breathing, comets. Pure in t_rain. */
  /* cycle liveness: decided at the cycle's birth (head above screen),
     breathing-modulated — p = LIVE_COLUMNS × layer share × breath */
  function threadVisibleAt(th: Thread, t: number): boolean {
    const k = Math.floor((t + th.phase) / th.T);
    const birthT = k * th.T - th.phase;
    const p = LIVE_COLUMNS * RAIN_LAYERS[th.cls].share * breath(birthT);
    return hash3(th.col, k, 123) < p;
  }

  function stampThread(col: number, h: number, v: number, tail: number, bright: number, hotCore: boolean, t: number) {
    const top = Math.max(0, Math.floor(h - tail * EMBER_TAIL));
    const bot = Math.min(rows - 1, Math.floor(h) + 1);
    const sparkleSlot = Math.floor(t * SPARKLE_RATE);
    for (let r = bot; r >= top; r--) {
      const d = h - r; /* continuous distance behind the head (≥0), or <0 ahead */
      let e = 0;
      if (d >= 0 && d <= tail) {
        const u = d / tail;
        e = bright * Math.pow(1 - u, DECAY_SHAPE) * Math.exp(-u * 0.8);
        if (d < 1) {
          /* the head cell: sharp attack; only the near layer burns hot */
          e = hotCore ? 1.0 : bright;
        }
        /* sparkle: ±SPARKLE_AMP, decaying probability towards the tip */
        const sp = hash3(col, r, sparkleSlot);
        if (sp < 0.5) e *= 1 + SPARKLE_AMP * 2 * (sp / 0.5 - 0.5) * (1 - u);
      } else if (d < 0 && d >= -1) {
        e = bright * ANTICIPATE; /* faint anticipation ahead of the head */
      } else if (d > tail && d <= tail * EMBER_TAIL) {
        /* embers: sparse cells that retain a little longer */
        if (hash2(col, r * 31 + 7) < EMBER_FRAC) e = bright * EMBER_BRIGHT * Math.pow(1 - (d - tail) / (tail * (EMBER_TAIL - 1) + 0.001), 2);
      }
      if (e <= 0.004) continue;
      const i = r * cols + col;
      if (e > Erain[i]) Erain[i] = e;
      /* spill: the thread's light gives 2-3 columns of body */
      if (d >= -1 && d <= tail) {
        for (const dc of [-1, 1]) {
          const cc = col + dc;
          if (cc < 0 || cc >= cols) continue;
          const j = r * cols + cc;
          const es = e * SPILL;
          if (es > Erain[j]) Erain[j] = es;
        }
      }
    }
  }

  function computeRain(t: number) {
    Erain.fill(0);
    for (const th of threads) {
      if (!threadVisibleAt(th, t)) continue;
      const h = ((t + th.phase) % th.T + th.T) % th.T / th.T * th.cycleLen - th.tail;
      if (h < -th.tail * EMBER_TAIL || h > rows + 2) continue;
      stampThread(th.col, h, th.v, th.tail, RAIN_LAYERS[th.cls].bright, th.cls === 2, t);
    }
    const comet = cometAt(t);
    if (comet) {
      const tail = rows * COMET_TAIL_FRAC;
      const dur = (rows + tail) / COMET_SPEED;
      const h = (t - comet.t0) / dur * (rows + tail) - tail;
      if (h >= -tail && h <= rows + 2) stampThread(comet.col, h, COMET_SPEED, tail, 1.0, true, t);
    }
  }

  /* ρ: separable box sum of the rain mask */
  function computeRho() {
    for (let i = 0; i < Erain.length; i++) rainMask[i] = Erain[i] > 0.2 ? 1 : 0;
    for (let r = 0; r < rows; r++) {
      let s = 0;
      const row = r * cols;
      for (let c = 0; c < cols; c++) {
        s += rainMask[row + c];
        if (c > RHO_BOX_X * 2) s -= rainMask[row + c - (RHO_BOX_X * 2 + 1)];
        rhoTmp[row + c] = s;
      }
    }
    for (let c = 0; c < cols; c++) {
      let s = 0;
      for (let r = 0; r < rows; r++) {
        s += rhoTmp[r * cols + c];
        if (r > RHO_BOX_Y * 2) s -= rhoTmp[(r - (RHO_BOX_Y * 2 + 1)) * cols + c];
        rhoBuf[r * cols + c] = Math.min(1, s / RHO_NORM);
      }
    }
  }

  /* the ONE pipeline: E_total -> soft-quantized LUT -> bloom */
  function computeLevels() {
    const withBase = mode !== 'drops' && mode !== 'grid' && mode !== 'ramp';
    const withRain = mode !== 'base' && mode !== 'grid' && mode !== 'ramp';
    if (withBase && ambientDirty) { computeAmbient(0); ambientDirty = false; }
    if (!withBase) Eamb.fill(0);
    if (withRain) computeRain(tRain); else Erain.fill(0);
    if (withRain && withBase && feedOn) computeRho(); else rhoBuf.fill(0);
    for (let i = 0; i < Etot.length; i++) {
      const ea = feedOn && Erain[i] <= 0.2 ? Math.min(1, Eamb[i] + KAPPA * rhoBuf[i]) : Eamb[i];
      Etot[i] = 1 - (1 - ea) * (1 - Erain[i]);
      /* soft quantization: inside the 40% blend band, hold the previous
         level (temporal hysteresis — bands never march) */
      const v = lutE(Etot[i]);
      const k = Math.floor(v);
      const f = v - k;
      let lv: number;
      if (f > SOFT_BAND / 2 && f < 1 - SOFT_BAND / 2 && prevQuant[i] >= k && prevQuant[i] <= k + 1) lv = prevQuant[i];
      else lv = f >= 0.5 ? k + 1 : k;
      quant[i] = Math.min(11, lv);
      prevQuant[i] = quant[i];
    }
    level.set(quant);
    if (bloomOn) {
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const i = r * cols + c;
          let orth = 0, diag = 0;
          if (r > 0) { const v = quant[i - cols]; if (v >= 6 && v > orth) orth = v; }
          if (r < rows - 1) { const v = quant[i + cols]; if (v >= 6 && v > orth) orth = v; }
          if (c > 0) { const v = quant[i - 1]; if (v >= 6 && v > orth) orth = v; }
          if (c < cols - 1) { const v = quant[i + 1]; if (v >= 6 && v > orth) orth = v; }
          if (r > 0 && c > 0) { const v = quant[i - cols - 1]; if (v >= 6 && v > diag) diag = v; }
          if (r > 0 && c < cols - 1) { const v = quant[i - cols + 1]; if (v >= 6 && v > diag) diag = v; }
          if (r < rows - 1 && c > 0) { const v = quant[i + cols - 1]; if (v >= 6 && v > diag) diag = v; }
          if (r < rows - 1 && c < cols - 1) { const v = quant[i + cols + 1]; if (v >= 6 && v > diag) diag = v; }
          const b2 = Math.max(Math.floor(0.30 * orth), Math.floor(0.20 * diag));
          if (b2 > level[i]) level[i] = b2;
        }
      }
    }
  }

  /* ---------- paint: one integer fillRect per CHANGED cell ---------- */
  let lastSubH = -1;
  let lastPaintKey = '';
  const SKIP = 254, LIME_V = 250;
  function paint(force = false) {
    const key = tRain + '|' + ignite + '|' + sweep;
    if (!force && key === lastPaintKey) return;
    lastPaintKey = key;
    const W = canvas.width, H = canvas.height;
    if (force) { painted.fill(255); lastSubH = -1; ctx.clearRect(0, 0, W, H); }
    drawCount = 0;
    if (mode === 'ramp') {
      const bandH = Math.max(1, Math.floor(H / N_LEVELS));
      for (let k = 0; k < N_LEVELS; k++) {
        ctx.fillStyle = '#' + RAMP[k].map((v) => v.toString(16).padStart(2, '0')).join('');
        ctx.fillRect(0, k * bandH, W, bandH); drawCount++;
      }
      return;
    }
    const waveF = ignite * (rows + 2 * WAVE_JITTER + 6) - (WAVE_JITTER + 3);
    const sweepF = sweep * (rows + 2 * SWEEP_JITTER + 6) - (SWEEP_JITTER + 3);
    const limeHex = '#' + LIME.map((v) => v.toString(16).padStart(2, '0')).join('');
    const bgHex = '#' + BG.map((v) => v.toString(16).padStart(2, '0')).join('');
    const sz = cellDev - gapDev;
    const RAMP_HEX = RAMP.map((c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join(''));
    const maxWaveRow = ignite >= 0.9999 ? rows : Math.ceil(waveF + WAVE_JITTER + 1);
    const subH = Math.min(H, maxWaveRow * cellDev);
    if (subH !== lastSubH) {
      if (subH > lastSubH) { ctx.fillStyle = bgHex; ctx.fillRect(0, lastSubH < 0 ? 0 : lastSubH, W, subH - Math.max(0, lastSubH)); }
      else ctx.clearRect(0, subH, W, (lastSubH < 0 ? 0 : lastSubH) - subH);
      lastSubH = subH;
      painted.fill(255);
    }
    for (let r = 0; r < rows; r++) {
      const y = r * cellDev;
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        let eff: number;
        if (sweep > 0.0001) {
          const sj = (hash2(c, 311) - 0.5) * 2 * SWEEP_JITTER;
          eff = r < sweepF + sj ? LIME_V : level[i];
        } else if (ignite < 0.9999) {
          const jit = (hash2(c, 913) - 0.5) * 2 * WAVE_JITTER;
          const fd = waveF + jit - r;
          eff = fd < 0 ? SKIP : fd < 1.5 ? 11 : level[i];
        } else {
          eff = mode === 'grid' ? 1 : level[i];
        }
        if (painted[i] === eff) continue;
        if (eff === SKIP) ctx.clearRect(c * cellDev, y, sz, sz);
        else { ctx.fillStyle = eff === LIME_V ? limeHex : RAMP_HEX[eff]; ctx.fillRect(c * cellDev, y, sz, sz); }
        painted[i] = eff;
        drawCount++;
      }
    }
  }

  let lastComputedKey = '';
  let lastAmbientAt = -1;
  function frame(now: number) {
    raf = 0;
    if (disposed) return;
    const dt = Math.min(now - t0, RAIN_DT_CAP_MS);
    t0 = now;
    if (!reduced && freezeT === null) {
      /* smoothed speed multiplier: scroll coupling, max +35%, τ = 400ms */
      const target = coupleTarget();
      speedMult += (target - speedMult) * (1 - Math.exp(-dt / SPEED_SMOOTHING_MS));
      tRain += (dt / 1000) * speedMult;
      /* the ambient field changes slowly — refresh it at tick rate; the
         rain runs every frame for continuous motion */
      if (tRain - lastAmbientAt > TICK_MS / 1000 || lastAmbientAt < 0) {
        lastAmbientAt = tRain;
        ambientDirty = true;
      }
      computeLevels();
      lastComputedKey = '';
    }
    paint();
    if (filmActive && ioVisible && !hidden) raf = requestAnimationFrame(frame);
  }
  let ambientDirty = true;

  /* scroll-velocity target for the speed multiplier */
  let coupleVel = 0;
  function coupleTarget(): number {
    if (reduced) return 0.3;
    const now = performance.now();
    if (now - lastCoupleCheck > 80) {
      const y = window.scrollY;
      const v = Math.abs(y - lastScrollY) / Math.max(1, now - lastCoupleCheck);
      lastScrollY = y;
      lastCoupleCheck = now;
      coupleVel = v;
    }
    return 1 + SCROLL_SPEED_COUPLING * Math.min(1, coupleVel / 1.5);
  }

  function kick() {
    if (!raf && filmActive && ioVisible && !hidden && !disposed) raf = requestAnimationFrame(frame);
  }

  /* ---------- wiring ---------- */
  const io = new IntersectionObserver(([e]) => { ioVisible = e.isIntersecting; kick(); }, { rootMargin: '100% 0%' });
  io.observe(canvas);
  const ro = new ResizeObserver(() => { metrics(); paint(true); });
  ro.observe(canvas);
  const onVis = () => { hidden = document.hidden; t0 = performance.now(); kick(); };
  document.addEventListener('visibilitychange', onVis);

  metrics();
  if (freezeT) tRain = parseFloat(freezeT);
  computeLevels();
  paint(true);

  /* ---------- probe ---------- */
  function fnv(arr: Uint8Array): number {
    let h = 2166136261;
    for (let i = 0; i < arr.length; i++) { h ^= arr[i]; h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function dropsNow(): Array<Record<string, number>> {
    const out: Array<Record<string, number>> = [];
    for (const th of threads) {
      if (!threadVisibleAt(th, tRain)) continue;
      const h = ((tRain + th.phase) % th.T + th.T) % th.T / th.T * th.cycleLen - th.tail;
      out.push({ col: th.col, cls: th.cls, head: +h.toFixed(2), v: th.v, tail: th.tail, bright: RAIN_LAYERS[th.cls].bright });
    }
    const comet = cometAt(tRain);
    if (comet) {
      const tail = rows * COMET_TAIL_FRAC;
      const dur = (rows + tail) / COMET_SPEED;
      const h = (tRain - comet.t0) / dur * (rows + tail) - tail;
      out.push({ col: comet.col, cls: 3, head: +h.toFixed(2), v: COMET_SPEED, tail, bright: 1 });
    }
    return out;
  }
  (window as unknown as { __panel?: Record<string, unknown> }).__panel = {
    get layers() { return 1; },
    get cols() { return cols; },
    get rows() { return rows; },
    get cell() { return cellDev; },
    get gap() { return gapDev; },
    get ramp() { return RAMP; },
    levels: () => level.slice(),
    energy: () => Etot.slice(),
    drops: () => dropsNow(),
    rainDensity: () => Math.round(new Set(dropsNow().map((d) => d.col)).size / cols * 100),
    drawCount: () => drawCount,
    hash: () => fnv(level),
    hashAt: (t: number) => {
      const snapT = tRain, snapB = baseLv.slice(), snapQ = prevQuant.slice();
      tRain = t; baseLv.fill(0); prevQuant.fill(255);
      computeLevels();
      const h = fnv(level);
      tRain = snapT; baseLv.set(snapB); prevQuant.set(snapQ);
      computeLevels();
      return h;
    },
    tick: () => tRain,
    get speedMult() { return +speedMult.toFixed(3); },
  };

  wall = {
    setIgnite(v) { ignite = Math.min(1, Math.max(0, v)); kick(); },
    setSweep(v) { sweep = Math.min(1, Math.max(0, v)); kick(); },
    setActive(on) { filmActive = on; kick(); },
    setTier() { /* single 2D pipeline */ },
    histogram: () => {
      const buckets = [0, 0, 0, 0];
      for (let i = 0; i < level.length; i++) {
        const v = level[i];
        if (v === 0) buckets[0]++;
        else if (v <= 3) buckets[1]++;
        else if (v <= 7) buckets[2]++;
        else buckets[3]++;
      }
      const n = level.length || 1;
      return buckets.map((b2) => Math.round((b2 / n) * 1000) / 10);
    },
    destroy() {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      io.disconnect(); ro.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (wall === this) wall = null;
    },
  };
  return wall;
}
