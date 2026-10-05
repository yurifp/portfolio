/*
  GAME HOST — focus, input capture, fixed 60Hz loop and the GameModule
  contract. Part 2 implements only a GameModule; the stub here proves
  the pipeline: a 108×192 cell grid with a test pattern and a square
  that obeys the inputs.
*/
import { lockScroll, unlockScroll } from './main';
import { createShaftRunner } from '../games/shaft-runner';
import { LOGICAL, calcScale } from '../games/shaft-runner/layout';
import { ledLocal, termEmit, announce } from './windows-shell';

/* ---------- contract (Part 2 implements only this) ---------- */
export interface InputState {
  left: boolean; right: boolean; up: boolean; down: boolean;
  fire: boolean; bomb: boolean; pause: boolean;
  autopilot: boolean; esc: boolean; ok: boolean; quit: boolean;
  px?: number; /* touch drag target (logical x) */
}
export interface HostContext {
  canvas: HTMLCanvasElement;
  ctx2d: CanvasRenderingContext2D;
  input: InputState;
  palette: string[];          /* the closed panel ramp (12 levels) */
  seed: number;
  audio: { enabled: boolean };
  storage: { get(k: string): string | null; set(k: string, v: string): void };
  emit(evt: string, data?: Record<string, unknown>): void;
  release(): void;
  scale: number;              /* device px per logical cell */
  setLabel?(t: string): void;
  setActivity?(v: number): void;
}
export interface GameModule {
  id: string;
  logical: { w: number; h: number };
  capturesEsc: boolean;
  mount(ctx: HostContext): void;
  update(): void;
  render(): void;
  setMode(m: 'attract' | 'focused' | 'paused'): void;
  destroy(): void;
}

/* ---------- state ---------- */
type HostState = 'idle' | 'focused';
let state: HostState = 'idle';
let tick = 0;
let raf = 0;
let acc = 0;
let lastT = 0;
let module: GameModule | null = null;
let canvas: HTMLCanvasElement | null = null;
let ctx2d: CanvasRenderingContext2D | null = null;
let scale = 2;
let overlay: HTMLElement | null = null;
let winEl: HTMLElement | null = null;
let labelEl: HTMLElement | null = null;
let levelEls: HTMLElement[] = [];
let activity = 0;
let activityPulse = 0;
let telemFlash = 0;

const input: InputState = {
  left: false, right: false, up: false, down: false,
  fire: false, bomb: false, pause: false,
  autopilot: false, esc: false, ok: false, quit: false,
};

/* ---------- input capture (installed only while focused) ---------- */
const KEYMAP: Record<string, keyof InputState> = {
  ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
  KeyA: 'left', KeyD: 'right', KeyW: 'up', KeyS: 'down',
  Space: 'fire', KeyX: 'bomb', KeyP: 'autopilot',
  Escape: 'esc', Enter: 'ok', KeyQ: 'quit',
};
const SCROLL_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'PageUp', 'PageDown', 'Home', 'End']);

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Tab') return; /* NEVER captured */
  const k = KEYMAP[e.code];
  if (k) {
    input[k] = true;
    if (SCROLL_KEYS.has(e.code) || e.code === 'Space') e.preventDefault();
  } else if (SCROLL_KEYS.has(e.key)) {
    e.preventDefault();
  }
}
function onKeyUp(e: KeyboardEvent) {
  const k = KEYMAP[e.code];
  if (!k || k === 'esc') return; /* ESC latches until consumed */
  /* pulse: keep the bit on for ~6 frames after release, so a fast tap
     is always seen by at least one fixed step */
  setTimeout(() => { input[k] = false; }, 100);
}
function onWheel(e: WheelEvent) { e.preventDefault(); }
function onTouchMove(e: TouchEvent) { e.preventDefault(); }

