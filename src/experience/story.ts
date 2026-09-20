import gsap from 'gsap';
import { maskLines, progressScrub, reducedMotion } from './grammar';
import { experience } from './core';

/**
 * Storytelling driver — "one value, many destinations" without WebGL yet.
 *
 * The .story container spans N×100dvh of scroll; a single 0→1 progress (via
 * grammar.progressScrub) simultaneously drives:
 *   - each beat's opacity/translate (crossfade with dwell windows)
 *   - the background gradient (deep abyssal → bluer signal field)
 *   - the beat counter readout
 *   - line-mask reveals of beat titles, fired once per activation
 *
 * reduced-motion / no-JS: CSS renders beats stacked and fully visible; this
 * module never runs (see grammar.reducedMotion + the html.js CSS gates).
 */

const BEATS = 5;
/** fraction of the container scroll spent fading between adjacent beats */
const FADE = 0.1;

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function mixRgb(c1: [number, number, number], c2: [number, number, number], t: number) {
  return `rgb(${Math.round(lerp(c1[0], c2[0], t))}, ${Math.round(lerp(c1[1], c2[1], t))}, ${Math.round(lerp(c1[2], c2[2], t))})`;
}

/** deep abyssal → bluer signal field (the CSS-gradient stand-in for F4's WebGL) */
const BG_FROM: [number, number, number] = [12, 20, 32]; // #0C1420
const BG_TO: [number, number, number] = [10, 27, 46]; // #0A1B2E

let initialised = false;

export function initStory() {
  if (initialised || reducedMotion()) return;
  const story = document.querySelector<HTMLElement>('[data-story]');
  const stage = story?.querySelector<HTMLElement>('.story-stage');
  if (!story || !stage) return;
  initialised = true;

  const beats = [...story.querySelectorAll<HTMLElement>('.story-beat')];
  const bg = story.querySelector<HTMLElement>('[data-story-bg]');
  const counter = story.querySelector<HTMLElement>('[data-story-count]');
  const revealed = new Set<number>();

  function activate(beatIndex: number) {
    if (revealed.has(beatIndex)) return;
    revealed.add(beatIndex);
    const title = beats[beatIndex]?.querySelector<HTMLElement>('[data-story-title]');
    if (title) maskLines(title, { delay: 0.05 });
  }

  progressScrub(story, (p) => {
    const scaled = p * (BEATS - 1); // 0..4 in beat units
    beats.forEach((beat, i) => {
      const d = scaled - i;
      // each beat dwells at its station and fades out over the next FADE window
      let o = 1 - Math.min(Math.abs(d) / FADE, 1);
      if (i === 0 && d < 0) o = 1; // first beat starts fully visible
      if (i === BEATS - 1 && d > 0) o = 1; // last beat holds until handoff
      const drift = d < 0 ? d * FADE * 40 : d * 40; // parallax drift, px
      beat.style.opacity = o.toFixed(3);
      beat.style.transform = `translateY(${drift.toFixed(1)}px)`;
      beat.style.visibility = o <= 0.001 ? 'hidden' : 'visible';
    });

    const activeIndex = Math.min(BEATS - 1, Math.max(0, Math.round(scaled)));
    activate(activeIndex);
    if (counter) counter.textContent = String(activeIndex + 1).padStart(2, '0');

    if (bg) {
      const t = p;
      bg.style.backgroundColor = mixRgb(BG_FROM, BG_TO, t);
      // signal glow drifts with progress — the CSS stand-in for the camera
      bg.style.backgroundImage = `radial-gradient(60% 55% at ${25 + t * 50}% ${70 - t * 45}%, rgba(242,180,65,${(0.05 + t * 0.05).toFixed(3)}) 0%, transparent 70%)`;
    }
  });

  // First beat is revealed on arrival (after fonts settle)
  const ready = () => activate(0);
  if (document.readyState === 'complete') ready();
  else window.addEventListener('load', ready, { once: true });

  // Keep Lenis aware of the tall container (ScrollTrigger already is)
  void experience;
}
