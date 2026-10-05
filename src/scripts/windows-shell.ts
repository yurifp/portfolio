/*
  WINDOWS SHELL — geometry + scroll-scrub for the three boxes over the
  LED panel. The open state is a PURE function of the led-scene local
  progress (same capture by any route); the plateau hands
  pointer-events to the windows; ?debug=layout outlines them, ?crt=0
  kills the CRT skin.
*/
import { WINDOWS, LED_EXIT_AT } from '../data/windows';
import { calcScale } from '../games/shaft-runner/layout';
import { sceneStart, sceneLen } from './scenes';

const LED_START = sceneStart('led');
const LED_LEN = sceneLen('led');
const params = new URL(location.href).searchParams;
if (params.get('crt') === '0') document.documentElement.classList.add('crt-off');
if (params.get('debug') === 'layout') document.documentElement.classList.add('debug-layout');

interface WinEls { root: HTMLElement; title: HTMLElement; label: HTMLElement; level: HTMLElement[]; expand: HTMLElement }
const els = new Map<string, WinEls>();
let liveRegion: HTMLElement | null = null;

/* ---------- geometry (12-col axis mirror, same tokens) ---------- */
interface Rect { left: number; top: number; width: number; height: number }
const rects = new Map<string, Rect>();

function gridMetrics() {
  /* the CSS custom props hold clamp() tokens — getComputedStyle returns
     them unsubstituted, so replicate the clamp math here (single source
     of truth remains the CSS; the formulas mirror it 1:1) */
  const vw = innerWidth, vh = innerHeight;
  const gutter = Math.max(16, Math.min(44, vw * 0.016));
  const rail = Math.max(28, Math.min(56, vw * 0.024));
  const colGap = Math.max(12, Math.min(32, vw * 0.012));
  const inner = vw - gutter - (gutter + rail);
  const colW = (inner - 11 * colGap) / 12;
  return { gutter, rail, colGap, colW, inner, vw, vh };
}

function colX(c: number, g: { gutter: number; colGap: number; colW: number }) {
  return g.gutter + (c - 1) * (g.colW + g.colGap);
}

function layout() {
  const g = gridMetrics();
  const wide = innerWidth >= 1700;
  const mobile = innerWidth < 1200;
  for (const w of WINDOWS) {
    if (mobile && w.id !== 'w1') { rects.set(w.id, { left: -9999, top: 0, width: 0, height: 0 }); continue; }
    let left: number, width: number;
    if (w.cols && !mobile) {
      const span = (wide && w.colsWide) ? w.colsWide : w.cols;
      left = colX(span[0], g);
      const right = colX(span[1], g) + g.colW;
      width = right - left;
    } else {
      /* W1: portrait — fixed chrome (titlebar 28 + hints 24); the scale
         comes from the height budget; the canvas then fills the screen
         1:1 device (fitCanvas reads root.dataset.scale) */
      const dpr = Math.min(devicePixelRatio || 1, 3);
      const s = calcScale(216 * 20, Math.max(320, g.vh * 0.9 - 52) * dpr);
      const screenW = (216 * s) / dpr, screenH = Math.min((384 * s) / dpr, g.vh - 128);
      width = screenW + 2;
      const height = 52 + screenH + 2;
      left = g.vw / 2 - width / 2;
      rects.set(w.id, { left, top: Math.max(40, (g.vh - height) * 0.42), width, height });
      els.get(w.id)!.root.dataset.scale = String(s);
      continue;
    }
    const height = w.cols && !mobile
      ? Math.min(w.maxHVh / 100 * g.vh, g.vh - (w.topVh / 100 * g.vh) - (8 / 100 * g.vh))
      : Math.min(w.maxHVh / 100 * g.vh, g.vh - (w.topVh / 100 * g.vh) - (4 / 100 * g.vh));
    rects.set(w.id, { left, top: w.topVh / 100 * g.vh, width, height });
  }
  for (const [id, r] of rects) {
    const e = els.get(id);
    if (!e) continue;
    e.root.style.left = `${Math.round(r.left)}px`;
    e.root.style.top = `${Math.round(r.top)}px`;
    e.root.style.width = `${Math.round(r.width)}px`;
    e.root.style.height = `${Math.round(r.height)}px`;
    e.root.style.display = (mobile && id !== 'w1') ? 'none' : '';
  }
}

/* ---------- pure scrub: window state = f(led-local p) ---------- */
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