function installCapture() {
  window.addEventListener('keydown', onKeyDown, { capture: true });
  window.addEventListener('keyup', onKeyUp, { capture: true });
  window.addEventListener('wheel', onWheel, { capture: true, passive: false });
  window.addEventListener('touchmove', onTouchMove, { passive: false });
}
function removeCapture() {
  window.removeEventListener('keydown', onKeyDown, { capture: true } as EventListenerOptions);
  window.removeEventListener('keyup', onKeyUp, { capture: true } as EventListenerOptions);
  window.removeEventListener('wheel', onWheel, { capture: true } as EventListenerOptions);
  window.removeEventListener('touchmove', onTouchMove);
}

/* ---------- focus ---------- */
export function focusGame(expanded = false) {
  if (state === 'focused' || !module) return;
  state = 'focused';
  lockScroll();
  document.documentElement.classList.add('game-focused');
  installCapture();
  if (winEl) { winEl.classList.add('is-focused'); winEl.focus({ preventScroll: true }); }
  if (winEl) winEl.style.touchAction = 'none';
  if (winEl) winEl.style.overscrollBehavior = 'contain';
  module.setMode('focused');
  termEmit('game focused — keyboard captured');
  announce('Game focused. Press Escape to exit.');
  if (expanded) openOverlay();
  lastT = performance.now();
  kickLoop();
}

export function releaseGame(reason = 'user') {
  if (state !== 'focused') return;
  state = 'idle';
  removeCapture();
  unlockScroll();
  document.documentElement.classList.remove('game-focused');
  closeOverlay();
  if (winEl) { winEl.classList.remove('is-focused'); winEl.style.touchAction = ''; }
  module?.setMode('attract');
  termEmit(`game released (${reason})`);
  announce('Game released.');
  if (winEl) winEl.focus({ preventScroll: true });
}

/* expand overlay (mobile tap + EXPAND button) */
function openOverlay() {
  if (overlay) return;
  overlay = document.createElement('div');
  overlay.className = 'game-focus-overlay';
  const close = document.createElement('button');
  close.className = 'win-close';
  close.textContent = '✕';
  close.setAttribute('aria-label', 'Exit focus mode');
  close.addEventListener('click', () => releaseGame('close'));
  overlay.appendChild(close);
  if (matchMedia('(hover: none)').matches) {
    const bomb = document.createElement('button');
    bomb.className = 'win-touch-btn'; bomb.textContent = 'BOMB';
    bomb.style.cssText = 'position:absolute;right:max(10px,var(--gutter));bottom:max(10px,var(--gutter));';
    bomb.addEventListener('pointerdown', (e) => { e.preventDefault(); input.bomb = true; });
    bomb.addEventListener('pointerup', () => { input.bomb = false; });
    overlay.appendChild(bomb);
    const pause = document.createElement('button');
    pause.className = 'win-touch-btn'; pause.textContent = 'PAUSE';
    pause.style.cssText = 'position:absolute;left:max(10px,var(--gutter));bottom:max(10px,var(--gutter));';
    pause.addEventListener('pointerdown', (e) => { e.preventDefault(); input.esc = true; });
    overlay.appendChild(pause);
  }
  /* the canvas moves into the overlay at full 9:16 */
  if (canvas?.parentElement) {
    const screen = canvas.parentElement;
    overlay.appendChild(canvas);
    document.body.appendChild(overlay);
    fitCanvas(screen);
    void screen;
  }
}
function closeOverlay() {
  if (!overlay) return;
  const screen = winEl?.querySelector('[data-win-screen]');
  if (screen && canvas) screen.appendChild(canvas);
  overlay.remove();
  overlay = null;
  fitCanvas();
}

