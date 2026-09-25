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

const BEATS = 3;
/**
 * Transition window: fades happen ONLY in a short zone centered between two
 * stations (F wide in beat units), so beats crossfade — the screen is never
 * blank. Each beat holds full opacity for ~84% of its scroll span.
 */
const FADE = 0.16;
/** vertical drift (px) while entering/leaving — gives the scroll direction */
const DRIFT = 36;

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
  const revealed = new Set<number>();

  function activate(beatIndex: number) {
    if (revealed.has(beatIndex)) return;
    revealed.add(beatIndex);
    const title = beats[beatIndex]?.querySelector<HTMLElement>('[data-story-title]');
    if (title) maskLines(title, { delay: 0.05 });
  }

  progressScrub(story, apply);
  apply(0); // initial frame: the scrub callback only fires on scroll

  function apply(p: number) {
    experience.state.progress = p; // shared: the WebGL stage reads this every frame
    const s = p * (BEATS - 1); // 0..2 in beat units
    const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
    beats.forEach((beat, i) => {
      // enter during [i-0.5-F/2, i-0.5+F/2], exit during [i+0.5-F/2, i+0.5+F/2];
      // edge beats skip the absent side. At the midpoint of a transition both
      // beats sit at ~0.5 — a true crossfade, content on screen the whole time.
      let o = 1;
      if (i > 0) o = Math.min(o, clamp01((s - (i - 0.5 - FADE / 2)) / FADE));
      if (i < BEATS - 1) o = Math.min(o, clamp01((i + 0.5 + FADE / 2 - s) / FADE));
      // directional drift: incoming rises from below, outgoing sinks up-screen
      let dy = 0;
      if (i > 0 && s < i) dy = (1 - o) * DRIFT;
      if (i < BEATS - 1 && s > i) dy = -(1 - o) * DRIFT;
      beat.style.opacity = o.toFixed(3);
      beat.style.transform = `translateY(${dy.toFixed(1)}px)`;
      beat.style.visibility = o <= 0.001 ? 'hidden' : 'visible';
    });

    const activeIndex = Math.min(BEATS - 1, Math.max(0, Math.round(scaled)));
    activate(activeIndex);

    if (bg) {
      bg.style.backgroundColor = mixRgb(BG_FROM, BG_TO, p);
      // signal glow drifts with progress — the CSS stand-in for the camera
      bg.style.backgroundImage = `radial-gradient(60% 55% at ${25 + p * 50}% ${70 - p * 45}%, rgba(242,180,65,${(0.05 + p * 0.05).toFixed(3)}) 0%, transparent 70%)`;
    }
  }

  // First beat is revealed on arrival (after fonts settle)
  const ready = () => activate(0);
  if (document.readyState === 'complete') ready();
  else window.addEventListener('load', ready, { once: true });

  // Keep Lenis aware of the tall container (ScrollTrigger already is)
  void experience;
}