function windowState(w: { openAt: number; openDur: number }, P: number): number {
  /* open q, then fast reverse exit at scene end */
  if (P >= LED_EXIT_AT) return clamp01(1 - (P - LED_EXIT_AT) / (1 - LED_EXIT_AT));
  return clamp01((P - w.openAt) / w.openDur);
}

const CHAMFER = 10;

function applyOpen(el: WinEls, q: number) {
  const root = el.root;
  if (q <= 0) {
    root.classList.add('is-hidden');
    root.classList.remove('is-live');
    root.setAttribute('aria-hidden', 'true');
    return;
  }
  root.classList.remove('is-hidden');
  const r = rects.get(root.dataset.win as string);
  const W = r?.width || 300, H = r?.height || 400;
  const chW = (CHAMFER / W) * 100, chH = (CHAMFER / H) * 100;
  const chamferPoly = `${chW.toFixed(3)}% 0, 100% 0, 100% ${(100 - chH).toFixed(3)}%, ${(100 - chW).toFixed(3)}% 100%, 0 100%, 0 ${chH.toFixed(3)}%`;
  if (q < 0.25) {
    /* phase 1: 1-cell bright line draws center → edges */
    const sx = clamp01(q / 0.25);
    const lineH = (2 / H) * 100;
    const halfW = (1 - sx) * 50;
    root.style.clipPath = `polygon(${halfW.toFixed(3)}% ${50 - lineH / 2}%, ${(100 - halfW).toFixed(3)}% ${50 - lineH / 2}%, ${(100 - halfW).toFixed(3)}% ${50 + lineH / 2}%, ${halfW.toFixed(3)}% ${50 + lineH / 2}%)`;
  } else {
    /* phase 2: opens vertically to the full chamfered box */
    const v = clamp01((q - 0.25) / 0.35);
    if (v < 1) {
      const halfH = (1 - v) * 50;
      root.style.clipPath = `polygon(0% ${halfH.toFixed(3)}%, 100% ${halfH.toFixed(3)}%, 100% ${(100 - halfH).toFixed(3)}%, 0% ${(100 - halfH).toFixed(3)}%)`;
    } else {
      root.style.clipPath = `polygon(${chamferPoly})`;
    }
  }
  /* phase 3 (0.45–0.75): title letters */
  const t = clamp01((q - 0.45) / 0.30);
  const text = el.title.dataset.full || '';
  el.title.textContent = text.slice(0, Math.ceil(t * text.length));
  /* interactivity at q ≥ 0.98 (exit reverses below 1) */
  const live = q >= 0.98;
  root.classList.toggle('is-live', live);
  root.setAttribute('aria-hidden', live ? 'false' : 'true');
}

/* splash dither resolution: coarse→fine with q (discrete steps only) */
const SPLASH_STEPS = [14, 10, 7, 5, 3];

export function mountWindows(container: HTMLElement) {
  liveRegion = document.createElement('div');
  liveRegion.setAttribute('aria-live', 'polite');
  liveRegion.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);';
  container.appendChild(liveRegion);

  /* hooks for the host (registered before mountGameHost runs) */
  (window as unknown as Record<string, unknown>).__windowsProbe = windowsProbe;
  (window as unknown as Record<string, unknown>).__setTermEl = setTermEl;
  (window as unknown as Record<string, unknown>).__setSplashEl = setSplashEl;

  for (const w of WINDOWS) {
    const root = container.querySelector<HTMLElement>(`[data-win="${w.id}"]`)!;
    const title = root.querySelector<HTMLElement>('[data-win-title]')!;
    title.dataset.full = w.title;
    title.textContent = '';
    els.set(w.id, {
      root, title,
      label: root.querySelector('[data-win-label]')!,
      level: [...root.querySelectorAll('.win-level i')] as HTMLElement[],
      expand: root.querySelector('[data-win-expand]')!,
    });
    els.get(w.id)!.label.textContent = w.stateLabel;
    els.get(w.id)!.root.dataset.stateText = w.stateLabel;
  }
  layout();
}

export function announce(msg: string) { if (liveRegion) liveRegion.textContent = msg; }

/* one scrub step: P = led-local progress (pure) */
export function scrubWindows(P: number) {
  for (const w of WINDOWS) {
    const el = els.get(w.id);
    if (!el) continue;
    applyOpen(el, windowState(w, P));
    const q = windowState(w, P);
    if (w.id === 'w2') scrubTerm(q);
    if (w.id === 'w1') scrubSplash(clamp01((q - 0.60) / 0.40));
  }
}