/* ---------- integer scale (device px per cell) ---------- */
function fitCanvas(host?: HTMLElement) {
  if (!canvas) return;
  const dpr = Math.min(devicePixelRatio || 1, 3);
  if (host) {
    /* focus overlay: scale from the overlay box itself */
    const box = host.getBoundingClientRect();
    scale = calcScale(box.width * dpr, box.height * dpr);
  } else if (winEl?.dataset.scale) {
    scale = parseInt(winEl.dataset.scale, 10); /* the shell owns W1 scale */
  } else {
    const box = canvas.parentElement!.getBoundingClientRect();
    scale = calcScale(box.width * dpr, box.height * dpr);
  }
  canvas.width = LOGICAL.w * scale;
  canvas.height = LOGICAL.h * scale;
  canvas.style.width = canvas.width / dpr + 'px';
  canvas.style.height = canvas.height / dpr + 'px';
}

/* ---------- loop (fixed 60Hz, catch-up ≤ 5) ---------- */
function kickLoop() {
  if (raf || !module) return;
  lastT = performance.now();
  raf = requestAnimationFrame(loopFrame);
}
function loopFrame(now: number) {
  raf = 0;
  const open = winEl?.classList.contains('is-live') ?? false;
  if (!module || state !== 'focused' && !open) { /* attract keeps running while open */ }
  if (!module || !open || document.hidden) return;
  acc += Math.min(now - lastT, 250);
  lastT = now;
  let steps = 0;
  while (acc >= 1000 / 60 && steps < 5) {
    module.update();
    tick++;
    acc -= 1000 / 60;
    steps++;
  }
  if (steps === 5) acc = 0; /* clamp catch-up */
  module.render();
  updateLevelMeter();
  raf = requestAnimationFrame(loopFrame);
}

function updateLevelMeter() {
  activityPulse *= 0.94;
  activity = Math.max(activity * 0.97, activityPulse);
  const n = Math.round(Math.min(1, activity) * 5);
  levelEls.forEach((el, i) => el.classList.toggle('on', i < n));
}

function setLabel(t: string) {
  if (labelEl) labelEl.textContent = t;
  if (winEl) winEl.dataset.stateText = t;
}

/* ---------- telemetry (W3) ---------- */
let histCv: HTMLCanvasElement | null = null;
let framesCv: HTMLCanvasElement | null = null;
const frameTimes: number[] = [];
const dropSeries: number[] = [];
const scrollSeries: number[] = [];
let lastTelem = 0;
const PAL = ['#020602', '#020f02', '#011e01', '#023502', '#034e04', '#036806', '#038409', '#02a00b', '#00be0e', '#12dc1b', '#72f16d', '#c9fbc4'];

function telemetryFrame(now: number) {
  frameTimes.push(now - (lastTelem || now - 16));
  if (frameTimes.length > 120) frameTimes.shift();
  lastTelem = now;
}

