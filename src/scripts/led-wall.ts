/*
  LED PANEL — a LED-field engine.

  Each LED owns state (emission E, glint, shimmer, personality from its
  index hash). Every frame the DIRECTORS write input energy into the
  field (soft-summed, never saturating), then each LED integrates its
  own dynamics with real dt (fast attack, non-linear phosphor decay
  with a long ember tail, tiny diffusion to the 8 neighbours), plus
  independent glints and per-LED shimmer. The renderer is unchanged:
  the approved plate (integer fillRect per changed cell, closed
  12-level ramp, cell bloom, ignition wave and lime sweep as before).

  Directors (same interface: write(input, dt, ctx)):
    RainDirector   — free drops, NOTHING bound to columns: continuous
                     x/y in LED units, anisotropic kernels (gaussian σx
                     + hot head + exponential tail + faint anticipation),
                     ease-in, curl-ish wind + gusts, blue-noise spawns
                     (Poisson-disc over x with a cooling map), merge and
                     rare split, breathing density.
    CometDirector  — one rare near-full-height comet at a time.
    ExposureController — closed loop: mean luminance -> 0.22-0.32 with
                     τ ≈ 3s, steering the spawn rate (never pulsing).

  Time: everything integrates with dt (≤50ms, sub-stepped at ≤33ms so
  10/60/144fps fall at the same speed); speed multiplier is smoothed
  (scroll coupling ≤ +35%, lime-sweep acceleration); pause offscreen
  keeps state; warm-up fast-forwards ~8s so the scene is born raining.
  Reduced motion: 30% speed, no comets, no merge, no coupling.

  Debug: ?panel=base|drops|grid|ramp|nogap · ?bloom=0 · ?feed=0 (no-op,
  kept for old links) · ?t=N freeze · ?fps=N frame coalescing (tests)
  · ?tune=1 live tuning panel.
  Probe: window.__panel (read-only).
*/

/* ---------- seed & driver ---------- */
const SEED = 0x9e37;
const TICK_MS = 33.3;
const DT_CAP_MS = 250;          /* anti-freeze only; substeps keep physics stable */
const SUBSTEP_MS = 33;

/* ---------- grid (unchanged from the approved board) ---------- */
const COLUMNS_PER_WIDTH = 17;
const COLUMNS_MIN = 36;
const COLUMNS_MAX = 120;

/* ---------- LED dynamics ---------- */
const LED_ATTACK_TAU = 0.012;     /* s — near-instant attack */
const LED_DECAY_TAU = 0.20;      /* s at full E; low E decays ~5× slower (embers) */
let SPILL = 0.05;                /* diffusion to the 8 neighbours */
const GAIN_VARIANCE = 0.08;      /* ±8% per-LED gain */
const TAU_VARIANCE = 0.20;       /* ±20% attack/decay speed */
const GLINT_RATE = 0.02;         /* independent sparks per LED per second */
const GLINT_TAU = 0.12;          /* fast glint decay */
const SHIMMER_AMPLITUDE = 0.04;  /* random-walk ceiling, ≤ 1 LED correlation */

/* ---------- rain: free drops, 3 depth layers ---------- */
/* v (LED/s) · tail (LED) · brightness · σx (LED) · share of spawns */
const DROP_LAYERS = [
  { vMin: 6, vMax: 9, tailMin: 3, tailMax: 5, bright: 0.45, sx: 0.45, share: 0.40 },
  { vMin: 10, vMax: 16, tailMin: 5, tailMax: 8, bright: 0.95, sx: 0.6, share: 0.33 },
  { vMin: 18, vMax: 28, tailMin: 8, tailMax: 14, bright: 1.15, sx: 0.9, share: 0.27 },
];
let DENSITY_TARGET = 150;        /* active drops at reference area (scaled); exposure trims it */
const BREATH_PERIOD = 18;        /* s */
let BREATH_DEPTH = 0.35;
let WIND_AMPLITUDE = 1.2;        /* LED/s lateral drift */
const GUST_PERIOD = 9;           /* s — slow gust envelope */
const MERGE_RADIUS = 1.0;        /* LED units, same layer */
const SPLIT_RATE = 0.04;         /* 1/s for large drops */
const ANTICIPATE = 0.10;
const EASE_IN_FRAC = 0.2;        /* accelerate over the first 20% of height */
const POOL_MAX = 1500;

