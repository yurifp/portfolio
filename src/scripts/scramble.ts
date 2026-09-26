/*
  Scroll roulette v2 — class-driven color, watchdog-guaranteed rest.

  Glyphs churn per character while the page moves; COLOR is a single
  CSS class on each host (.is-scrambling), so there are ZERO inline
  color styles anywhere — a stuck color would require a class that
  nothing removes, and an independent watchdog removes it whenever
  the page has been at rest, no matter what the state machine thinks.
*/
import { gsap } from 'gsap';

const GLYPHS = '!<>-_\\/[]{}—=+*^?#______ABCDEFGHKMNPRSTUVWXYZ0123456789';
/* gsap.ticker time is seconds — keep every interval in seconds */
const SWAP_MIN = 0.055;
const SWAP_JITTER = 0.07;
const RESOLVE_WAVE = 0.42;
const RESOLVE_JITTER = 0.12;

interface Slot {
  el: HTMLElement;
  orig: string;
  nextSwap: number;
  swapEvery: number;
  resolveAt: number | null;
}

interface Host {
  el: HTMLElement;
  field: boolean; /* true → deep-green scramble (dark text on lime) */
}

/* velocity source — fed by main.ts (Lenis); goes stale at rest */
let velocity = 0;
let lastFeed = 0;
export function feedVelocity(v: number) {
  velocity = v;
  lastFeed = performance.now();
}
export function currentVelocity() {
  return velocity;
}

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

function settledIsDark(el: HTMLElement): boolean {
  const c = getComputedStyle(el).color;
  const m = c.match(/\d+(\.\d+)?/g);
  if (!m) return false;
  const [r, g, b] = m.map(Number);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.45;
}

export function initScramble() {
  if (reduced) return;

  const slots: Slot[] = [];
  const hosts: Host[] = [];

  const addHost = (el: HTMLElement, chars: HTMLElement[]) => {
    if (!chars.length) return;
    hosts.push({ el, field: settledIsDark(chars[0]) });
    chars.forEach((c) => {
      slots.push({
        el: c,
        orig: c.textContent ?? '',
        nextSwap: 0,
        swapEvery: SWAP_MIN + Math.random() * SWAP_JITTER,
        resolveAt: null,
      });
    });
  };

  /* char-split elements */
  document.querySelectorAll<HTMLElement>('[data-split="chars"]').forEach((host) => {
    addHost(host, [...host.querySelectorAll<HTMLElement>('.split-line > span')]);
  });

  /* whole-element targets (BR mark…) — split into chars on the fly */
  document.querySelectorAll<HTMLElement>('[data-scramble]').forEach((host) => {
    const text = host.textContent ?? '';
    host.setAttribute('aria-label', text);
    host.textContent = '';
    const sr = document.createElement('span');
    sr.className = 'sr-only';
    sr.textContent = text;
    host.appendChild(sr);
    const frag = document.createDocumentFragment();
    const chars: HTMLElement[] = [];
    for (const ch of text) {
      const wrap = document.createElement('span');
      wrap.setAttribute('aria-hidden', 'true');
      wrap.textContent = ch;
      frag.appendChild(wrap);
      chars.push(wrap);
    }
    host.appendChild(frag);
    addHost(host, chars);
  });

  if (!slots.length) return;

  const setClasses = (on: boolean) => {
    hosts.forEach((h) => {
      h.el.classList.toggle('is-scrambling', on);
      h.el.classList.toggle('is-scrambling--field', on && h.field);
    });
  };

  let active = false;
  let smoothed = 0;
  let waveStart = 0;
  let waveCleaned = true;

  const tick = (time: number, dtMs: number) => {
    const dt = Math.min(dtMs / 1000, 0.05);
    const atRest = performance.now() - lastFeed > 120;
    if (atRest) velocity = 0;
    const v = Math.abs(velocity) < 1 ? 0 : velocity;
    smoothed += (Math.abs(v) - smoothed) * Math.min(1, dt * 9);
    /* hysteresis: wake above 1.1, sleep below 0.5 */
    const threshold = active ? 0.5 : 1.1;
    const nowActive = smoothed > threshold;

    if (nowActive && !active) {
      active = true;
      waveCleaned = false;
      setClasses(true);
      slots.forEach((s) => {
        s.resolveAt = null;
        s.nextSwap = time + Math.random() * s.swapEvery;
      });
    } else if (!nowActive && active) {
      active = false;
      waveStart = time;
      /* settle wave: near-to-far by slot order */
      slots.forEach((s, i) => {
        s.resolveAt = time + (i / slots.length) * RESOLVE_WAVE + Math.random() * RESOLVE_JITTER;
      });
    }

    /* glyph churn / wave resolve — textContent only, never colors */
    for (const s of slots) {
      if (nowActive) {
        if (time >= s.nextSwap) {
          s.el.textContent = GLYPHS[(Math.random() * GLYPHS.length) | 0];
          s.nextSwap = time + s.swapEvery * (0.6 + Math.random() * 0.8);
        }
      } else if (s.resolveAt !== null && time >= s.resolveAt) {
        s.el.textContent = s.orig === ' ' ? '\u00A0' : s.orig;
        s.resolveAt = null;
      }
    }

    /* wave done → colors off (single class flip for every host) */
    if (!active && !waveCleaned && time - waveStart > RESOLVE_WAVE + RESOLVE_JITTER) {
      setClasses(false);
      waveCleaned = true;
    }
  };

  gsap.ticker.add((time, deltaTime) => tick(time, deltaTime));

  /*
    Watchdog — completely independent of the ticker and the state
    machine. If the page has been at rest for 400ms, the settled
    state is enforced: classes off, originals restored. Whatever
    went wrong upstream, this converges.
  */
  setInterval(() => {
    if (performance.now() - lastFeed <= 400) return;
    let dirty = hosts.some((h) => h.el.classList.contains('is-scrambling'));
    if (!dirty) dirty = slots.some((s) => s.resolveAt !== null);
    if (!dirty) return;
    active = false;
    waveCleaned = true;
    setClasses(false);
    slots.forEach((s) => {
      s.el.textContent = s.orig === ' ' ? '\u00A0' : s.orig;
      s.resolveAt = null;
    });
  }, 700);
}
