/*
  GAME HOST (lean) — mounts SHAFT RUNNER inside the YF.CLI window.

  Owns ONLY: the canvas, keyboard capture (installed while focused),
  the fixed 60Hz loop, sound wiring (mirrors the site SOUND switch) and
  the touch controls. The engine (games/shaft-runner) stays pure.
  Fixes carried from the audit: input cleared on pause/blur/hidden,
  resize only pauses when the canvas actually resized, every listener
  and rAF is torn down on destroy.
*/
import { lockScroll, unlockScroll } from './main';
import { createShaftRunner } from '../games/shaft-runner';
import { LOGICAL, calcScale } from '../games/shaft-runner/layout';
import { registerGame } from './cli-shell';

export interface InputState {
  left: boolean; right: boolean; up: boolean; down: boolean;
  fire: boolean; bomb: boolean; pause: boolean;
  autopilot: boolean; esc: boolean; ok: boolean; quit: boolean;
  px?: number;
}
export interface HostContext {
  canvas: HTMLCanvasElement;
  ctx2d: CanvasRenderingContext2D;
  input: InputState;
  palette: string[];
  seed: number;
  audio: { enabled: boolean };
  storage: { get(k: string): string | null; set(k: string, v: string): void };
  emit(evt: string, data?: Record<string, unknown>): void;
  release(): void;
  scale: number;
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

const KEYMAP: Record<string, keyof InputState> = {
  ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
  KeyA: 'left', KeyD: 'right', KeyW: 'up', KeyS: 'down',
  Space: 'fire', KeyX: 'bomb', KeyP: 'autopilot',
  Escape: 'esc', Enter: 'ok', KeyQ: 'quit',
};
const SCROLL_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'PageUp', 'PageDown', 'Home', 'End']);

/* footer hints per game state — the shell foot is our status line */
const HINTS: Record<string, string> = {
  menu: 'ENTER START · ↑↓ SELECT · Q CLI',
  attract: 'CLICK TO FOCUS · Q CLI',
  play: '←→ MOVE · SPACE FIRE · X BOMB · P AUTO · ESC PAUSE',
  pause: 'SPACE RESUME · ESC RELEASE · Q CLI',
  gameover: 'ENTER RETRY · Q CLI',
  hiscores: 'SPACE BACK · Q CLI',
};

/* ---------- module state (all torn down by destroy) ---------- */
let module: GameModule | null = null;
let canvas: HTMLCanvasElement | null = null;
let screenEl: HTMLElement | null = null;
let winEl: HTMLElement | null = null;
let footEl: HTMLElement | null = null;
let kbdEl: HTMLElement | null = null;
let pixEl: HTMLCanvasElement | null = null;
let raf = 0;
let acc = 0;
let lastT = 0;
let focused = false;
let lastW = 0;
let lastH = 0;
const cleanups: Array<() => void> = [];

const input: InputState = {
  left: false, right: false, up: false, down: false,
  fire: false, bomb: false, pause: false,
  autopilot: false, esc: false, ok: false, quit: false,
};

function clearInput() {
  for (const k of Object.keys(input) as Array<keyof InputState>) {
    if (k !== 'px') (input as unknown as Record<string, boolean>)[k] = false;
  }
  input.px = undefined;
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Tab') return; /* NEVER captured */
  const k = KEYMAP[e.code];
  if (k) {
    input[k] = true;
    if (SCROLL_KEYS.has(e.code)) e.preventDefault();
  } else if (SCROLL_KEYS.has(e.key)) {
    e.preventDefault();
  }
}
function onKeyUp(e: KeyboardEvent) {
  const k = KEYMAP[e.code];
  if (!k || k === 'esc') return; /* ESC latches until consumed */
  setTimeout(() => { input[k] = false; }, 100);
}
function onBlur() { clearInput(); }

function installCapture() {
  window.addEventListener('keydown', onKeyDown, { capture: true });
  window.addEventListener('keyup', onKeyUp, { capture: true });
  window.addEventListener('blur', onBlur);
  cleanups.push(() => {
    window.removeEventListener('keydown', onKeyDown, { capture: true } as EventListenerOptions);
    window.removeEventListener('keyup', onKeyUp, { capture: true } as EventListenerOptions);
    window.removeEventListener('blur', onBlur);
  });
}

