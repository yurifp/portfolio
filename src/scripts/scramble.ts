/*
  Scroll roulette — characters gamble while the page moves.
  Green glyphs cycling while scroll velocity is alive; when it dies,
  a left-to-right wave resolves each char back to its true letter and
  the inherited color. Registered targets: char-split spans plus any
  [data-scramble] element (BR mark).
*/
import { gsap } from 'gsap';

const GLYPHS = '!<>-_\\/[]{}—=+*^?#______ABCDEFGHKMNPRSTUVWXYZ0123456789';
/* gsap.ticker time is seconds — keep every interval in seconds */
const SWAP_MIN = 0.055;
const SWAP_JITTER = 0.07;
const RESOLVE_WAVE = 0.42;
const RESOLVE_JITTER = 0.12;

interface CharSlot {
  el: HTMLElement;
  orig: string;
  nextSwap: number;
  swapEvery: number;
  resolveAt: number | null;
}

/* velocity source — fed by main.ts (Lenis); goes stale when the
   emitter stops (Lenis only emits while scrolling) */
let velocity = 0;
let lastFeed = 0;
export function feedVelocity(v: number) {
  velocity = v;
  lastFeed = performance.now();
}

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

function scrambleColorFor(el: HTMLElement): string {
  /* bright lime signals on dark grounds (light settled text);
     deep green when the text sits dark on the lime field */
  const c = getComputedStyle(el).color;
  const m = c.match(/\d+(\.\d+)?/g);
  if (m) {
    const [r, g, b] = m.map(Number);
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    if (lum >= 0.45) return '#9df133';
  }
  return '#2e7a0c';
}

export function initScramble() {
  if (reduced) return;

  const slots: CharSlot[] = [];

  const register = (el: HTMLElement, chars: HTMLElement[]) => {
    chars.forEach((c, i) => {
      slots.push({
        el: c,
        orig: c.textContent ?? '',
        nextSwap: 0,
        swapEvery: SWAP_MIN + Math.random() * SWAP_JITTER,
        resolveAt: null,
      });
      void i;
    });
  };

  /* char-split elements */
  document.querySelectorAll<HTMLElement>('[data-split="chars"]').forEach((host) => {
    const chars = [...host.querySelectorAll<HTMLElement>('.split-line > span')];
    register(host, chars);
  });

  /* whole-element targets (BR mark, wordmark…) — split on the fly */
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
    register(host, chars);
  });

  if (!slots.length) return;

  let smoothed = 0;
  let active = false;
  let waveStart = 0;

  const tick = (time: number, dtMs: number) => {
    const dt = Math.min(dtMs / 1000, 0.05);
    /* no scroll events for 120ms → the page is at rest */
    if (performance.now() - lastFeed > 120) velocity = 0;
    smoothed += (Math.abs(velocity) - smoothed) * Math.min(1, dt * 9);
    const nowActive = smoothed > 0.55;

    if (nowActive && !active) {
      active = true;
      /* wake every slot */
      slots.forEach((s) => {
        s.resolveAt = null;
        s.nextSwap = time + Math.random() * s.swapEvery;
        s.el.style.color = scrambleColorFor(s.el);
      });
    } else if (!nowActive && active) {
      active = false;
      waveStart = time;
      /* schedule the settling wave — near-to-far by slot order */
      slots.forEach((s, i) => {
        s.resolveAt = time + (i / slots.length) * RESOLVE_WAVE + Math.random() * RESOLVE_JITTER;
      });
    }

    for (const s of slots) {
      if (active) {
        if (time >= s.nextSwap) {
          s.el.textContent = GLYPHS[(Math.random() * GLYPHS.length) | 0];
          s.nextSwap = time + s.swapEvery * (0.6 + Math.random() * 0.8);
        }
      } else if (s.resolveAt !== null && time >= s.resolveAt) {
        s.el.textContent = s.orig === ' ' ? '\u00A0' : s.orig;
        s.el.style.color = '';
        s.resolveAt = null;
      }
    }
    void waveStart;
  };

  gsap.ticker.add((time, deltaTime) => tick(time, deltaTime));

  /* native-scroll fallback when Lenis is off (reduced motion already
     returned; this covers programmatic scrollTo) */
  if (!document.documentElement.classList.contains('lenis')) {
    let lastY = scrollY;
    gsap.ticker.add(() => {
      feedVelocity((scrollY - lastY) * 0.7);
      lastY = scrollY;
    });
  }
}
