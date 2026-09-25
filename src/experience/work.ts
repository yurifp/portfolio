import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { reducedMotion } from './grammar';

gsap.registerPlugin(ScrollTrigger);

/**
 * Horizontal-inside-vertical Work section.
 *
 * The section pins for exactly `track.scrollWidth - viewport` pixels while the
 * track translates sideways — same scroll, one gesture, no navigation. The
 * amber signal path is a single SVG polyline whose dot rides getPointAtLength
 * at the current progress (path length cached, measured only on refresh).
 *
 * scrub: true (boolean) — Lenis already owns smoothing; no numeric catch-up.
 * Reduced-motion / no-JS: the section never gets .is-h, CSS keeps a plain
 * vertical stack with identical content.
 */
export function initWork() {
  if (reducedMotion()) return;
  const section = document.querySelector<HTMLElement>('[data-horizontal-section]');
  const track = document.querySelector<HTMLElement>('[data-horizontal-track]');
  if (!section || !track) return;
  if (section.classList.contains('is-h')) return; // astro:page-load re-entry

  section.classList.add('is-h');

  const dot = section.querySelector<SVGCircleElement>('[data-signal-dot]');
  const path = section.querySelector<SVGPathElement>('[data-signal-path]');
  let pathLen = 0;
  const measurePath = () => {
    if (!path) return;
    try {
      pathLen = path.getTotalLength();
    } catch {
      pathLen = 0;
    }
  };
  measurePath();

  const distance = () => Math.max(0, track.scrollWidth - section.clientWidth);

  gsap.to(track, {
    x: () => -distance(),
    ease: 'none',
    scrollTrigger: {
      trigger: section,
      start: 'top top',
      end: () => `+=${distance()}`,
      scrub: true,
      pin: true,
      anticipatePin: 1,
      invalidateOnRefresh: true,
      onUpdate: (self) => {
        if (!dot || !pathLen) return;
        const pt = path.getPointAtLength(self.progress * pathLen);
        dot.setAttribute('cx', String(pt.x));
        dot.setAttribute('cy', String(pt.y));
      },
    },
  });

  // Font swap changes panel widths → distance must be recomputed after fonts
  // (and on any later refresh, via invalidateOnRefresh above).
  document.fonts?.ready.then(() => {
    measurePath();
    ScrollTrigger.refresh();
  });
  ScrollTrigger.addEventListener('refresh', measurePath);
}