function renderTelemetry() {
  const pn = (window as unknown as { __panel?: { levels(): Uint8Array } }).__panel;
  if (histCv && pn) {
    const L = pn.levels();
    const counts = new Array(12).fill(0);
    for (const v of L) counts[v]++;
    const c = histCv;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
    if (w < 4 || h < 4) return;
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const x = c.getContext('2d')!;
    /* event flash (stage/death): bright border for a few renders */
    if (telemFlash > 0) {
      x.fillStyle = '#72f16d';
      x.fillRect(0, 0, w, h);
      x.fillStyle = '#011403';
      x.fillRect(1, 1, w - 2, h - 2);
      telemFlash--;
    } else {
      x.fillStyle = '#011403';
      x.fillRect(0, 0, w, h);
    }
    const bw = Math.floor(w / 12);
    const mx = Math.max(1, ...counts);
    for (let b = 0; b < 12; b++) {
      const bh = Math.round(counts[b] / mx * (h - 8));
      const cells = Math.floor(bh / 4);
      for (let k = 0; k < cells; k++) {
        x.fillStyle = PAL[b];
        x.fillRect(b * bw + 2, h - 4 - k * 4, bw - 5, 3);
      }
    }
  }
  if (framesCv) {
    /* 3 stacked mini-charts: FRAME MS / DROPS / SCROLL % — line L4/lime,
       area L2 wash, grid L1, current value highlighted */
    const c = framesCv;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
    if (w < 4 || h < 4) return;
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const x = c.getContext('2d')!;
    x.fillStyle = '#020a04';
    x.fillRect(0, 0, w, h);
    const third = Math.floor(h / 3);
    const series = [
      { data: frameTimes, max: 40, fmt: (v: number) => String(Math.round(v)), label: 'MS', color: '#d6ffd9' },
      { data: dropSeries, max: Math.max(8, ...dropSeries), fmt: (v: number) => String(v), label: 'DRP', color: '#2cff4a' },
      { data: scrollSeries, max: 1, fmt: (v: number) => Math.round(v * 100) + '%', label: 'SCR', color: '#9df133' },
    ];
    series.forEach((sr, k) => {
      const y0 = k * third;
      x.fillStyle = '#07240d';
      for (let gy = y0 + 4; gy < y0 + third - 4; gy += 6) x.fillRect(0, gy, w, 1);
      const n = sr.data.length;
      if (n > 1) {
        const px = Math.max(1, Math.floor(w / 120));
        x.fillStyle = 'rgba(15, 122, 42, 0.35)';
        x.beginPath();
        x.moveTo(0, y0 + third - 4);
        for (let i = 0; i < n; i++) x.lineTo(i * px, y0 + third - 4 - Math.min(1, sr.data[i] / sr.max) * (third - 10));
        x.lineTo((n - 1) * px, y0 + third - 4);
        x.closePath();
        x.fill();
        x.fillStyle = sr.color;
        for (let i = 1; i < n; i++) x.fillRect(i * px, y0 + third - 4 - Math.min(1, sr.data[i] / sr.max) * (third - 10), Math.max(1, px - 1), 2);
        x.fillRect((n - 1) * px, y0 + third - 4 - Math.min(1, sr.data[n - 1] / sr.max) * (third - 10) - 2, Math.max(1, px), 5);
      }
      x.fillStyle = '#2cff4a';
      x.font = (9 * dpr) + 'px monospace';
      x.fillText(sr.label + ' ' + sr.fmt(sr.data[sr.data.length - 1] ?? 0), 4 * dpr, y0 + 11 * dpr);
    });
  }
}

