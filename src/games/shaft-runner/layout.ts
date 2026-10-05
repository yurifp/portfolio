/*
  SHAFT RUNNER — LAYOUT (the single source of screen geometry).
  Logical canvas: 216×384 cells (9:16). The world stays 108×192 units;
  every world unit renders as 2×2 cells (finer fresta, finer fonts).

  Three bands, in logical cells:
    TOP    y 0..30    (7.8%)  — HUD: labels row + values row
    FIELD  y 30..340  (80.7%) — play field, 1-cell frame, no fixed HUD
    BOTTOM y 340..384 (11.5%) — HUD: FUEL (dominant), BOMBS, LIVES,
                                 RESERVED slots (DASH / GRAZE / WPN)
*/

export const LOGICAL = { w: 216, h: 384 } as const;

export const BANDS = {
  top: { y0: 0, y1: 30 },
  field: { y0: 30, y1: 340 },
  bottom: { y0: 340, y1: 384 },
} as const;

/* integer scale: prefer even scales (sprite 2×2 blocks land cleanly) */
export function calcScale(availWdev: number, availHdev: number): number {
  const raw = Math.round(Math.min(availWdev / LOGICAL.w, availHdev / LOGICAL.h));
  const s = Math.max(2, raw);
  return s % 2 === 0 ? s : s - 1;
}

/* HUD element boxes (logical cells) — used by the renderer AND the
   layout lint (zero intersections, zero field intrusion) */
export const HUD = {
  top: {
    scoreLabel: { x: 6, y: 3, w: 29, h: 7 },
    scoreValue: { x: 6, y: 13, w: 47, h: 9 },
    stageLabel: { x: 88, y: 3, w: 35, h: 7 },
    stageValue: { x: 94, y: 13, w: 15, h: 9 },
    comboValue: { x: 118, y: 13, w: 15, h: 9 },
    comboBar: { x: 118, y: 24, w: 15, h: 2 },
    hiLabel: { x: 178, y: 3, w: 15, h: 7 },
    hiValue: { x: 163, y: 13, w: 47, h: 9 },
  },
  bottom: {
    fuelLabel: { x: 6, y: 343, w: 23, h: 7 },
    fuelBar: { x: 40, y: 343, w: 141, h: 12 },
    fuelPct: { x: 188, y: 342, w: 24, h: 9 },
    bombLabel: { x: 6, y: 361, w: 23, h: 7 },
    bombIcons: { x: 34, y: 359, w: 39, h: 10 },
    lifeLabel: { x: 80, y: 361, w: 17, h: 7 },
    lifeIcons: { x: 102, y: 358, w: 34, h: 9 },
    resDash: { x: 142, y: 358, w: 22, h: 20 },
    resGraze: { x: 166, y: 358, w: 22, h: 20 },
    resWpn: { x: 190, y: 358, w: 22, h: 20 },
  },
} as const;

/* text width for the 5×7 font at scale k (5 dot + 1 space per char) */
export const textW = (t: string, k: number) => Math.max(0, t.length * 6 * k - k);
/* 7×9 numbers font: 7 dot + 1 space per char */
export const numW = (t: string, k = 1) => Math.max(0, t.length * 8 * k - k);
