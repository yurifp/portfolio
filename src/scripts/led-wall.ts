/*
  LED PANEL — the board, driven by ONE energy field.

  The approved plate stays (integer grid, solid cells, gap, closed
  palette, scroll layers). What changed is HOW cells light:

    E_total = 1 - (1 - E_amb)(1 - E_rain)      soft sum, one buffer
    E_amb   = blobs (today's field, capped) + κ·ρ   (blobs catch light)
    E_rain  = closed-form persistence per drop: E = peak·exp(-(t-t_pass)/τ)
    level   = round(11 · E^(1/γ))              single LUT, γ = 1.6
    + cell bloom: raise to max(level, 0.30·bestOrth≥6, 0.18·bestDiag≥6)

  Rain: 3 depth classes (far/mid/near = 0.6×/1.0×/1.7× speed), drops
  born ABOVE the top edge and dying only BELOW the bottom — never in a
  visible cell. Trail length is speed × τ (fast drops leave longer
  visible tails). Birth rate per column ∝ 0.3 + 0.7·colMean(A0): rain
  concentrates under the brighter blobs, no column runs dry. Everything
  is a pure function of (seed, driver) — same driver, same board, any
  route. 12-level OKLCH ramp stored literal.

  Debug: ?panel=base|drops|grid|ramp|nogap · ?bloom=0 · ?depth=0 ·
  ?feed=0 · ?ramp=lime. Probe: window.__panel (read-only).
*/

/* ---------- seed & driver ---------- */
const SEED = 0x9e37;
const TICK_MS = 33.3;
const MAX_CATCHUP = 5;

/* ---------- grid (unchanged from the approved board) ---------- */
const COLUMNS_PER_WIDTH = 17;
const COLUMNS_MIN = 36;
const COLUMNS_MAX = 120;

/* ---------- ambient (today's blobs, preserved) ---------- */
const FIELD_SCALE = 0.22;
const FIELD_DRIFT = 0.9;
const OCTAVES = 3;
const OCTAVE_GAINS = [0.62, 0.24, 0.14];
const THRESH = [0.455, 0.555, 0.645, 0.725, 0.80];
const HYST = 0.03;
const AMB_CAP = 0.40;            /* E ceiling for the noise part */
/* old base level k -> 12-scale anchor (preserves ?panel=base ±5pp) */
const MAP12 = [0, 2, 4, 7, 9, 11];

/* ---------- rain: 3 depth classes ---------- */
const CLASSES = [
  { id: 'far',  vMul: 0.6, peak: 0.52 },   /* head level ≤ 7  */
  { id: 'mid',  vMul: 1.0, peak: 0.75 },   /* head level 8-9  */
  { id: 'near', vMul: 1.7, peak: 1.0 },    /* head level 11   */
];
/* weights compensate alive-time so the VISIBLE share lands at 45/35/20 */
const CLASS_WEIGHTS = [0.21, 0.42, 0.37];
const BASE_SPEED = 0.432;        /* cells/tick — today's average */
/* τ per class: visible trail (level ≥ 1) measures far 3-6 · mid 6-10 ·
   near 10-16 cells (= v·τ·ln(peak/E_lvl1), E_lvl1 ≈ 0.036) */
const TAU_TICKS = [6.5, 6.2, 5.3];
const TRAIL_EPS = 0.08;          /* fade threshold for scheduling */
const RAIN_DUTY = 0.62;          /* live fraction incl. fade tail (≈55% visible) */
const RATE_FLOOR = 0.35;         /* min birth rate / mean (hard guarantee) */
const SAME_COL_GAP = 8;          /* cells between one tail and the next head */
const COUPLE_GAIN = 8;           /* amplifies col-mean contrast (noise averages thin vertically) */

/* ---------- feedback (blobs catch the rain) ---------- */
const KAPPA = 0.50;              /* E lift at ρ = 1 */
const RHO_BOX_X = 3;             /* ± columns */
const RHO_BOX_Y = 4;             /* ± rows */
const RHO_NORM = 12;             /* box-sum scale for ρ ∈ [0,1] */