/* ---------- exposure (closed loop) ---------- */
let EXPOSURE_TARGET = 0.27;      /* mean DISPLAY luminance (level/11) */
const EXPOSURE_TAU = 3;          /* s */
const EXPOSURE_MIN = 0.5, EXPOSURE_MAX = 2.2;

/* ---------- comets ---------- */
const COMET_INTERVAL = [5, 9];   /* s between comets */
const COMET_SPEED = 34;          /* LED/s */
const COMET_TAIL_FRAC = 0.85;    /* of rows */
const COMET_SIGMA = 1.4;

/* ---------- scroll coupling ---------- */
const SCROLL_SPEED_COUPLING = 0.35;
const SPEED_SMOOTHING_MS = 400;

/* ---------- render (unchanged) ---------- */
const GAMMA = 1.6;
const N_LEVELS = 12;
const SOFT_BAND = 0.4;
const WAVE_JITTER = 3;
const SWEEP_JITTER = 4;
const RAMP_GREEN = ['#020602', '#020f02', '#011e01', '#023502', '#034e04', '#036806', '#038409', '#02a00b', '#00be0e', '#12dc1b', '#72f16d', '#c9fbc4'];
const RAMP_LIME = ['#081301', '#122401', '#1d3502', '#2b4b02', '#3a6202', '#4a7a02', '#5c9204', '#6fa906', '#84c109', '#9cd90f', '#bbe03f', '#dcffa8'];
const COLOR_BG = '#070210';
const COLOR_LIME = '#9df133';
const GAP_RATIO = 0.06;
const WARMUP_S = 8;