/* ---------- W2 terminal (boot lines = pure f of q) ---------- */
const BOOT = (cols: number, rows: number) => [
  'YF·BIOS v1.0 — 640K OK',
  'mounting /var/www/portfolio ........ OK',
  `linking led-panel [${cols}×${rows} cells] ... OK`,
  'loading shaft-runner.bin ........... OK',
  'warming up the phosphor ............ WARM',
  'READY — click the game screen to play',
];

let termEl: HTMLElement | null = null;
let termEventLines: Array<{ ts: string; text: string }> = [];
let termShown = -1;

export function bootLinesText(): string[] {
  const pn = (window as unknown as { __panel?: { cols: number; rows: number } }).__panel;
  return BOOT(pn?.cols ?? 111, pn?.rows ?? 56);
}

function scrubTerm(q: number) {
  if (!termEl) return;
  const lines = bootLinesText();
  const n = Math.floor(clamp01((q - 0.60) / 0.40) * lines.length);
  if (n === termShown) return;
  termShown = n;
  renderTerm(lines.slice(0, n));
}

function renderTerm(boot: string[]) {
  if (!termEl) return;
  const all = [...boot.map((t) => ({ ts: '', text: t })), ...termEventLines];
  const buf = all.slice(-200);
  termEl.innerHTML = buf.map((l) => l.ts ? `<div><span class="ts">${l.ts}</span>${l.text}</div>` : `<div>${l.text}</div>`).join('');
}

export function termEmit(text: string) {
  const ts = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date());
  termEventLines.push({ ts, text });
  if (termEventLines.length > 200) termEventLines = termEventLines.slice(-200);
  renderTerm(bootLinesText());
}

/* ---------- W1 splash (dither coarse→fine by scroll) ---------- */
let splashCanvas: HTMLCanvasElement | null = null;
let splashStep = -1;

function scrubSplash(s: number) {
  const sp = splashCanvas?.parentElement;
  if (!sp) return;
  const idx = Math.min(SPLASH_STEPS.length - 1, Math.floor(s * SPLASH_STEPS.length));
  if (idx !== splashStep) {
    splashStep = idx;
    drawSplash(SPLASH_STEPS[idx]);
  }
}

function drawSplash(cell: number) {
  if (!splashCanvas) return;
  const c = splashCanvas;
  c.width = Math.ceil(108 / cell);
  c.height = Math.ceil(192 / cell);
  const x = c.getContext('2d')!;
  x.fillStyle = '#011403';
  x.fillRect(0, 0, c.width, c.height);
  /* ordered dither field, levels 1–2 only */
  for (let j = 0; j < c.height; j++) {
    for (let i = 0; i < c.width; i++) {
      const on = ((i * 7 + j * 13) % 5) < 2;
      if (on) { x.fillStyle = '#023502'; x.fillRect(i, j, 1, 1); }
    }
  }
}

/* ---------- probe ---------- */
export function windowsProbe() {
  const out: Record<string, { rect: Rect; q: number; live: boolean }> = {};
  for (const w of WINDOWS) {
    const el = els.get(w.id);
    out[w.id] = {
      rect: rects.get(w.id)!,
      q: +(lastP !== null ? clamp01((lastP - w.openAt) / w.openDur).toFixed(3) : 0),
      live: el ? el.root.classList.contains('is-live') : false,
    };
  }
  return out;
}
let lastP: number | null = null;

export function ledLocal(p: number): number {
  return clamp01((p - LED_START) / LED_LEN);
}

export function setTermEl(el: HTMLElement) { termEl = el; termShown = -1; }
export function setSplashEl(el: HTMLCanvasElement) { splashCanvas = el; drawSplash(SPLASH_STEPS[0]); }
export function relayoutWindows() { layout(); }

/* scene progress feed (passive scroll listener, no layout reads) */
export function initWindowsScrub() {
  const probe = () => {
    const fb = (window as unknown as { __flipbook?: { progress: () => number } }).__flipbook;
    if (!fb) return;
    const P = ledLocal(fb.progress());
    lastP = P;
    scrubWindows(P);
  };
  addEventListener('scroll', probe, { passive: true });
  addEventListener('resize', () => { relayoutWindows(); probe(); }, { passive: true });
  probe();
  setTimeout(probe, 150);
}