export function mountGameHost(w1: HTMLElement) {
  winEl = w1;
  canvas = document.createElement('canvas');
  canvas.setAttribute('aria-label', 'Game screen');
  const screen = w1.querySelector('[data-win-screen]')!;
  /* splash canvas (dither) sits under the DOM splash text */
  const splash = screen.querySelector('[data-splash]');
  if (splash) {
    const sc = document.createElement('canvas');
    sc.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;image-rendering:pixelated;';
    splash.prepend(sc);
    (window as unknown as { __setSplashEl?: (el: HTMLCanvasElement) => void }).__setSplashEl?.(sc);
  }
  screen.insertBefore(canvas, splash);
  ctx2d = canvas.getContext('2d')!;
  fitCanvas();

  labelEl = w1.querySelector('[data-win-label]');
  levelEls = [...w1.querySelectorAll('.win-level i')] as HTMLElement[];
  termEmitInit();
  histCv = document.querySelector('[data-hist]');
  framesCv = document.querySelector('[data-frames]');

  /* the stub module through the full contract */
  module = createShaftRunner();
  module.mount({
    canvas, ctx2d, input,
    palette: ['#020a04', '#07240d', '#0f7a2a', '#2cff4a', '#d6ffd9', '#2cff4a', '#2cff4a', '#2cff4a', '#2cff4a', '#d6ffd9', '#d6ffd9', '#9df133'],
    seed: 0x5157,
    audio: { enabled: false },
    storage: safeStorage(),
    emit: (evt, data) => { termEmit(`${evt}${data ? ' ' + JSON.stringify(data) : ''}`); if (evt === 'stage') telemFlash = 12; if (evt === 'death' || evt === 'game-over') telemFlash = 20; },
    release: () => releaseGame('module'),
    scale,
    setLabel: (t: string) => setLabel(t),
    setActivity: (v: number) => { activityPulse = Math.max(activityPulse, v); },
  });
  /* the real game replaces the stub: the temporary splash goes away */
  const splashEl = screen.querySelector('[data-splash]');
  splashEl?.remove();
  updateProbe();

function updateProbe() {
  (window as unknown as { __host?: Record<string, unknown> }).__host = {
    windows: () => (window as unknown as { __windowsProbe?: () => Record<string, unknown> }).__windowsProbe?.() ?? null,
    state: () => state,
    focused: () => state === "focused",
    locked: () => state === "focused",
    tick: () => tick,
    module: () => module?.id ?? null,
    input: () => ({ ...input }),
  };
}

  /* touch: drag moves the ship 1:1 (input.px), tap = auto-fire */
  let touchDown = false;
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    touchDown = true;
    input.fire = true;
    const r = canvas.getBoundingClientRect();
    input.px = ((e.clientX - r.left) / r.width) * 108;
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'touch' || !touchDown) return;
    const r = canvas.getBoundingClientRect();
    input.px = ((e.clientX - r.left) / r.width) * 108;
  });
  const endTouch = () => { touchDown = false; input.fire = false; input.px = undefined; };
  canvas.addEventListener('pointerup', endTouch);
  canvas.addEventListener('pointercancel', endTouch);

  /* focus triggers — mobile/touch taps enter the expanded overlay mode */
  const wantOverlay = () => matchMedia('(max-width: 1199px)').matches || matchMedia('(hover: none)').matches;
  w1.addEventListener('click', () => focusGame(wantOverlay()));
  w1.addEventListener('keydown', (e) => { if (e.key === 'Enter' && state !== 'focused') focusGame(false); });
  const expand = w1.querySelector('[data-win-expand]');
  expand?.addEventListener('click', (e) => { e.stopPropagation(); focusGame(true); });

  /* click OUTSIDE the window (or overlay) releases focus */
  document.addEventListener('click', (e) => {
    if (state !== 'focused') return;
    const t = e.target as Node;
    if (winEl?.contains(t) || overlay?.contains(t)) return;
    releaseGame('outside');
  });

  /* ESC outside focus (module releases itself via input.esc) */
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state === 'focused' && !module?.capturesEsc) releaseGame('esc');
  });

  /* auto-pause: hidden tab, resize, leaving the plateau */
  document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'focused') { module?.setMode('paused'); setLabel('PAUSED'); } });
  window.addEventListener("resize", () => { if (state === "focused") { module?.setMode("paused"); setLabel("PAUSED"); } requestAnimationFrame(() => fitCanvas()); });
  addEventListener('scroll', () => {
    const fb = (window as unknown as { __flipbook?: { progress: () => number } }).__flipbook;
    if (!fb) return;
    const P = ledLocal(fb.progress());
    const inPlateau = P >= 0.70 && P <= 0.99;
    if (state === 'focused' && !inPlateau) releaseGame('left-plateau');
  }, { passive: true });

  /* attract loop + telemetry share one rAF */
  const telemLoop = (now: number) => {
    const open = w1.classList.contains('is-live');
    telemetryFrame(now);
    if (open && !document.hidden) {
      kickLoop();
      /* telemetry at ~4Hz */
      if (now - lastRender >= 250) { lastRender = now; renderTelemetry(); }
    }
    requestAnimationFrame(telemLoop);
  };
  let lastRender = 0;
  requestAnimationFrame(telemLoop);
}

function termEmitInit() {
  const term = document.querySelector('[data-term]');
  if (term) (window as unknown as { __setTermEl?: (el: HTMLElement) => void }).__setTermEl?.(term as HTMLElement);
}

function safeStorage() {
  try {
    const t = '__t';
    localStorage.setItem(t, '1');
    localStorage.removeItem(t);
    return {
      get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
      set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* full/blocked */ } },
    };
  } catch {
    return { get: () => null, set: () => { /* not saved */ } };
  }
}