function fitCanvas() {
  if (!canvas || !screenEl || !winEl) return;
  const dpr = Math.min(devicePixelRatio || 1, 3);
  /* fit INSIDE the viewport: the game canvas may not push the window
     past the screen — budget for titlebar + footer + breathing room */
  const availW = screenEl.clientWidth * dpr;
  const availH = Math.max(220, (innerHeight - 150)) * dpr;
  const s = calcScale(availW, availH);
  canvas.width = LOGICAL.w * s;
  canvas.height = LOGICAL.h * s;
  canvas.style.width = canvas.width / dpr + 'px';
  canvas.style.height = canvas.height / dpr + 'px';
  lastW = canvas.width;
  lastH = canvas.height;
  /* if the window grew past the top edge, pull it back inside */
  const r = winEl.getBoundingClientRect();
  if (r.top < 8) {
    winEl.style.bottom = 'auto';
    winEl.style.top = Math.max(8, Math.min(innerHeight - r.height - 8, 48)) + 'px';
  }
}

function setFoot(t: string) {
  if (footEl) footEl.textContent = t;
}
function setKbd(on: boolean) {
  if (kbdEl) kbdEl.hidden = !on;
}

function loopFrame(now: number) {
  raf = 0;
  if (!module || document.hidden) return;
  acc += Math.min(now - lastT, 250);
  lastT = now;
  let steps = 0;
  while (acc >= 1000 / 60 && steps < 5) {
    module.update();
    acc -= 1000 / 60;
    steps++;
  }
  if (steps === 5) acc = 0;
  module.render();
  raf = requestAnimationFrame(loopFrame);
}

function focusGame() {
  if (focused || !module) return;
  focused = true;
  lockScroll();
  document.documentElement.classList.add('game-focused');
  installCapture();
  winEl?.classList.add('is-focused');
  setKbd(true);
  module.setMode('focused');
  setFoot(HINTS.play);
  lastT = performance.now();
  if (!raf) raf = requestAnimationFrame(loopFrame);
}

function releaseGame(reason = 'user') {
  if (!focused) return;
  focused = false;
  clearInput();
  for (const c of cleanups.splice(0)) c();
  unlockScroll();
  document.documentElement.classList.remove('game-focused');
  winEl?.classList.remove('is-focused');
  setKbd(false);
  module?.setMode('attract');
  setFoot(HINTS.attract + (reason === 'esc' ? '' : ''));
}

