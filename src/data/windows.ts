/*
  WINDOWS — the three boxes over the LED panel (scene "led").
  Geometry mirrors the 12-col axis grid (same --gutter / --rail-lane);
  all values are inputs to the shell's layout math, nothing hardcoded
  downstream. Swap roles here later without touching the shell.
*/
export interface WinCfg {
  id: 'w1' | 'w2' | 'w3';
  title: string;
  role: 'game' | 'terminal' | 'telemetry';
  /** column span [from, to] on the 12-col axis; null = centered on 50vw */
  cols: [number, number] | null;
  /** wide-col span for ≥1700px (only if different) */
  colsWide?: [number, number];
  topVh: number;
  maxHVh: number;
  /** open window inside the led scene (local progress, 0–1) */
  openAt: number;
  openDur: number;
  stateLabel: string;
}

export const WINDOWS: WinCfg[] = [
  {
    id: 'w1',
    title: 'YF.CLI v1.0 · SHAFT RUNNER',
    role: 'game',
    cols: null,
    topVh: 13,
    maxHVh: 80,
    openAt: 0.442,
    openDur: 0.155,
    stateLabel: 'CLICK TO PLAY',
  },
  {
    id: 'w2',
    title: 'TERMINAL · yf@portfolio',
    role: 'terminal',
    cols: [1, 3],
    colsWide: [1, 4],
    topVh: 17,
    maxHVh: 38,
    openAt: 0.310,
    openDur: 0.155,
    stateLabel: 'ONLINE',
  },
  {
    id: 'w3',
    title: 'TELEMETRY · LIVE',
    role: 'telemetry',
    cols: [10, 12],
    colsWide: [9, 12],
    topVh: 46,
    maxHVh: 36,
    openAt: 0.574,
    openDur: 0.155,
    stateLabel: 'ONLINE',
  },
];

/* led-scene timeline (local progress 0–1):
   wave 0–0.30 · open seq 0.310–0.729 (35% each, 15% overlap)
   · plateau 0.729–0.955 (67.8vh ≥ 60vh) · exit 0.955–1.00 (fast reverse) */
export const LED_EXIT_AT = 0.955;
