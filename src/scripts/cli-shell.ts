/*
  YF.CLI SHELL — one compact CRT window in the hero.

  Modes: closed → boot → idle → game (Lote 2) → idle. The shell owns the
  chrome (open/close, drag, fullscreen, resize handle, sound proxy), the
  boot BIOS sequencer, the idle pixel screen (logo + prompt + telemetry
  sparklines) and the CRT overlay. The game module is mounted INTO the
  same screen by the game host — one window, one life.
*/
import { gsap } from 'gsap';
import { F35 } from '../games/shaft-runner/data';
import { sceneStart, sceneLen } from './scenes';

/* palette — the phosphor ramp we already use everywhere */
const C_BG = '#020a04';
const C_DIM = '#0f7a2a';
const C_MID = '#2cff4a';
const C_HI = '#d6ffd9';
const C_LIME = '#9df133';

/* logical pixel screen (the boot/idle canvas) */
const PW = 240;
const PH = 150;

type Mode = 'closed' | 'boot' | 'idle' | 'game';

const BOOT_LINES = [
  'YF.BIOS v1.0 — 640K OK',
  'MOUNT /hero .......... OK',
  'DITHER CORE 8x8 ...... OK',
  'LED FIELD 300vh ...... OK',
  'AUDIO SYNTH .......... --',
  'SHAFT RUNNER ......... READY',
];
/* ms between lines — brisk, the reference lingers far longer */
const BOOT_STEP = 210;

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* keys that belong to the game — while it is mounted they must never
   scroll the page, focused or not */
const GAME_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'KeyA', 'KeyD', 'KeyW', 'KeyS', 'KeyX', 'KeyP', 'KeyQ', 'Enter']);

interface Shell {
  root: HTMLElement;
  btn: HTMLButtonElement;
  win: HTMLElement;
  screen: HTMLElement;
  canvas: HTMLCanvasElement;
  foot: HTMLElement;
  kbd: HTMLElement;
  status: HTMLElement;
  mode: Mode;
  bootT0: number;
  raf: number;
  msSeries: number[];
  scrSeries: number[];
  lastFrame: number;
  lastSample: number;
  dragged: boolean;
  fs: boolean;
  open(): void;
  close(): void;
  setMode(m: Mode): void;
  toGame(): void;
  fromGame(): void;
}

let shell: Shell | null = null;
/* Lote 2 hooks — the game host registers itself here */
let gameMount: ((sh: Shell) => void) | null = null;
let gameDestroy: (() => void) | null = null;
export function registerGame(mount: (sh: Shell) => void, destroy: () => void) {
  gameMount = mount;
  gameDestroy = destroy;
}

/* ---------- pixel text (3×5 font, scaled) ---------- */
function text(
  x2: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  color: string,
  k = 1,
) {
  let cx = x;
  for (const ch of s.toUpperCase()) {
    const g = F35[ch] || F35[' '];
    x2.fillStyle = color;
    for (let r = 0; r < 5; r++)
      for (let c = 0; c < 3; c++)
        if (g[r][c] === '1') x2.fillRect((cx + c) * k, (y + r) * k, k, k);
    cx += 4;
  }
}
function textW(s: string, k = 1) {
  return s.length * 4 * k - k;
}

