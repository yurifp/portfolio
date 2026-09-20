import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';

gsap.registerPlugin(ScrollTrigger, SplitText);

/**
 * Motion grammar — the whole animated vocabulary of the site, in one module.
 *
 *   1. maskLines()      reveal text line by line through an overflow mask
 *   2. settle()         heavy arrival: rise + fade with the settle ease, batched
 *   3. progressScrub()  bind a callback to a 0→1 scroll progress on an element
 *
 * Everything reads the shared tokens (durations/eases mirror the CSS custom
 * properties). Nothing else in the codebase should hand-roll an animation —
 * new effects are new compositions of these three.
 */

export const EASE = {
  settle: 'cubic-bezier(0.16, 1, 0.3, 1)',
  snap: 'cubic-bezier(0.83, 0, 0.17, 1)',
  glide: 'cubic-bezier(0.37, 0, 0.63, 1)',
} as const;

export const DUR = { s: 0.45, m: 0.8, l: 1.4 } as const;
export const STAGGER = 0.045;

export const reducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * 1. maskLines — line-masked text reveal (the reference's signature move).
 * Each line is wrapped in an overflow-hidden mask; lines rise from below with
 * a slight rotation, staggered. Returns the SplitText instance for disposal.
 */
export function maskLines(el: HTMLElement, opts: { delay?: number; start?: string } = {}) {
  if (reducedMotion()) return null;

  const split = new SplitText(el, {
    type: 'lines',
    linesClass: 'mask-line-inner',
    mask: 'lines',
  });

  gsap.from(split.lines, {
    yPercent: 115,
    rotate: 2,
    autoAlpha: 0,
    duration: DUR.l,
    delay: opts.delay ?? 0,
    ease: EASE.settle,
    stagger: STAGGER * 2,
    scrollTrigger: opts.start
      ? { trigger: el, start: opts.start, once: true }
      : undefined,
  });

  return split;
}

/**
 * 2. settle — the arrival pattern. Elements start translated + transparent
 * and settle into place, staggered, once when entering the viewport.
 * Skips elements inside astro-islands (those animate post-hydration, see
 * ProjectFilter) to keep React's hydration diff clean.
 */
export function settle(selector: string, opts: { y?: number; start?: string; stagger?: number } = {}) {
  if (reducedMotion()) return;

  const els = gsap.utils
    .toArray<HTMLElement>(selector)
    .filter((el) => !el.closest('astro-island'));
  if (!els.length) return;

  gsap.set(els, { y: opts.y ?? 14 });
  ScrollTrigger.batch(els, {
    start: opts.start ?? 'top 95%',
    once: true,
    onEnter: (batch) =>
      gsap.to(batch, {
        autoAlpha: 1,
        y: 0,
        duration: DUR.m,
        ease: EASE.settle,
        stagger: opts.stagger ?? 0.12,
      }),
  });
}

/**
 * 3. progressScrub — "one value, many destinations". Maps an element's scroll
 * journey to 0→1 and calls `apply` every frame while it moves. This is the
 * seam the WebGL stage plugs into (Phase F4) without knowing about Three.
 */
export function progressScrub(
  trigger: HTMLElement,
  apply: (progress: number) => void,
  opts: { start?: string; end?: string } = {},
) {
  if (reducedMotion()) return;
  ScrollTrigger.create({
    trigger,
    start: opts.start ?? 'top top',
    end: opts.end ?? 'bottom top',
    scrub: true,
    onUpdate: (self) => apply(self.progress),
  });
}