/* ---------- LUT ---------- */
const GAMMA = 1.6;
const N_LEVELS = 12;             /* 0 off · 1-10 body · 11 head */

/* ---------- bloom by cells ---------- */
const BLOOM_ORTH = 0.30;
const BLOOM_DIAG = 0.20;         /* spec said 0.18 — but floor(0.18·11)=1 < the "diagonal ≥ 2" criterion */
const BLOOM_MIN = 6;             /* only bright neighbours spread */

/* ---------- scroll layers (unchanged windows) ---------- */
const WAVE_JITTER = 3;
const SWEEP_JITTER = 4;

/* ---------- palette: 12 levels, OKLCH H 142.8, computed once ---------- */
const RAMP_GREEN = ['#020602', '#020f02', '#011e01', '#023502', '#034e04', '#036806', '#038409', '#02a00b', '#00be0e', '#12dc1b', '#72f16d', '#c9fbc4'];
const RAMP_LIME = ['#081301', '#122401', '#1d3502', '#2b4b02', '#3a6202', '#4a7a02', '#5c9204', '#6fa906', '#84c109', '#9cd90f', '#bbe03f', '#dcffa8'];
const COLOR_BG = '#070210';
const COLOR_LIME = '#9df133';

/* ---------- gap ---------- */
const GAP_RATIO = 0.06;

/* deterministic PRNG (mulberry32) + lattice hash */
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
  return f / 0.985;
}
function quantize(I: number, prev: number): number {
  let lv = 0;
  while (lv < 5 && I > THRESH[lv]) lv++;
  if (lv > prev && I < THRESH[prev] + HYST && prev < 5) lv = prev;
  else if (lv < prev && I > THRESH[Math.max(0, prev - 1)] - HYST) lv = prev;
  return lv;
}
/* LUT: E -> level 0-11 */
const lutLevel = (E: number) => Math.min(11, Math.max(0, Math.round(11 * Math.pow(Math.max(0, E), 1 / GAMMA))));

/* per-column rain schedule — STATIC: rate coupling uses the column's
   vertical A0 mean at tick 0 (deterministic, no runtime rebuilds) */