export function mountCli() {
  const root = document.querySelector<HTMLElement>('[data-cli-root]');
  const win = document.querySelector<HTMLElement>('[data-cli-window]');
  const btn = document.querySelector<HTMLButtonElement>('[data-cli-btn]');
  const screen = document.querySelector<HTMLElement>('[data-cli-screen]');
  const canvas = document.querySelector<HTMLCanvasElement>('[data-cli-canvas]');
  if (!root || !win || !btn || !screen || !canvas) return;
  const foot = win.querySelector<HTMLElement>('[data-cli-foot]')!;
  const kbd = win.querySelector<HTMLElement>('[data-cli-kbd]')!;
  const status = win.querySelector<HTMLElement>('[data-cli-status]')!;

  canvas.width = PW * 2;
  canvas.height = PH * 2;
  const x2 = canvas.getContext('2d')!;
  x2.imageSmoothingEnabled = false;

  /* the window must NOT live inside the flip frame: the film scales its
     frames (transform → stacking context), which would trap our fixed
     window under the nav and warp position:fixed itself. Body it goes. */
  document.body.appendChild(win);

  shell = {
    root, btn, win, screen, canvas, foot, kbd, status,
    mode: 'closed',
    bootT0: 0,
    raf: 0,
    msSeries: [],
    scrSeries: [],
    lastFrame: 0,
    lastSample: 0,
    dragged: false,
    fs: false,
    open,
    close,
    setMode,
    toGame,
    fromGame,
  };

  const booted = (() => {
    try { return sessionStorage.getItem('yf.cli-boot') === '1'; } catch { return false; }
  })();

  function open() {
    if (shell!.mode !== 'closed') return;
    win.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    btn.textContent = 'CLOSE TERMINAL ×';
    win.focus({ preventScroll: true });
    if (reduced) {
      setMode(booted ? 'idle' : 'boot');
    } else {
      gsap.fromTo(
        win,
        { clipPath: 'inset(0 0 100% 0)', y: 14, autoAlpha: 1 },
        {
          clipPath: 'inset(0 0 0% 0)', y: 0, duration: 0.45, ease: 'power3.out',
          onComplete: () => setMode(booted ? 'idle' : 'boot'),
        },
      );
    }
  }

  function close(instant = false) {
    if (shell!.mode === 'closed') return;
    if (shell!.mode === 'game') gameDestroy?.();
    const finish = () => {
      win.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
      btn.textContent = 'OPEN TERMINAL >_';
      setMode('closed');
      gsap.set(win, { clearProps: 'clipPath,transform,opacity' });
    };
    if (instant || reduced) {
      finish();
    } else {
      gsap.to(win, {
        clipPath: 'inset(0 0 100% 0)', y: 10, duration: 0.3, ease: 'power3.in',
        onComplete: finish,
      });
    }
  }

  function setMode(m: Mode) {
    shell!.mode = m;
    if (m !== 'game') {
      shell!.canvas.style.display = '';
    }
    if (m === 'boot') {
      shell!.bootT0 = performance.now();
      foot.textContent = 'BOOT — ANY KEY SKIPS';
      status.dataset.on = 'true';
    } else if (m === 'idle') {
      try { sessionStorage.setItem('yf.cli-boot', '1'); } catch { /* private */ }
      foot.textContent = 'ANY KEY — PLAY · ESC — CLOSE';
      status.dataset.on = 'true';
    }
    if (m !== 'closed' && !shell!.raf) {
      shell!.lastFrame = performance.now();
      shell!.raf = requestAnimationFrame(loop);
    }
    if (m === 'closed' && shell!.raf) {
      cancelAnimationFrame(shell!.raf);
      shell!.raf = 0;
    }
  }

  function toGame() {
    if (!gameMount) {
      foot.textContent = 'SHAFT RUNNER MODULE NOT LOADED';
      return;
    }
    setMode('game');
    foot.textContent = 'BOOTING SHAFT RUNNER…';
    gameMount({
      win, screen, canvas, foot, kbd, status,
      root: shell!.root, btn: shell!.btn, mode: shell!.mode,
      raf: shell!.raf, bootT0: shell!.bootT0, msSeries: shell!.msSeries,
      scrSeries: shell!.scrSeries, lastFrame: shell!.lastFrame, lastSample: shell!.lastSample,
      dragged: shell!.dragged, fs: shell!.fs,
      open, close, setMode, toGame, fromGame,
    });
  }

  function fromGame() {
    gameDestroy?.();
    setMode('idle');
  }

  /* ---------- the screen loop (boot + idle share one canvas) ---------- */
  function loop(now: number) {
    shell!.raf = 0;
    if (shell!.mode === 'closed' || document.hidden) return;
    const dt = now - shell!.lastFrame;
    shell!.lastFrame = now;
    /* telemetry samples at ~8 Hz */
    if (now - shell!.lastSample > 125) {
      shell!.lastSample = now;
      shell!.msSeries.push(Math.min(60, dt));
      if (shell!.msSeries.length > 48) shell!.msSeries.shift();
      const fb = (window as unknown as { __flipbook?: { progress(): number } }).__flipbook;
      shell!.scrSeries.push(fb ? fb.progress() : 0);
      if (shell!.scrSeries.length > 48) shell!.scrSeries.shift();
    }

    if (shell!.mode === 'boot') drawBoot(now);
    else if (shell!.mode === 'idle') drawIdle(now);
    /* 'game' renders itself on its own canvas */

    if (shell!.mode !== 'closed') shell!.raf = requestAnimationFrame(loop);
  }

  function frame() {
    x2.fillStyle = C_BG;
    x2.fillRect(0, 0, PW * 2, PH * 2);
    x2.save();
    x2.scale(2, 2);
  }

  function drawBoot(now: number) {
    const el = now - shell!.bootT0;
    const done = Math.min(BOOT_LINES.length, Math.floor(el / BOOT_STEP));
    frame();
    text(x2, 'YF.BIOS', 8, 8, C_DIM, 1);
    text(x2, 'v1.0', 8 + textW('YF.BIOS') + 6, 8, C_DIM, 1);
    for (let i = 0; i < done; i++) {
      const lineOk = el > (i + 1) * BOOT_STEP + 120;
      text(x2, BOOT_LINES[i].slice(0, 21), 8, 22 + i * 9, lineOk ? C_MID : C_DIM, 1);
      const ok = BOOT_LINES[i].slice(-4);
      text(x2, ok, 8 + 22 * 4, 22 + i * 9, lineOk ? C_HI : C_DIM, 1);
    }
    /* block progress bar */
    const total = BOOT_LINES.length * BOOT_STEP + 200;
    const blocks = Math.round(Math.min(1, el / total) * 12);
    for (let b = 0; b < 12; b++) {
      x2.fillStyle = b < blocks ? C_LIME : '#07240d';
      x2.fillRect(8 + b * 8, 132, 6, 6);
    }
    text(x2, 'D=DEBUG', 8 + 12 * 8 + 8, 133, '#07240d', 1);
    x2.restore();
    if (el >= total) setMode('idle');
  }

  function drawIdle(now: number) {
    frame();
    /* pixel logo: YF> in big blocks */
    text(x2, 'YF', 10, 12, C_LIME, 3);
    text(x2, '>_', 10 + textW('YF', 3) + 8, 22, C_MID, 2);
    /* prompt — blinks at ~1.1 Hz unless reduced */
    const on = reduced || Math.floor(now / 450) % 2 === 0;
    text(x2, 'PRESS ANY KEY', 10, 52, on ? C_HI : C_DIM, 1);
    text(x2, 'ENTER PLAYS · ESC CLOSES', 10, 62, C_DIM, 1);
    /* telemetry sparklines — real data, tiny */
    spark(10, 78, 105, 30, shell!.msSeries, 60, 'MS', C_MID);
    spark(125, 78, 105, 30, shell!.scrSeries, 1, 'SCR', C_LIME);
    /* status line */
    text(x2, 'SND OFF · HI ' + (hiText() || '0'), 10, 136, C_DIM, 1);
    x2.restore();
  }

  function hiText(): string {
    try {
      const raw = localStorage.getItem('sr.hiscores');
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) && arr.length ? String(arr[0]) : '0';
    } catch { return '0'; }
  }

  function spark(sx: number, sy: number, w: number, h: number, data: number[], max: number, label: string, color: string) {
    x2.fillStyle = '#07240d';
    x2.fillRect(sx, sy, w, h);
    x2.fillStyle = '#0f7a2a';
    for (let gy = sy + 4; gy < sy + h - 3; gy += 5) x2.fillRect(sx + 2, gy, w - 4, 1);
    if (data.length > 1) {
      const px = Math.max(1, Math.floor((w - 4) / 48));
      x2.fillStyle = color;
      for (let i = 0; i < data.length; i++) {
        const v = Math.min(1, data[i] / max);
        x2.fillRect(sx + 2 + i * px, sy + h - 3 - v * (h - 8), Math.max(1, px - 1), 2);
      }
    }
    text(x2, label, sx + 3, sy + 2, C_HI, 1);
  }

  /* ---------- chrome: button / drag / fullscreen / resize / sound ---------- */
  btn.addEventListener('click', () => (shell!.mode === 'closed' ? open() : close()));
  win.querySelector('[data-cli-close]')?.addEventListener('click', () => close());

  const drag = win.querySelector<HTMLElement>('[data-cli-drag]')!;
  drag.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).closest('button')) return;
    if (matchMedia('(max-width: 899px)').matches || shell!.fs) return;
    const r = win.getBoundingClientRect();
    const ox = e.clientX - r.left;
    const oy = e.clientY - r.top;
    win.classList.add('is-dragging');
    drag.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const x = Math.max(8, Math.min(innerWidth - r.width - 8, ev.clientX - ox));
      const y = Math.max(8, Math.min(innerHeight - r.height - 8, ev.clientY - oy));
      if (!shell!.dragged) {
        win.style.right = 'auto';
        win.style.bottom = 'auto';
        shell!.dragged = true;
      }
      win.style.left = x + 'px';
      win.style.top = y + 'px';
    };
    const up = () => {
      win.classList.remove('is-dragging');
      drag.releasePointerCapture(e.pointerId);
      drag.removeEventListener('pointermove', move);
      drag.removeEventListener('pointerup', up);
    };
    drag.addEventListener('pointermove', move);
    drag.addEventListener('pointerup', up);
  });

  const fsBtn = win.querySelector<HTMLButtonElement>('[data-cli-fs]')!;
  fsBtn.addEventListener('click', () => {
    shell!.fs = !shell!.fs;
    win.classList.toggle('is-fs', shell!.fs);
    fsBtn.setAttribute('aria-pressed', String(shell!.fs));
    if (shell!.fs) {
      win.style.left = win.style.top = win.style.right = win.style.bottom = '';
      shell!.dragged = false;
    }
  });

  /* resize handle — width/height live on the window (min/max clamped) */
  const rz = win.querySelector<HTMLElement>('[data-cli-resize]')!;
  rz.addEventListener('pointerdown', (e) => {
    if (matchMedia('(max-width: 899px)').matches || shell!.fs) return;
    e.preventDefault();
    const r = win.getBoundingClientRect();
    const sx = e.clientX, sy = e.clientY, sw = r.width, sh = r.height;
    rz.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const w = Math.max(320, Math.min(innerWidth - 16, sw + ev.clientX - sx));
      const h = Math.max(300, Math.min(innerHeight - 16, sh + ev.clientY - sy));
      win.style.width = w + 'px';
      win.style.height = h + 'px';
    };
    const up = () => {
      rz.releasePointerCapture(e.pointerId);
      rz.removeEventListener('pointermove', move);
      rz.removeEventListener('pointerup', up);
    };
    rz.addEventListener('pointermove', move);
    rz.addEventListener('pointerup', up);
  });

  /* sound: proxy the SITE toggle — one source of truth, zero new audio */
  const sndBtn = win.querySelector<HTMLButtonElement>('[data-cli-snd]')!;
  sndBtn.addEventListener('click', () => {
    document.querySelector<HTMLButtonElement>('[data-sound-btn]')?.click();
  });
  const syncSnd = () => {
    const on = document.querySelector('[data-sound-btn]')?.getAttribute('aria-checked') === 'true';
    sndBtn.setAttribute('aria-pressed', String(on));
    sndBtn.classList.toggle('is-on', !!on);
  };
  new MutationObserver(syncSnd).observe(
    document.querySelector('[data-sound-btn]')!,
    { attributes: true, attributeFilter: ['aria-checked'] },
  );
  syncSnd();

  /* keyboard routing — installed only while the window is open */
  const onKey = (e: KeyboardEvent) => {
    if (shell!.mode === 'closed') return;
    if ((e.target as HTMLElement)?.closest?.('input,textarea')) return;
    if (shell!.mode === 'boot') {
      setMode('idle');
      return;
    }
    if (shell!.mode === 'idle') {
      if (e.key === 'Escape') { close(); return; }
      /* the game will capture its own keyboard; only ENTER is ours here */
      if (e.key === 'Enter') { e.preventDefault(); toGame(); }
      return;
    }
    /* game mode: the host owns keys; ESC outside focus still closes us.
       Any OTHER key while unfocused REFOCUSES the game — otherwise the
       page scrolls under the window and the hero auto-close eats it. */
    if (document.documentElement.classList.contains('game-focused')) return;
    if (e.key === 'Escape') { close(); return; }
    if (GAME_KEYS.has(e.code)) {
      e.preventDefault();
      (window as unknown as { __cliFocusGame?: () => void }).__cliFocusGame?.();
    }
  };
  addEventListener('keydown', onKey);

  /* hero leaves → the window goes with it (the film owns the page) */
  const HERO_END = sceneStart('hero') + sceneLen('hero') * 0.92;
  addEventListener(
    'scroll',
    () => {
      if (shell!.mode === 'closed') return;
      const fb = (window as unknown as { __flipbook?: { progress: () => number } }).__flipbook;
      if (fb && fb.progress() > HERO_END) close(true);
    },
    { passive: true },
  );

  /* expose for probes/tests */
  (window as unknown as { __cli?: Record<string, unknown> }).__cli = {
    mode: () => shell!.mode,
    open: () => open(),
    close: () => close(),
    fs: () => shell!.fs,
    rect: () => {
      const r = win.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    },
  };
}