/* ---------- mount into the CLI window ---------- */
function mountInScreen(sh: {
  win: HTMLElement;
  screen: HTMLElement;
  canvas: HTMLCanvasElement;
  foot: HTMLElement;
  kbd: HTMLElement;
  fromGame: () => void;
}) {
  winEl = sh.win;
  screenEl = sh.screen;
  footEl = sh.foot;
  kbdEl = sh.kbd;
  pixEl = sh.canvas;
  pixEl.style.display = 'none';

  canvas = document.createElement('canvas');
  canvas.setAttribute('aria-label', 'SHAFT RUNNER game screen');
  canvas.style.cssText = 'display:block;margin:0 auto;image-rendering:pixelated;';
  screenEl.insertBefore(canvas, screenEl.querySelector('.cli-crt'));
  const ctx2d = canvas.getContext('2d')!;
  fitCanvas();

  const audioState = { enabled: false };
  /* the SITE switch is the single source of truth for sound */
  const sndBtn = document.querySelector('[data-sound-btn]');
  const syncAudio = () => {
    audioState.enabled = sndBtn?.getAttribute('aria-checked') === 'true';
  };
  if (sndBtn) {
    const mo = new MutationObserver(syncAudio);
    mo.observe(sndBtn, { attributes: true, attributeFilter: ['aria-checked'] });
    cleanups.push(() => mo.disconnect());
  }
  syncAudio();

  module = createShaftRunner();
  module.mount({
    canvas, ctx2d, input,
    palette: ['#020a04', '#07240d', '#0f7a2a', '#2cff4a', '#d6ffd9', '#2cff4a', '#2cff4a', '#2cff4a', '#2cff4a', '#d6ffd9', '#d6ffd9', '#9df133'],
    seed: 0x5157,
    audio: audioState,
    storage: safeStorage(),
    emit: (evt) => { if (evt === 'game-over') setFoot(HINTS.gameover); if (evt === 'stage') setFoot(HINTS.play); },
    release: () => releaseGame('module'),
    scale: 2,
    setLabel: (t) => setFoot(HINTS[t.toLowerCase()] ?? t),
    setActivity: () => { /* the old W3 meter is gone */ },
  });

  /* focus triggers */
  const onClick = () => { if (!focused) focusGame(); };
  winEl.addEventListener('click', onClick);
  cleanups.push(() => winEl?.removeEventListener('click', onClick));

  /* ESC outside focus (module handles its own ESC while capturing) */
  const onEsc = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && focused && !module?.capturesEsc) releaseGame('esc');
  };
  addEventListener('keydown', onEsc);
  cleanups.push(() => removeEventListener('keydown', onEsc));

  /* click OUTSIDE the window releases focus */
  const onDocClick = (e: MouseEvent) => {
    if (!focused) return;
    if (winEl?.contains(e.target as Node)) return;
    releaseGame('outside');
  };
  document.addEventListener('click', onDocClick);
  cleanups.push(() => document.removeEventListener('click', onDocClick));

  /* Q returns to the CLI idle — from anywhere in the game */
  const onQuit = (e: KeyboardEvent) => {
    if (e.code !== 'KeyQ') return;
    if ((e.target as HTMLElement)?.closest?.('input,textarea')) return;
    e.preventDefault();
    sh.fromGame();
  };
  addEventListener('keydown', onQuit);
  cleanups.push(() => removeEventListener('keydown', onQuit));

  /* pause + clear input on hidden; re-fit on resize, pause only if the
     canvas actually changed size (mobile URL bar resizes don't pause) */
  const onVis = () => { if (document.hidden) { clearInput(); if (focused) { module?.setMode('paused'); setFoot(HINTS.pause); } } };
  document.addEventListener('visibilitychange', onVis);
  cleanups.push(() => document.removeEventListener('visibilitychange', onVis));
  const onResize = () => {
    requestAnimationFrame(() => {
      if (!canvas) return;
      fitCanvas();
      if (focused && (canvas.width !== lastW || canvas.height !== lastH)) {
        module?.setMode('paused');
        setFoot(HINTS.pause);
      }
    });
  };
  addEventListener('resize', onResize);
  cleanups.push(() => removeEventListener('resize', onResize));

  /* touch: drag steers (px), tap auto-fires — plus a control strip */
  let touchDown = false;
  const down = (e: PointerEvent) => {
    if (e.pointerType !== 'touch') return;
    touchDown = true;
    input.fire = true;
    input.px = toLogicalX(e.clientX);
  };
  const move = (e: PointerEvent) => {
    if (e.pointerType !== 'touch' || !touchDown) return;
    input.px = toLogicalX(e.clientX);
  };
  const end = () => { touchDown = false; input.fire = false; input.px = undefined; };
  const toLogicalX = (clientX: number) => {
    const r = canvas!.getBoundingClientRect();
    return ((clientX - r.left) / r.width) * 108;
  };
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  cleanups.push(() => {
    canvas?.removeEventListener('pointerdown', down);
    canvas?.removeEventListener('pointermove', move);
    canvas?.removeEventListener('pointerup', end);
    canvas?.removeEventListener('pointercancel', end);
  });

  if (matchMedia('(hover: none)').matches) {
    const strip = document.createElement('div');
    strip.className = 'cli-touch mono-tiny';
    strip.setAttribute('aria-hidden', 'false');
    const mk = (label: string, on: () => void, off?: () => void) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cli-tbtn';
      b.textContent = label;
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); on(); });
      if (off) b.addEventListener('pointerup', () => off());
      strip.appendChild(b);
      return b;
    };
    mk('FIRE', () => { input.fire = true; }, () => { input.fire = false; });
    mk('BOMB', () => { input.bomb = true; });
    mk('AUTO', () => { input.autopilot = true; });
    mk('PAUSE', () => { input.esc = true; });
    mk('CLI', () => sh.fromGame());
    screenEl.after(strip);
    cleanups.push(() => strip.remove());
  }

  setFoot(HINTS.menu);
  lastT = performance.now();
  raf = requestAnimationFrame(loopFrame);
}

function destroy() {
  releaseGame('destroy');
  if (raf) { cancelAnimationFrame(raf); raf = 0; }
  for (const c of cleanups.splice(0)) c();
  module?.destroy();
  module = null;
  canvas?.remove();
  canvas = null;
  if (pixEl) pixEl.style.display = '';
  if (screenEl?.querySelector('.cli-touch')) (screenEl.nextElementSibling as HTMLElement | null)?.remove?.();
  screenEl = null;
  winEl = null;
  footEl = null;
  kbdEl = null;
  pixEl = null;
}

function safeStorage() {
  try {
    const t = '__t';
    localStorage.setItem(t, '1');
    localStorage.removeItem(t);
    return {
      get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
      set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* blocked */ } },
    };
  } catch {
    return { get: () => null, set: () => { /* not saved */ } };
  }
}

/* self-register with the CLI shell — one import wires the whole game */
export function initGameHost() {
  registerGame(
    (sh) => mountInScreen(sh as never),
    () => destroy(),
  );
}

/* probe (tests) */
export function gameProbe() {
  return (window as unknown as { __game?: unknown }).__game ?? null;
}