/* ---------- PRNG / noise ---------- */
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
function noise1(x: number): number {
  const xi = Math.floor(x), xf = x - xi;
  const u = xf * xf * (3 - 2 * xf);
  return hash2(xi, 101) * (1 - u) + hash2(xi + 1, 101) * u;
}
function noise2(x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b2 = hash2(xi + 1, yi), c = hash2(xi, yi + 2000), d = hash2(xi + 1, yi + 2000);
  return a + (b2 - a) * u + (c - a) * v + (a - b2 - c + d) * u * v;
}
const lutE = (E: number) => Math.min(11, Math.max(0, 11 * Math.pow(Math.max(0, Math.min(1.2, E)), 1 / GAMMA)));

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
  const freezeT = params.get('t');
  const fpsGate = parseInt(params.get('fps') || '0', 10) || 0;

  const RAMP = (useLimeRamp ? RAMP_LIME : RAMP_GREEN).map((h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]);
  const BG = [7, 2, 16];
  const LIME = [parseInt(COLOR_LIME.slice(1, 3), 16), parseInt(COLOR_LIME.slice(3, 5), 16), parseInt(COLOR_LIME.slice(5, 7), 16)];

  const ctx = canvas.getContext('2d', { alpha: true })!;
  let ignite = 1, sweep = 0;
  let filmActive = false, ioVisible = true, hidden = document.hidden;
  let disposed = false, raf = 0;
  let drawCount = 0;
  let simMs = 0;

  /* ---------- grid ---------- */
  let cssW = 1, cssH = 1, cellDev = 17, gapDev = 1, cols = 0, rows = 0, N = 0;

  /* ---------- per-LED state ---------- */
  let E = new Float32Array(0);        /* emission */
  let Gin = new Float32Array(0);      /* director input (per frame) */
  let G = new Float32Array(0);        /* glint channel */
  let Es = new Float32Array(0);       /* spill scratch */
  let shim = new Float32Array(0);     /* shimmer walk */
  let gain = new Float32Array(0);     /* personality */
  let atkT = new Float32Array(0);
  let decT = new Float32Array(0);
  let level = new Uint8Array(0);
  let prevQuant = new Uint8Array(0);
  let painted = new Uint8Array(0);
  let quant = new Uint8Array(0);

  /* ---------- drop pool (SoA, fixed) ---------- */
  const dx = new Float32Array(POOL_MAX);
  const dy = new Float32Array(POOL_MAX);
  const dv = new Float32Array(POOL_MAX);
  const dtail = new Float32Array(POOL_MAX);
  const dsx = new Float32Array(POOL_MAX);
  const dbright = new Float32Array(POOL_MAX);
  const dlayer = new Uint8Array(POOL_MAX);
  const dhot = new Uint8Array(POOL_MAX);
  const dage = new Float32Array(POOL_MAX);
  const dseq = new Uint32Array(POOL_MAX);
  const alive = new Uint8Array(POOL_MAX);
  const free: number[] = [];
  let poolCursor = 0;
  let dropSeq = 0;

  /* merge bins (rebuilt per frame, zero alloc) */
  let binHead = new Int32Array(0);
  let binNext = new Int32Array(POOL_MAX);

  /* spawn blue-noise over x */
  let heat: Float32Array = new Float32Array(0);
  let heatBins = 0;

  /* comet state */
  let cometNext = 4 + Math.random() * 4;
  let cometActive = false;

  /* exposure */
  let expoMult = 1;
  let expoLastCheck = 0;

  /* time */
  let tSim = 0;
  let t0 = performance.now();
  let speedMult = reduced ? 0.3 : 1;
  let lastScrollY = window.scrollY;
  let lastCoupleCheck = 0;
  let coupleVel = 0;
  let frameGate = 0;
  let rng = mulberry32(SEED ^ Date.now());

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
    N = cols * rows;
    E = new Float32Array(N); Gin = new Float32Array(N); G = new Float32Array(N);
    Es = new Float32Array(N); shim = new Float32Array(N);
    gain = new Float32Array(N); atkT = new Float32Array(N); decT = new Float32Array(N);
    level = new Uint8Array(N); prevQuant = new Uint8Array(N); painted = new Uint8Array(N); quant = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      gain[i] = 1 - GAIN_VARIANCE + 2 * GAIN_VARIANCE * hash2(i, 500);
      atkT[i] = LED_ATTACK_TAU * (1 - TAU_VARIANCE + 2 * TAU_VARIANCE * hash2(i, 501));
      decT[i] = LED_DECAY_TAU * (1 - TAU_VARIANCE + 2 * TAU_VARIANCE * hash2(i, 502));
    }
    heatBins = Math.max(16, cols);
    heat = new Float32Array(heatBins);
    binHead = new Int32Array(cols);
    /* mobile scaling: drops ∝ area */
    dropTargetN = DENSITY_TARGET * (N / 6216);
    ctx.imageSmoothingEnabled = false;
  }
  let dropTargetN = DENSITY_TARGET;

  /* ---------- directors ---------- */
  function softAdd(i: number, c: number) {
    Gin[i] = 1 - (1 - Gin[i]) * (1 - Math.min(1, c));
  }

  /* stamp an anisotropic kernel at continuous (x, y) */
  function stampDrop(x: number, y: number, tail: number, sx: number, bright: number, hot: boolean) {
    const wx0 = Math.max(0, Math.floor(x - 3 * sx)), wx1 = Math.min(cols - 1, Math.ceil(x + 3 * sx));
    const top = Math.max(0, Math.floor(y - tail) - 1);
    const bot = Math.min(rows - 1, Math.floor(y) + 1);
    const inv2s2 = 1 / (2 * sx * sx);
    for (let c = wx0; c <= wx1; c++) {
      const wx = Math.exp(-(c - x) * (c - x) * inv2s2);
      if (wx < 0.02) continue;
      for (let r = bot; r >= top; r--) {
        const d = y - r;
        let e = 0;
        if (d >= 0 && d <= tail) {
          const u = d / tail;
          e = bright * Math.pow(1 - u, 1.15) * Math.exp(-0.8 * u);
          if (d < 1) e = hot ? 1.0 : bright; /* the head cell */
        } else if (d < 0 && d >= -1) {
          e = bright * ANTICIPATE;
        } else continue;
        softAdd(r * cols + c, e * wx);
      }
    }
  }

  function spawnDrop(layer: number, x?: number, y?: number, v?: number, tail?: number, bright?: number, sx?: number, hot?: boolean): number {
    let id = -1;
    if (free.length) id = free.pop()!;
    else if (poolCursor < POOL_MAX) id = poolCursor++;
    else return -1;
    const L = DROP_LAYERS[layer];
    dx[id] = x ?? rng() * cols;
    dy[id] = y ?? -2 - rng() * 4;
    dv[id] = v ?? (L.vMin + (L.vMax - L.vMin) * rng()) * (0.85 + 0.3 * rng());
    dtail[id] = tail ?? L.tailMin + (L.tailMax - L.tailMin) * rng();
    dbright[id] = bright ?? L.bright * (0.9 + 0.2 * rng());
    dsx[id] = sx ?? L.sx * (0.85 + 0.3 * rng());
    dlayer[id] = layer;
    dhot[id] = layer === 2 ? 1 : (hot ? 1 : 0);
    dage[id] = 0;
    dseq[id] = dropSeq;
    alive[id] = 1;
    dropSeq++;
    return id;
  }
  function killDrop(id: number) {
    alive[id] = 0;
    free.push(id);
  }

  /* blue-noise x sampling: coolest bin (+ jitter) among random candidates */
  function blueNoiseX(): number {
    let best = -1, bestHeat = 1e9;
    for (let k = 0; k < 12; k++) {
      const b = Math.floor(rng() * heatBins);
      const h = heat[b] + rng() * 0.4;
      if (h < bestHeat) { bestHeat = h; best = b; }
    }
    for (let b = best; b === best; b++) heat[b] += 1; /* mark only the chosen bin — no repulsion bias */
    /* near-full-unit offset: with heatBins == cols this offset IS the
       sub-column fraction, so it must span ~[0,1) or births cluster mid-bin */
    return (best + 0.02 + 0.96 * rng()) / heatBins * cols;
  }

  /* wind: low-frequency flow, ±WIND_AMPLITUDE, with slow gusts */
  function windAt(x: number, y: number, t: number): number {
    const gust = 0.5 + 0.5 * noise1(t / GUST_PERIOD + 31);
    const n = noise2(x * 0.07, y * 0.05 + t * 0.03) - 0.5;
    return n * 2 * WIND_AMPLITUDE * (0.4 + 0.9 * gust);
  }

  function rainDirector(dt: number, t: number) {
    /* cooling map decay (blue-noise spawns) */
    const cool = Math.exp(-dt * 0.4);
    for (let b = 0; b < heatBins; b++) heat[b] *= cool;
    /* breathing + exposure-driven target count */
    const breath = 1 - BREATH_DEPTH * 0.5 + BREATH_DEPTH * 0.5 * noise1(t / BREATH_PERIOD);
    const target = dropTargetN * breath * expoMult;
    /* spawn control (proportional, never naive) */
    let live = 0;
    for (let k = 0; k < POOL_MAX; k++) if (alive[k]) live++;
    if (live < target) {
      let n = Math.min(3, Math.ceil(target - live));
      while (n-- > 0) {
        let r = rng(), layer = 0, acc = DROP_LAYERS[0].share;
        for (; layer < 2; layer++) { if (r < acc) break; acc += DROP_LAYERS[layer + 1].share; }
        spawnDrop(Math.min(2, layer), blueNoiseX());
      }
    }
    /* merge pass: bin by column, check ±1 bin, same layer (O(n)) */
    if (!reduced) {
      binHead.fill(-1);
      for (let k = 0; k < poolCursor; k++) {
        if (!alive[k]) continue;
        const b = Math.max(0, Math.min(cols - 1, Math.floor(dx[k])));
        binNext[k] = binHead[b];
        binHead[b] = k;
      }
      for (let b = 0; b < cols; b++) {
        for (let k = binHead[b]; k !== -1; k = binNext[k]) {
          if (!alive[k]) continue;
          for (let b2 = b; b2 <= b + 1 && b2 < cols; b2++) {
            for (let j = binHead[b2]; j !== -1; j = binNext[j]) {
              if (j <= k || !alive[j] || !alive[k] || dlayer[j] !== dlayer[k]) continue;
              const ddx = dx[j] - dx[k], ddy = dy[j] - dy[k];
              if (ddx * ddx + ddy * ddy < MERGE_RADIUS * MERGE_RADIUS) {
                const fast = dv[j] > dv[k] ? j : k, slow = fast === j ? k : j;
                dbright[fast] = Math.min(1.2, dbright[fast] + dbright[slow] * 0.5);
                dtail[fast] = Math.min(DROP_LAYERS[dlayer[fast]].tailMax * 1.3, dtail[fast] + dtail[slow] * 0.3);
                killDrop(slow);
              }
            }
          }
        }
      }
    }
    /* integrate + stamp */
    const easeH = EASE_IN_FRAC * rows;
    for (let k = 0; k < poolCursor; k++) {
      if (!alive[k]) continue;
      dage[k] += dt;
      const ease = dy[k] < 0 ? 0.35 : Math.min(1, 0.35 + 0.65 * (dy[k] / easeH));
      dy[k] += dv[k] * ease * dt;
      dx[k] += windAt(dx[k], dy[k], t) * dt;
      if (dx[k] < 0) dx[k] += cols; else if (dx[k] >= cols) dx[k] -= cols;
      /* rare split of large drops */
      if (!reduced && dtail[k] > DROP_LAYERS[dlayer[k]].tailMax * 0.85 && rng() < SPLIT_RATE * dt) {
        const id2 = spawnDrop(dlayer[k], dx[k] + 0.6, dy[k], dv[k] * 0.96, dtail[k] * 0.6, dbright[k] * 0.7, dsx[k], dhot[k] === 1);
        if (id2 >= 0) { dtail[k] *= 0.65; dbright[k] *= 0.85; }
      }
      stampDrop(dx[k], dy[k], dtail[k], dsx[k], dbright[k], dhot[k] >= 1);
      if (dy[k] - dtail[k] > rows + 3) killDrop(k);
    }
  }

  function cometDirector(dt: number, t: number) {
    if (reduced) return;
    let has = false;
    for (let k = 0; k < POOL_MAX && !has; k++) if (alive[k] && dhot[k] === 1 && dtail[k] > rows * 0.6) has = true;
    if (has) { cometActive = false; return; }
    if (t >= cometNext) {
      const id = spawnDrop(2, blueNoiseX(), -4, COMET_SPEED, rows * COMET_TAIL_FRAC, 1.0, COMET_SIGMA, true);
      if (id >= 0) {
        dhot[id] = 2; /* comet marker */
        cometActive = true;
        cometNext = t + COMET_INTERVAL[0] + rng() * (COMET_INTERVAL[1] - COMET_INTERVAL[0]);
      }
    }
  }

  function exposureController(t: number) {
    if (t - expoLastCheck < 0.25) return;
    expoLastCheck = t;
    /* closed loop on DISPLAY luminance: mean(level)/11 ≈ mean(E^(1/γ)) */
    let s = 0;
    const invG = 1 / GAMMA;
    for (let i = 0; i < N; i++) s += Math.pow(Math.min(1, E[i]), invG);
    const meanLum = (s / Math.max(1, N));
    const err = (EXPOSURE_TARGET - meanLum) / EXPOSURE_TARGET;
    expoMult = Math.max(EXPOSURE_MIN, Math.min(EXPOSURE_MAX, expoMult * (1 + err * 0.18)));
  }

  /* ---------- LED dynamics ---------- */
  function ledStep(dt: number, stamp: boolean) {
    const rainOn = mode === '' || mode === 'drops';
    if (stamp) {
      Gin.fill(0);
      if (rainOn) {
        rainDirector(dt, tSim);
        cometDirector(dt, tSim);
      }
    }
    exposureController(tSim);
    const atkK = 1 - Math.exp(-dt / 0.012);
    for (let i = 0; i < N; i++) {
      /* glints: Poisson per LED */
      if (rng() < GLINT_RATE * dt) G[i] = 0.45 + 0.5 * rng();
      if (G[i] > 0) { G[i] *= Math.exp(-dt / GLINT_TAU); if (G[i] < 0.01) G[i] = 0; }
      let target = 1 - (1 - Gin[i]) * (1 - G[i]);
      let e = E[i];
      if (target > e) e += (target - e) * atkK * (LED_ATTACK_TAU / atkT[i]);
      else if (e > 0) {
        const tau = decT[i] * (0.55 + 0.9 * (1 - Math.min(1, e)));
        e *= Math.exp(-dt / tau);
        if (e < 0.004) e = 0;
      }
      E[i] = e * gain[i];
      /* shimmer random walk — MULTIPLICATIVE (±4% of the cell's own
         level), so dim cells don't swing in relative terms */
      let s = shim[i] + (rng() - 0.5) * 0.02 * dt * 60;
      if (s > SHIMMER_AMPLITUDE) s = SHIMMER_AMPLITUDE;
      if (s < -SHIMMER_AMPLITUDE) s = -SHIMMER_AMPLITUDE;
      shim[i] = s;
    }
    /* spill: small diffusion to the 8 neighbours */
    if (SPILL > 0 && stamp) {
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const i = r * cols + c;
          let s = 0, n = 0;
          for (let dr = -1; dr <= 1; dr++) {
            const rr = r + dr;
            if (rr < 0 || rr >= rows) continue;
            for (let dc = -1; dc <= 1; dc++) {
              if (dr === 0 && dc === 0) continue;
              const cc = c + dc;
              if (cc < 0 || cc >= cols) continue;
              s += E[rr * cols + cc]; n++;
            }
          }
          Es[i] = E[i] + SPILL * (s / Math.max(1, n) - E[i]);
        }
      }
      const tmp = E; E = Es; Es = tmp;
    }
  }

  /* ---------- quantize + bloom ---------- */
  function compose() {
    for (let i = 0; i < N; i++) {
      const v = lutE(E[i] * (1 + shim[i]));
      const k = Math.floor(v);
      const f = v - k;
      let lv: number;
      if (f > SOFT_BAND / 2 && f < 1 - SOFT_BAND / 2 && prevQuant[i] >= k && prevQuant[i] <= k + 1) lv = prevQuant[i];
      else lv = f >= 0.5 ? k + 1 : k;
      quant[i] = Math.min(11, lv);
      prevQuant[i] = quant[i];
    }
    level.set(quant);
    if (bloomOn && mode !== 'base') {
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

  /* ---------- paint (unchanged plate) ---------- */
  let lastSubH = -1;
  let lastPaintKey = '';
  const SKIP = 254, LIME_V = 250;
  function paint(force = false) {
    const key = Math.round(tSim * 1000) + '|' + ignite + '|' + sweep;
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

  /* ---------- speed coupling ---------- */
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
    const scroll = 1 + SCROLL_SPEED_COUPLING * Math.min(1, coupleVel / 1.5);
    const sweepBoost = 1 + 0.35 * (sweep > 0 && sweep < 1 ? sweep : 0);
    return scroll * sweepBoost;
  }

  /* ---------- frame ---------- */
  function step(dtMs: number, stamp: boolean) {
    const target = reduced ? 0.3 : coupleTarget();
    speedMult += (target - speedMult) * (1 - Math.exp(-dtMs / SPEED_SMOOTHING_MS));
    const dt = (dtMs / 1000) * speedMult;
    let remaining = dt;
    const maxStep = SUBSTEP_MS / 1000;
    let first = stamp;
    while (remaining > 0.0001) {
      const h = Math.min(maxStep, remaining);
      tSim += h;
      ledStep(h, first);
      first = false;
      remaining -= h;
    }
    compose();
  }

  function frame(now: number) {
    raf = 0;
    if (disposed) return;
    if (fpsGate > 0 && ++frameGate % fpsGate !== 0) { raf = requestAnimationFrame(frame); return; }
    const dt = Math.min(now - t0, DT_CAP_MS);
    t0 = now;
    const tStart = performance.now();
    if (freezeT === null) step(dt, true);
    simMs = simMs * 0.9 + (performance.now() - tStart) * 0.1;
    paint();
    if (filmActive && ioVisible && !hidden) raf = requestAnimationFrame(frame);
  }

  function kick() {
    if (!raf && filmActive && ioVisible && !hidden && !disposed) raf = requestAnimationFrame(frame);
  }

  /* ---------- wiring ---------- */
  const io = new IntersectionObserver(([e]) => { ioVisible = e.isIntersecting; if (e.isIntersecting) t0 = performance.now(); kick(); }, { rootMargin: '100% 0%' });
  io.observe(canvas);
  const ro = new ResizeObserver(() => { metrics(); paint(true); });
  ro.observe(canvas);
  const onVis = () => { hidden = document.hidden; t0 = performance.now(); kick(); };
  document.addEventListener('visibilitychange', onVis);

  metrics();
  /* warm-up: fast-forward ~8s in coarse slices so the scene is born raining */
  {
    let t = 0;
    while (t < WARMUP_S) {
      ledStep(0.05, true);
      tSim += 0.05;
      t += 0.05;
    }
    compose();
  }
  paint(true);

  /* ---------- tuning panel (?tune=1) ---------- */
  if (params.get('tune') === '1') {
    const panelEl = document.createElement('div');
    panelEl.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:9999;background:#000c;color:#9df133;font:11px monospace;padding:10px;border:1px solid #9df13355;max-height:70vh;overflow:auto';
    const tunables: Array<[string, number, number, (v: number) => void]> = [
      ['DENSITY_TARGET', 10, 160, (v) => { DENSITY_TARGET = v; dropTargetN = v * (N / 6216); }],
      ['LED_DECAY_TAU', 0.05, 1.5, (v) => { for (let i = 0; i < N; i++) decT[i] = v * (decT[i] / decT[i]); }],
      ['SPILL', 0, 0.3, (v) => { SPILL = v; }],
      ['WIND_AMPLITUDE', 0, 3, (v) => { WIND_AMPLITUDE = v; }],
      ['EXPOSURE_TARGET', 0.15, 0.4, (v) => { EXPOSURE_TARGET = v; }],
      ['BREATH_DEPTH', 0, 0.8, (v) => { BREATH_DEPTH = v; }],
    ];
    const values: Record<string, number> = { DENSITY_TARGET, LED_DECAY_TAU, SPILL, WIND_AMPLITUDE, EXPOSURE_TARGET, BREATH_DEPTH };
    panelEl.appendChild(document.createTextNode('LED panel tuning'));
    panelEl.appendChild(document.createElement('br'));
    for (const [name, min, max, apply] of tunables) {
      const row = document.createElement('label');
      row.style.display = 'block';
      const slider = document.createElement('input');
      slider.type = 'range'; slider.min = String(min); slider.max = String(max); slider.step = 'any'; slider.value = String(values[name]);
      const label = document.createElement('span');
      label.textContent = name + '=' + values[name];
      slider.oninput = () => { const v = parseFloat(slider.value); label.textContent = name + '=' + v.toFixed(2); apply(v); values[name] = v; };
      row.appendChild(slider); row.appendChild(label);
      panelEl.appendChild(row);
    }
    const btn = document.createElement('button');
    btn.textContent = 'copy JSON';
    btn.onclick = () => navigator.clipboard?.writeText(JSON.stringify(values));
    panelEl.appendChild(btn);
    document.body.appendChild(panelEl);
  }

  /* ---------- probe ---------- */
  function fnv(arr: Uint8Array): number {
    let h = 2166136261;
    for (let i = 0; i < arr.length; i++) { h ^= arr[i]; h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function dropsNow() {
    const out: Array<Record<string, number>> = [];
    for (let k = 0; k < POOL_MAX; k++) {
      if (!alive[k]) continue;
      out.push({ id: k, seq: dseq[k], x: +dx[k].toFixed(2), y: +dy[k].toFixed(2), v: +dv[k].toFixed(2), layer: dlayer[k], tail: +dtail[k].toFixed(1), bright: +dbright[k].toFixed(2), comet: dhot[k] === 2 ? 1 : 0 });
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
    energy: () => E.slice(),
    drops: () => dropsNow(),
    rainDensity: () => {
      const set = new Set<number>();
      for (let k = 0; k < POOL_MAX; k++) if (alive[k] && dy[k] > -2 && dy[k] < rows) set.add(Math.floor(dx[k]));
      return Math.round(set.size / cols * 100);
    },
    drawCount: () => drawCount,
    hash: () => fnv(level),
    tick: () => +tSim.toFixed(2),
    get speedMult() { return +speedMult.toFixed(3); },
    get simMs() { return +simMs.toFixed(2); },
    get exposureMult() { return +expoMult.toFixed(2); },
    get meanE() { let s = 0; for (let i = 0; i < N; i++) s += E[i]; return +(s / Math.max(1, N)).toFixed(3); },
    get meanLum() { let s = 0; for (let i = 0; i < N; i++) s += Math.pow(Math.min(1, E[i]), 1 / GAMMA); return +(s / Math.max(1, N)).toFixed(3); },
  };

  wall = {
    setIgnite(v) { ignite = Math.min(1, Math.max(0, v)); kick(); },
    setSweep(v) { sweep = Math.min(1, Math.max(0, v)); kick(); },
    setActive(on) { filmActive = on; if (on) t0 = performance.now(); kick(); },
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
