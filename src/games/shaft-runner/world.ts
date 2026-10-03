/*
  SHAFT RUNNER — world: the shaft, generated per (seed, row) with the
  invariants enforced BY CONSTRUCTION:
    1. gap ≥ minGap(s) = 36
    2. |c(i+1) − c(i)| ≤ slopeMax(s) = min(1, 0.6·70/v(s))
    3. slope × v ≤ 42 (same clamp)
  Rows are produced sequentially (the shaft only scrolls forward) and
  cached; chambers (+18) and passages (−10, floor 36) modulate the gap.
*/
import { STAGES, STAGE_ROWS } from './data';

export function mulberry32(a: number) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function stageOf(row: number): number {
  return Math.min(6, Math.floor(row / STAGE_ROWS) + 1);
}
export function stageCfg(s: number) {
  return STAGES[Math.min(5, s - 1)];
}
export function slopeMax(s: number): number {
  return Math.min(1, (0.6 * 70) / stageCfg(s).v);
}

export interface WallRow { l: number; r: number; chamber: number }

/* lattice value noise over row index, per stage+seed */
function lattice(seed: number, stage: number, i: number): number {
  let h = Math.imul(i ^ 0x9e37, 374761393) + Math.imul(stage ^ seed, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(seed: number, stage: number, x: number): number {
  const xi = Math.floor(x), xf = x - xi;
  const u = xf * xf * (3 - 2 * xf);
  const a = lattice(seed, stage, xi), b = lattice(seed, stage, xi + 1);
  return a + (b - a) * u;
}

export class Shaft {
  private rows: WallRow[] = [];
  constructor(private seed: number) {}
  at(row: number): WallRow {
    if (row < 0) row = 0;
    while (this.rows.length <= row) this.gen(this.rows.length);
    return this.rows[row];
  }
  private gen(i: number) {
    const s = stageOf(i);
    const cfg = stageCfg(s);
    const local = i % STAGE_ROWS;
    /* per-stage amplitude/wavelength */
    const A = 8 + s * 3;          /* 11..26 px */
    const lam = 34 - s * 2;       /* 32..24 rows per lattice cell */
    const target = 54 + A * 2 * (vnoise(this.seed, s, local / lam) - 0.5);
    const prev = this.rows.length ? this.rows[this.rows.length - 1] : null;
    const sm = Math.max(0.05, slopeMax(s) - 0.55); /* rounding headroom: the ROUNDED l/r must satisfy the invariant */
    const prevC = prev ? (prev.l + prev.r) / 2 : 54;
    const prevGap = prev ? prev.r - prev.l : cfg.gapBase;
    let c = prev ? Math.max(prevC - sm, Math.min(prevC + sm, target)) : 54;
    /* chamber / passage modulation (slow second noise), SMOOTHED ±2/row
       so walls never jump — invariant 2 holds by construction */
    const mod = vnoise(this.seed, s + 97, local / (lam * 2.4));
    const chamber = mod > 0.62 ? 1 : mod < 0.34 ? -1 : 0;
    const wantGap = Math.max(36, cfg.gapBase + (chamber > 0 ? 18 : chamber < 0 ? -10 : 0));
    const gap = Math.max(36, Math.min(prevGap + 2, Math.max(prevGap - 2, wantGap)));
    /* c must satisfy BOTH: |Δc| ≤ sm (invariant 2) AND inside walls */
    const half = gap / 2;
    const lo = Math.max(prevC - sm, 1 + half);
    const hi = Math.min(prevC + sm, 107 - half);
    if (lo <= hi) c = Math.max(lo, Math.min(hi, c));
    else c = (lo + hi) / 2; /* degenerate row (gap growing at the wall edge) */
    const l = Math.round(c - half), r = Math.round(c + half);
    this.rows.push({ l, r, chamber });
  }
  reset(seed: number) {
    this.seed = seed;
    this.rows = [];
  }
}

/* property check used by the verification suite (runs in-page) */
export function checkWorld(seeds: number, maxRows: number): { worstGap: number; worstSlope: number; violations: number } {
  let worstGap = 1e9, worstSlope = 0, violations = 0;
  for (let s = 0; s < seeds; s++) {
    const shaft = new Shaft(0x5157 + s * 7919);
    let prevC = 54;
    for (let i = 0; i < maxRows; i++) {
      const st = stageOf(i);
      const w = shaft.at(i);
      const gap = w.r - w.l;
      const c = (w.l + w.r) / 2;
      const slope = Math.abs(c - prevC);
      prevC = c;
      if (gap < 36) violations++;
      if (gap < worstGap) worstGap = gap;
      if (slope > slopeMax(st) + 1e-9) violations++;
      if (slope > worstSlope) worstSlope = slope;
    }
  }
  return { worstGap, worstSlope: +worstSlope.toFixed(4), violations };
}
