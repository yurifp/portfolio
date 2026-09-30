/*
  LED PANEL — the board, rebuilt as a literal LED plate.

  Every cols×rows cell EXISTS and is drawn every frame with the color
  of its level (0-6). One level per cell: final = max(base, drop).
  No sprites, no halo, no blur, no per-cell luck: the tone is a pure
  function of a drifting value-noise field, drops are discrete cell
  state (head advances 1 cell every p ticks), and the frame is a pure
  function of (seed, driver) — reload or re-route lands on the same
  board.

  Rendering is Canvas2D at device resolution: integer cellDev, integer
  fillRects (run-length batched per row), imageSmoothingEnabled=false,
  no filter/shadowBlur/globalAlpha/blend. Gap = exact background color.

  Scroll layers preserved: the ignition wave (hero -> board) draws only
  cells behind the front; the lime sweep (board -> verde) paints flat
  #9df133 rows with a cell-quantized front — both scrubbed, both
  reversible, same windows as before.

  Debug: ?panel=base|drops|grid|ramp|nogap, ?ramp=lime.
  Probe: window.__panel = { cols, rows, cell, gap, ramp, levels(),
  drops(), drawCount(), hash(), hashAt(t), tick() }.
*/

/* ---------- seed & driver ---------- */
const SEED = 0x9e37;
const TICK_MS = 33.3;            /* discrete step; catch-up capped below */
const MAX_CATCHUP = 5;

/* ---------- grid (today's values, integer device px) ---------- */
const COLUMNS_PER_WIDTH = 17;    /* ~110 columns at 1878px — today's */
const COLUMNS_MIN = 36;
const COLUMNS_MAX = 120;

/* ---------- base field (today's character) ---------- */
const FIELD_SCALE = 0.22;        /* noise frequency in cells⁻¹ (≈4.5-cell features) */
const FIELD_DRIFT = 0.9;         /* cells/s downward */
const OCTAVES = 3;
const OCTAVE_GAINS = [0.62, 0.24, 0.14]; /* low-freq dominant: neighbor deltas stay small */
/* thresholds quantize I∈[0,1] to levels 0-5; calibrated for ~60% lit */
const THRESH = [0.455, 0.555, 0.645, 0.725, 0.80];
const HYST = 0.03;               /* hysteresis band against border flicker */

/* ---------- drops (today's density/speed/trail) ---------- */
const DUTY = 0.34;               /* fraction of columns holding a live thread */
const P_CHOICES = [2, 3, 4, 6];  /* ticks per cell step */
const P_WEIGHTS = [0.72, 0.18, 0.06, 0.04]; /* heavy on p=2: closest to today's 16 cells/s */
const TRAIL_MIN = 10;            /* cells */
const TRAIL_MAX = 24;
const MIN_GAP_CELLS = 4;         /* between two drops of the same column */

/* ---------- scroll layers (unchanged windows) ---------- */
const WAVE_JITTER = 3;           /* cells of per-column front irregularity */
const SWEEP_JITTER = 4;

/* ---------- palette: computed once, stored literal (OKLCH, H 142.8) ----------
   0 off · 1-5 body (dark→light) · 6 head. Ladder: L 0.11→0.90, chroma
   capped to gamut per level. off = 1.16:1 against the void. */
const RAMP_GREEN = ['#050f06', '#023902', '#036105', '#048c07', '#04ba0a', '#02ea0e', '#b8ffb2'];
const RAMP_LIME = ['#081301', '#1e3502', '#365b02', '#518402', '#6daf01', '#8bdc12', '#c9ff9a'];
const COLOR_BG = '#070210';      /* the hero's void token — exact gap color */
const COLOR_LIME = '#9df133';    /* the lime scene's exact backdrop */

/* ---------- gap ---------- */
const GAP_RATIO = 0.06;          /* of cellDev, min 1 device px */

/* ---------- reduced motion ---------- */
const REDUCED_TICK_SCALE = 0;    /* frame frozen: pure static board */

/* deterministic PRNG (mulberry32) + hashes */
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
/* 3-octave value noise — the field I(x, y, t) */
function field(ix: number, iy: number, tSec: number): number {
  const dy = tSec * FIELD_DRIFT;
  let f = 0, fx = ix * FIELD_SCALE, fy = (iy + dy) * FIELD_SCALE;
  for (let o = 0; o < OCTAVES; o++) {
    const xi = Math.floor(fx), yi = Math.floor(fy);
    const xf = fx - xi, yf = fy - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash2(xi, yi), b2 = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
    f += OCTAVE_GAINS[o] * (a + (b2 - a) * u + (c - a) * v + (a - b2 - c + d) * u * v);
    fx *= 2.13; fy *= 2.13;
  }
  return f / 0.985; /* normalize to [0,1] */
}