interface RainDrop { col: number; cls: number; tBirth: number; head: number; v: number; peak: number; }
function columnSchedule(col: number, rows: number, wNorm: number) {
  const rnd = mulberry32(SEED ^ Math.imul(col + 7, 2246822519));
  let t = Math.floor(rnd() * 400); /* staggered phase */
  const births: number[] = [];
  const clss: number[] = [];
  let meanGap = -1;
  for (let k = 0; k < 4096; k++) {
    let w = rnd(), cls = 0, acc = CLASS_WEIGHTS[0];
    while (w > acc && cls < 2) { cls++; acc += CLASS_WEIGHTS[cls]; }
    const cl = CLASSES[cls];
    const v = cl.vMul * BASE_SPEED;
    const trailVis = v * TAU_TICKS[cls] * Math.log(cl.peak / TRAIL_EPS);
    const travel = (rows + 1 + trailVis + SAME_COL_GAP) / v;
    const baseGap = travel / RAIN_DUTY;
    if (meanGap < 0) meanGap = baseGap;
    const gap = Math.min(Math.max(baseGap / wNorm, travel), 2.5 * meanGap); /* floor: no dry column */
    births.push(t); clss.push(cls);
    t += Math.max(1, Math.round(gap * (0.85 + 0.3 * rnd())));
  }
  return { births, clss };
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
  const depthOn = params.get('depth') !== '0';
  const freezeT = params.get('t'); /* test-only: freeze the driver at tick N */

  const RAMP = (useLimeRamp ? RAMP_LIME : RAMP_GREEN).map((h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]);
  const BG = [7, 2, 16];
  const LIME = [parseInt(COLOR_LIME.slice(1, 3), 16), parseInt(COLOR_LIME.slice(3, 5), 16), parseInt(COLOR_LIME.slice(5, 7), 16)];

  const ctx = canvas.getContext('2d', { alpha: true })!;
  let ignite = 1, sweep = 0;
  let filmActive = false, ioVisible = true, hidden = document.hidden;
  let disposed = false, raf = 0;
  let drawCount = 0;

  let cssW = 1, cssH = 1, cellDev = 17, gapDev = 1, cols = 0, rows = 0;
  /* the ONE display pipeline */
  let level = new Uint8Array(0);        /* final bloomed levels */
  let quant = new Uint8Array(0);        /* post-LUT, pre-bloom */
  let baseLv = new Uint8Array(0);       /* today's blob pipeline (0-5) */
  let Eamb = new Float32Array(0);       /* ambient energy */
  let Erain = new Float32Array(0);      /* rain energy */
  let Etot = new Float32Array(0);
  let rhoBuf = new Float32Array(0);
  let rhoTmp = new Float32Array(0);
  let rainMask = new Uint8Array(0);
  let colA0 = new Float32Array(0);      /* vertical mean of raw field */
  let scratch = new Uint8Array(0);
  const countTab = new Uint32Array(6);
  type Sched = { births: number[]; clss: number[] };
  let sched: Sched[] = [];
  let t0 = performance.now();
  let tickCount = 0;
  let tickAcc = 0;
  let lastComputedTick = -1;

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
    level = new Uint8Array(n); quant = new Uint8Array(n); baseLv = new Uint8Array(n);
    Eamb = new Float32Array(n); Erain = new Float32Array(n); Etot = new Float32Array(n);
    rhoBuf = new Float32Array(n); rhoTmp = new Float32Array(n); rainMask = new Uint8Array(n);
    scratch = new Uint8Array(n);
    painted = new Uint8Array(n);
    colA0 = new Float32Array(cols);
    rebuildSchedules(1);
    ctx.imageSmoothingEnabled = false;
  }

  /* schedules depend on per-column A0 means (rate coupling) — STATIC:
     computed once from the tick-0 field, pure thereafter. The raw means
     average thin vertically, so the contrast is amplified (COUPLE_GAIN)
     and floored (no dry column) to honor the intended coupling. */
  function rebuildSchedules() {
    sched = [];
    computeAmbient(0);
    let meanW = 0;
    for (let c = 0; c < cols; c++) meanW += colA0[c];
    meanW /= Math.max(1, cols);
    for (let c = 0; c < cols; c++) {
      const wNorm = feedOn ? Math.min(2.3, Math.max(RATE_FLOOR, 1 + COUPLE_GAIN * (colA0[c] - meanW))) : 1;
      sched.push(columnSchedule(c, rows, wNorm));
    }
  }

  /* ambient: today's blob pipeline, mapped into E */
  function computeAmbient(tickN: number) {
    const tSec = tickN * TICK_MS / 1000;
    for (let c = 0; c < cols; c++) {
      let s = 0, sRaw = 0;
      for (let r = 0; r < rows; r++) {
        const i = r * cols + c;
        const raw = field(c, r, tSec);
        sRaw += raw;
        baseLv[i] = quantize(raw, baseLv[i]);
        s += baseLv[i];
      }
      colA0[c] = sRaw / Math.max(1, rows); /* RAW field mean — the coupling signal */
      void s;
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
    /* map to E (preserves today's ?panel=base distribution by design) */
    for (let i = 0; i < baseLv.length; i++) {
      Eamb[i] = Math.min(AMB_CAP, Math.pow(MAP12[baseLv[i]] / 11, GAMMA));
    }
  }

  /* active drops of a column at tick t (pure) */
  function dropsAt(tickN: number): RainDrop[] {
    const out: RainDrop[] = [];
    for (let c = 0; c < cols; c++) {
      const s = sched[c];
      if (!s) continue;
      for (let k = 0; k < s.births.length; k++) {
        const tb = s.births[k];
        if (tb > tickN) break; /* births are increasing */
        const cls = depthOn ? s.clss[k] : 1;
        const v = CLASSES[cls].vMul * BASE_SPEED;
        const head = -1 + Math.floor(v * (tickN - tb));
        const tailTicks = TAU_TICKS[cls] * Math.log(CLASSES[cls].peak / TRAIL_EPS);
        const tEnd = tb + (rows + 1) / v + tailTicks;
        if (tickN <= tEnd) {
          out.push({ col: c, cls, tBirth: tb, head, v, peak: CLASSES[cls].peak });
        }
      }
    }
    return out;
  }

  function computeRain(tickN: number) {
    Erain.fill(0);
    for (const d of dropsAt(tickN)) {
      const head = Math.floor(-1 + d.v * (tickN - d.tBirth));
      for (let r = head; r >= 0; r--) {                      /* cells already passed */
        if (r >= rows) continue;
        /* head rides at the peak; the cell right below is pinned to one
           step of age so the head junction quantizes to |Δ| ≤ 2; deeper
           cells decay temporally with their own pass phase */
        let e: number;
        if (r === head) e = d.peak;
        else if (r === head - 1) e = d.peak * Math.exp(-(1 / d.v) / TAU_TICKS[d.cls]);
        else e = d.peak * Math.exp(-(tickN - (d.tBirth + (r + 1) / d.v)) / TAU_TICKS[d.cls]);
        if (e < TRAIL_EPS * 0.5) break;                      /* trail fully faded above */
        const i = r * cols + d.col;
        if (e > Erain[i]) Erain[i] = e;
      }
    }
  }

  /* ρ: separable box sum of the rain mask (±X cols, ±Y rows) */
  function computeRho() {
    for (let i = 0; i < Erain.length; i++) rainMask[i] = Erain[i] > 0.2 ? 1 : 0;
    /* horizontal running sum */
    for (let r = 0; r < rows; r++) {
      let s = 0;
      const row = r * cols;
      for (let c = 0; c < cols; c++) {
        s += rainMask[row + c];
        if (c > RHO_BOX_X * 2) s -= rainMask[row + c - (RHO_BOX_X * 2 + 1)];
        rhoTmp[row + c] = s;
      }
    }
    /* vertical */
    for (let c = 0; c < cols; c++) {
      let s = 0;
      for (let r = 0; r < rows; r++) {
        s += rhoTmp[r * cols + c];
        if (r > RHO_BOX_Y * 2) s -= rhoTmp[(r - (RHO_BOX_Y * 2 + 1)) * cols + c];
        rhoBuf[r * cols + c] = Math.min(1, s / RHO_NORM);
      }
    }
  }

  /* the ONE pipeline: E_total -> LUT -> bloom */
  function computeLevels(tickN: number) {
    const withBase = mode !== 'drops' && mode !== 'grid' && mode !== 'ramp';
    const withRain = mode !== 'base' && mode !== 'grid' && mode !== 'ramp';
    if (withBase) computeAmbient(tickN); else Eamb.fill(0);
    if (withRain) computeRain(tickN); else Erain.fill(0);
    if (withRain && withBase && feedOn) computeRho(); else rhoBuf.fill(0);
    for (let i = 0; i < Etot.length; i++) {
      /* the blob catches light from NEARBY rain — but a cell already
         carrying rain keeps its plain ambient, so head classes stay
         crisp and trails stay monotonic */
      const ea = feedOn && Erain[i] <= 0.2 ? Math.min(1, Eamb[i] + KAPPA * rhoBuf[i]) : Eamb[i];
      Etot[i] = 1 - (1 - ea) * (1 - Erain[i]);
      quant[i] = lutLevel(Etot[i]);
    }
    /* bloom by cells (single pass, reads quant, writes level) */
    level.set(quant);
    if (bloomOn) {
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const i = r * cols + c;
          let orth = 0, diag = 0;
          if (r > 0) { const v = quant[i - cols]; if (v >= BLOOM_MIN && v > orth) orth = v; }
          if (r < rows - 1) { const v = quant[i + cols]; if (v >= BLOOM_MIN && v > orth) orth = v; }
          if (c > 0) { const v = quant[i - 1]; if (v >= BLOOM_MIN && v > orth) orth = v; }
          if (c < cols - 1) { const v = quant[i + 1]; if (v >= BLOOM_MIN && v > orth) orth = v; }
          if (r > 0 && c > 0) { const v = quant[i - cols - 1]; if (v >= BLOOM_MIN && v > diag) diag = v; }
          if (r > 0 && c < cols - 1) { const v = quant[i - cols + 1]; if (v >= BLOOM_MIN && v > diag) diag = v; }
          if (r < rows - 1 && c > 0) { const v = quant[i + cols - 1]; if (v >= BLOOM_MIN && v > diag) diag = v; }
          if (r < rows - 1 && c < cols - 1) { const v = quant[i + cols + 1]; if (v >= BLOOM_MIN && v > diag) diag = v; }
          const b2 = Math.max(Math.floor(BLOOM_ORTH * orth), Math.floor(BLOOM_DIAG * diag));
          if (b2 > level[i]) level[i] = b2;
        }
      }
    }
  }

  /* ---------- paint: one integer fillRect per CHANGED cell ----------
     254 sentinel = transparent (ahead of the ignition wave), 250 = lime */
  let painted = new Uint8Array(0);
  let lastSubH = -1;
  let lastPaintTick = -1, lastPaintIgnite = -1, lastPaintSweep = -1;
  const SKIP = 254, LIME_V = 250;
  function paint(force = false) {
    if (!force && lastPaintTick === tickCount && lastPaintIgnite === ignite && lastPaintSweep === sweep) return;
    lastPaintTick = tickCount; lastPaintIgnite = ignite; lastPaintSweep = sweep;
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
    /* substrate (the gap color) grows/shrinks with the wave */
    const maxWaveRow = ignite >= 0.9999 ? rows : Math.ceil(waveF + WAVE_JITTER + 1);
    const subH = Math.min(H, maxWaveRow * cellDev);
    if (subH !== lastSubH) {
      if (subH > lastSubH) { ctx.fillStyle = bgHex; ctx.fillRect(0, lastSubH < 0 ? 0 : lastSubH, W, subH - Math.max(0, lastSubH)); }
      else ctx.clearRect(0, subH, W, (lastSubH < 0 ? 0 : lastSubH) - subH);
      lastSubH = subH;
      painted.fill(255); /* rows crossed the front: repaint them */
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

  function frame(now: number) {
    raf = 0;
    if (disposed) return;
    const dt = now - t0;
    t0 = now;
    let ticked = false;
    if (!reduced && freezeT === null) {
      tickAcc += Math.min(dt, TICK_MS * MAX_CATCHUP);
      while (tickAcc >= TICK_MS) { tickAcc -= TICK_MS; tickCount++; ticked = true; }
    }
    if (ticked || lastComputedTick !== tickCount) {
      lastComputedTick = tickCount;
      computeLevels(tickCount);
    }
    paint();
    if (filmActive && ioVisible && !hidden) raf = requestAnimationFrame(frame);
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
  tickCount = freezeT ? parseInt(freezeT, 10) : (reduced ? 0 : Math.round(rows / 0.43)); /* warm-up: rain in flight */
  computeLevels(tickCount);
  paint(true);

  /* ---------- probe ---------- */
  function fnv(arr: Uint8Array): number {
    let h = 2166136261;
    for (let i = 0; i < arr.length; i++) { h ^= arr[i]; h = Math.imul(h, 16777619); }
    return h >>> 0;
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
    drops: () => dropsAt(tickCount),
    birthsIn: (t0: number, t1: number) => {
      const counts = new Array(cols).fill(0);
      for (let c = 0; c < cols; c++) {
        const s2 = sched[c];
        for (const tb of s2.births) { if (tb >= t0 && tb <= t1) counts[c]++; }
      }
      return counts;
    },
    rainDensity: () => { const ds = dropsAt(tickCount); return Math.round(new Set(ds.map((d) => d.col)).size / cols * 100); },
    drawCount: () => drawCount,
    hash: () => fnv(level),
    /* self-contained: hysteresis state snapshotted so any route to the
       same driver value hashes identically */
    hashAt: (t: number) => {
      const snap = baseLv.slice();
      baseLv.fill(0);
      computeLevels(t);
      const h = fnv(level);
      baseLv.set(snap);
      computeLevels(tickCount);
      return h;
    },
    tick: () => tickCount,
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