/* quantize with hysteresis around the previous level */
function quantize(I: number, prev: number): number {
  /* candidate without hysteresis */
  let lv = 0;
  while (lv < 5 && I > THRESH[lv]) lv++;
  /* hysteresis: resist leaving prev by HYST */
  if (lv > prev && I < THRESH[prev] + HYST && prev < 5) lv = prev;
  else if (lv < prev && I > THRESH[Math.max(0, prev - 1)] - HYST) lv = prev;
  return lv;
}

/* one column's drop schedule — deterministic per (seed, col) */
interface Drop {
  id: number; col: number; head: number; trail: number; p: number; startTick: number;
}
function columnPlan(col: number, rows: number) {
  const rnd = mulberry32(SEED ^ Math.imul(col + 1, 2654435761));
  let w = rnd();
  let pi = 0, acc = P_WEIGHTS[0];
  while (w > acc && pi < P_CHOICES.length - 1) { pi++; acc += P_WEIGHTS[pi]; }
  const p = P_CHOICES[pi];
  const trail = TRAIL_MIN + Math.floor(rnd() * (TRAIL_MAX - TRAIL_MIN + 1));
  /* cycle: (rows+trail) active ticks-worth, then idle to satisfy DUTY */
  const activeSteps = rows + trail;
  const idleSteps = Math.max(MIN_GAP_CELLS, Math.round(activeSteps * (1 / DUTY - 1)));
  const cycle = (activeSteps + idleSteps) * p;
  const phase = Math.floor(rnd() * cycle);
  return { p, trail, cycle, phase };
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
  const RAMP = (useLimeRamp ? RAMP_LIME : RAMP_GREEN).map((h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]);
  const BG = [7, 2, 16]; /* #070210 */
  const LIME = [parseInt(COLOR_LIME.slice(1, 3), 16), parseInt(COLOR_LIME.slice(3, 5), 16), parseInt(COLOR_LIME.slice(5, 7), 16)];

  const ctx = canvas.getContext('2d', { alpha: true })!;
  let ignite = 1, sweep = 0;
  let filmActive = false, ioVisible = true, hidden = document.hidden;
  let disposed = false, raf = 0;
  let drawCount = 0;

  /* grid — integer device cells anchored top-left */
  let cssW = 1, cssH = 1, cellDev = 17, gapDev = 1, cols = 0, rows = 0;
  let level = new Uint8Array(0);      /* the board (base ∪ drops) */
  let scratchA = new Uint8Array(0);   /* mode-pass buffer */
  const countTab = new Uint32Array(6);
  let plan: { p: number; trail: number; cycle: number; phase: number }[] = [];
  let t0 = performance.now();
  let tickCount = 0;
  let tickAcc = 0;

  function metrics() {
    const rect = canvas.getBoundingClientRect();
    cssW = Math.max(1, rect.width); cssH = Math.max(1, rect.height);
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const cssCell = cssW / Math.min(COLUMNS_MAX, Math.max(COLUMNS_MIN, Math.round(cssW / COLUMNS_PER_WIDTH)));
    cellDev = Math.max(3, Math.round(cssCell * dpr));
    gapDev = params.get('panel') === 'nogap' ? 0 : Math.max(1, Math.round(cellDev * GAP_RATIO));
    const W = Math.round(cssW * dpr), H = Math.round(cssH * dpr);
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    cols = Math.ceil(W / cellDev);
    rows = Math.ceil(H / cellDev);
    level = new Uint8Array(cols * rows);
    scratchA = new Uint8Array(cols * rows);
    plan = [];
    for (let c = 0; c < cols; c++) plan.push(columnPlan(c, rows));
    ctx.imageSmoothingEnabled = false;
  }

  /* pure: levels at a given tick (determinism core) */
  function computeLevels(tickN: number, withDrops: boolean, out: Uint8Array) {
    const tSec = tickN * TICK_MS / 1000;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        out[i] = quantize(field(c, r, tSec), out[i]);
      }
    }
    /* one mode pass over 3×3 + Lipschitz sweeps: octave-1 gradients can
       quantize to a 3-level jump between neighbours — the board must read
       as one coherent plate (still a pure function of the field) */
    const tmp = scratchA;
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
            counts[out[rr * cols + cc]]++;
          }
        }
        let best = out[r * cols + c], bestN = -1;
        for (let k = 0; k < 6; k++) if (counts[k] > bestN) { bestN = counts[k]; best = k; }
        tmp[r * cols + c] = best;
      }
    }
    out.set(tmp);
    /* Lipschitz |Δ|≤1 sweeps (forward then backward), two rounds */
    for (let round = 0; round < 2; round++) {
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const i = r * cols + c;
          let lo = 0, hi = 5;
          if (r > 0) { const v = out[i - cols]; if (v - 1 > lo) lo = v - 1; if (v + 1 < hi) hi = v + 1; }
          if (c > 0) { const v = out[i - 1]; if (v - 1 > lo) lo = v - 1; if (v + 1 < hi) hi = v + 1; }
          if (out[i] < lo) out[i] = lo;
          if (out[i] > hi) out[i] = hi;
        }
      }
      for (let r = rows - 1; r >= 0; r--) {
        for (let c = cols - 1; c >= 0; c--) {
          const i = r * cols + c;
          let lo = 0, hi = 5;
          if (r < rows - 1) { const v = out[i + cols]; if (v - 1 > lo) lo = v - 1; if (v + 1 < hi) hi = v + 1; }
          if (c < cols - 1) { const v = out[i + 1]; if (v - 1 > lo) lo = v - 1; if (v + 1 < hi) hi = v + 1; }
          if (out[i] < lo) out[i] = lo;
          if (out[i] > hi) out[i] = hi;
        }
      }
    }
    if (!withDrops) return;
    for (let c = 0; c < cols; c++) {
      const pl = plan[c];
      if (!pl) continue;
      const local = ((tickN - pl.phase) % pl.cycle + pl.cycle) % pl.cycle;
      const head = -pl.trail + Math.floor(local / pl.p);
      for (let d = 0; d <= pl.trail; d++) {
        const r = head - d;
        if (r < 0 || r >= rows) continue;
        const lv = d === 0 ? 6 : Math.max(0, 5 - Math.floor(((d - 1) * 5) / pl.trail));
        const i = r * cols + c;
        if (lv > out[i]) out[i] = lv;
      }
    }
  }

  /* drops snapshot for the probe */
  function dropsAt(tickN: number): Drop[] {
    const ds: Drop[] = [];
    for (let c = 0; c < cols; c++) {
      const pl = plan[c];
      const local = ((tickN - pl.phase) % pl.cycle + pl.cycle) % pl.cycle;
      const head = -pl.trail + Math.floor(local / pl.p);
      if (head >= -pl.trail && head - pl.trail <= rows) ds.push({ id: c, col: c, head, trail: pl.trail, p: pl.p, startTick: pl.phase });
    }
    return ds;
  }

  /* ---------- paint: one integer fillRect per drawn cell ---------- */
  let lastPaintTick = -1, lastPaintIgnite = -1, lastPaintSweep = -1;
  function paint(force = false) {
    if (!force && lastPaintTick === tickCount && lastPaintIgnite === ignite && lastPaintSweep === sweep) return;
    lastPaintTick = tickCount; lastPaintIgnite = ignite; lastPaintSweep = sweep;
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    drawCount = 0;
    if (mode === 'ramp') {
      /* 7 full-width bands */
      const bandH = Math.max(1, Math.floor(H / 7));
      for (let k = 0; k < 7; k++) {
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
    /* the plate is OPAQUE where developed: gap pixels carry the exact
       background color (read in-canvas, not through transparency). During
       ignition only the developed band is painted — the hero reads
       through above the front. */
    const maxWaveRow = ignite >= 0.9999 ? rows : Math.ceil(waveF + WAVE_JITTER + 1);
    ctx.fillStyle = bgHex;
    ctx.fillRect(0, 0, W, Math.min(H, maxWaveRow * cellDev)); /* substrate — not a cell write */
    for (let r = 0; r < rows; r++) {
      const y = r * cellDev;
      for (let c = 0; c < cols; c++) {
        /* scroll layers */
        if (sweep > 0.0001) {
          const sj = (hash2(c, 311) - 0.5) * 2 * SWEEP_JITTER;
          if (r < sweepF + sj) { ctx.fillStyle = limeHex; ctx.fillRect(c * cellDev, y, sz, sz); drawCount++; continue; }
        }
        if (ignite < 0.9999) {
          const jit = (hash2(c, 913) - 0.5) * 2 * WAVE_JITTER;
          const fd = waveF + jit - r;
          if (fd < 0) continue; /* ahead of the wave: transparent */
          const crest = fd < 1.5;
          ctx.fillStyle = RAMP_HEX[crest ? 6 : level[r * cols + c]];
          ctx.fillRect(c * cellDev, y, sz, sz); drawCount++;
          continue;
        }
        ctx.fillStyle = RAMP_HEX[mode === 'grid' ? 1 : level[r * cols + c]];
        ctx.fillRect(c * cellDev, y, sz, sz); drawCount++;
      }
    }
  }

  let lastComputedTick = -1;
  function frame(now: number) {
    raf = 0;
    if (disposed) return;
    const dt = now - t0;
    t0 = now;
    let ticked = false;
    if (!reduced) {
      tickAcc += Math.min(dt, TICK_MS * MAX_CATCHUP);
      while (tickAcc >= TICK_MS) { tickAcc -= TICK_MS; tickCount++; ticked = true; }
    }
    if (ticked || lastComputedTick !== tickCount) {
      lastComputedTick = tickCount;
      if (mode === 'drops') { level.fill(0); computeDropsOnly(level); }
      else computeLevels(tickCount, mode !== 'base' && mode !== 'grid' && mode !== 'ramp', level);
    }
    paint();
    if (filmActive && ioVisible && !hidden) raf = requestAnimationFrame(frame);
  }

  function computeDropsOnly(out: Uint8Array) {
    for (const d of dropsAt(tickCount)) {
      for (let dd = 0; dd <= d.trail; dd++) {
        const r = d.head - dd;
        if (r < 0 || r >= rows) continue;
        const lv = dd === 0 ? 6 : Math.max(0, 5 - Math.floor(((dd - 1) * 5) / d.trail));
        out[r * cols + d.col] = lv;
      }
    }
  }

  function kick() {
    if (!raf && filmActive && ioVisible && !hidden && !disposed) raf = requestAnimationFrame(frame);
  }

  /* ---------- wiring ---------- */
  const io = new IntersectionObserver(([e]) => { ioVisible = e.isIntersecting; kick(); }, { rootMargin: '100% 0%' });
  io.observe(canvas);
  const ro = new ResizeObserver(() => { metrics(); paint(true); });
  ro.observe(canvas);
  const onVis = () => { hidden = document.hidden; kick(); };
  document.addEventListener('visibilitychange', onVis);

  metrics();
  /* warm-up: deterministic half-screen of history — the first visible
     frame already has drops in flight, no pop-in, same on every load */
  tickCount = reduced ? 0 : Math.round(rows / 2);
  computeLevels(tickCount, mode !== 'base' && mode !== 'grid' && mode !== 'ramp', level);
  paint();

  /* ---------- probe ---------- */
  (window as unknown as { __panel?: Record<string, unknown> }).__panel = {
    get cols() { return cols; },
    get rows() { return rows; },
    get cell() { return cellDev; },
    get gap() { return gapDev; },
    get ramp() { return RAMP; },
    levels: () => level.slice(),
    drops: () => dropsAt(tickCount),
    drawCount: () => drawCount,
    hash: () => fnv(level),
    hashAt: (t: number) => { const s = new Uint8Array(cols * rows); computeLevels(t, true, s); return fnv(s); },
    tick: () => tickCount,
  };
  function fnv(arr: Uint8Array): number {
    let h = 2166136261;
    for (let i = 0; i < arr.length; i++) { h ^= arr[i]; h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  wall = {
    setIgnite(v) { ignite = Math.min(1, Math.max(0, v)); kick(); },
    setSweep(v) { sweep = Math.min(1, Math.max(0, v)); kick(); },
    setActive(on) { filmActive = on; kick(); },
    setTier() { /* single 2D pipeline — no tiers */ },
    histogram: () => {
      const buckets = [0, 0, 0, 0];
      for (let i = 0; i < level.length; i++) {
        const v = level[i];
        if (v === 0) buckets[0]++;
        else if (v <= 2) buckets[1]++;
        else if (v <= 4) buckets[2]++;
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
