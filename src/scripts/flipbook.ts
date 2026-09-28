/*
  THE FLIPBOOK — one stage, one master timeline.

  The stage is pinned for the whole track; the wheel is the crank that
  advances the film. Nothing here runs on a timer: every beat is a
  position on the timeline (scrub), so stopping mid-scroll holds a
  mid-animation frame and scrolling back rewinds the film exactly.
  Frames: hero → marquee → stats → snap (lime) → worked → foot.

  Forbidden by design: IntersectionObserver, setTimeout, CSS entry
  transitions. Only transform/opacity (plus the accordion's scrubbed
  grid var and the odometer's scrubbed translateY).
*/
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { splitChars, splitWords } from './main';

gsap.registerPlugin(ScrollTrigger);

export function initFlipbook() {
  const stage = document.querySelector<HTMLElement>('[data-flip-stage]');
  const track = document.querySelector<HTMLElement>('[data-flip-track]');
  if (!stage || !track) return;

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const mobile = matchMedia('(max-width: 700px)').matches;

  if (reduced || mobile) {
    /* fallback: a plain stacked page, fully visible */
    stage.dataset.static = '';
    track.style.height = 'auto';
    document.querySelectorAll<HTMLElement>('[data-split]').forEach((el) => {
      /* split anyway so the roulette can run, but no film */
      if (el.dataset.split === 'chars') splitChars(el);
      else splitWords(el);
    });
    return;
  }

  const frames = [...stage.querySelectorAll<HTMLElement>('[data-flip-frame]')];
  const frame = (name: string) => stage.querySelector<HTMLElement>(`[data-flip-frame="${name}"]`)!;
  const heroFrame = frame('hero');
  const marqFrame = frame('marquee');
  const statsFrame = frame('stats');
  const snapFrame = frame('snap');
  const workFrame = frame('work');
  const footFrame = frame('foot');

  /* split all text hosts inside the film (main's reveal system skips
     the stage — this timeline owns every letter) */
  const charsOf = (sel: string) => {
    const host = stage.querySelector<HTMLElement>(sel);
    if (!host) return [] as HTMLElement[];
    if (host.dataset.split === 'chars') return splitChars(host);
    return [] as HTMLElement[];
  };
  const heroNameChars = [
    ...stage.querySelectorAll<HTMLElement>('#about [data-hero-name] span[data-split="chars"]'),
  ].flatMap((h) => splitChars(h));
  const snapHeadChars = charsOf('[data-stage-split]');
  const workHeadChars = charsOf('[data-flip-frame="work"] h2[data-split="chars"]');
  const footCtaChars = charsOf('[data-flip-frame="foot"] a[data-split="chars"]');

  /* odometers — digits roll by scroll position */
  const odos: Array<{ cols: HTMLElement[]; target: string }> = [];
  stage.querySelectorAll<HTMLElement>('[data-odo]').forEach((el) => {
    odos.push({
      cols: [...el.querySelectorAll<HTMLElement>('.odo-digit__col')],
      target: el.dataset.odo ?? '0',
    });
  });
  const applyOdo = (p: number) => {
    odos.forEach(({ cols, target }) => {
      const shown = Math.round(Number(target) * p)
        .toString()
        .padStart(cols.length, '0');
      cols.forEach((col, i) => {
        col.style.transform = `translateY(-${Number(shown[i] ?? 0) * 10}%)`;
      });
    });
  };
  applyOdo(0);
  const odoProxy = { p: 0 };

  const tl = gsap.timeline({
    defaults: { ease: 'none' },
    scrollTrigger: {
      /* the stage is CSS-sticky inside the track — the pin is native,
         the crank is the track's own scroll distance */
      trigger: track,
      start: 'top top',
      end: 'bottom bottom',
      scrub: 0.55,
      invalidateOnRefresh: true,
      onUpdate(self) {
        const p = self.progress;
        /* the lime field owns this band of the film */
        document.body.dataset.theme = p > 0.3 && p < 0.72 ? 'lime' : 'void';
        /* only the live frame takes pointer events */
        const live = p < 0.13 ? 'hero' : p >= 0.3 && p < 0.725 ? 'snap' : p > 0.93 ? 'foot' : '';
        frames.forEach((f) => f.classList.toggle('is-live', f.dataset.flipFrame === live));
      },
    },
  });

  /* ============ HERO — visible at 0, exits in place ============ */
  gsap.set(heroFrame, { autoAlpha: 1 });
  if (heroNameChars.length) {
    tl.to(heroNameChars, { yPercent: -130, stagger: 0.02, duration: 0.05 }, 0.05);
  }
  tl.to('[data-flip-frame="hero"] [data-choreo="bio"] p, [data-flip-frame="hero"] [data-choreo="bio"] .mono-tiny',
    { yPercent: -120, opacity: 0, stagger: 0.012, duration: 0.05 }, 0.04)
    .to('[data-choreo="portrait"]', { yPercent: -26, scale: 0.92, opacity: 0, duration: 0.05 }, 0.05)
    .to('[data-choreo="br"]', { yPercent: -40, opacity: 0, duration: 0.05 }, 0.045)
    .to('#about [data-choreo="meta"]', { opacity: 0, duration: 0.03 }, 0.04)
    .to('[data-flip-frame="hero"] [data-fade], [data-flip-frame="hero"] [data-avail]',
      { opacity: 0, y: -18, stagger: 0.006, duration: 0.04 }, 0.05)
    .to(heroFrame, { autoAlpha: 0, duration: 0.035 }, 0.105);

  /* ============ MARQUEE band passes ============ */
  tl.set(marqFrame, { autoAlpha: 1 }, 0.1)
    .fromTo(marqFrame, { yPercent: 8 }, { yPercent: -8, duration: 0.06 }, 0.1)
    .to(marqFrame, { autoAlpha: 0, duration: 0.02 }, 0.155);

  /* ============ STATS — odometers roll by crank ============ */
  tl.set(statsFrame, { autoAlpha: 1 }, 0.115)
    .fromTo(statsFrame, { yPercent: 6 }, { yPercent: 0, duration: 0.05 }, 0.115)
    .to(odoProxy, {
      p: 1,
      duration: 0.1,
      onUpdate: () => applyOdo(odoProxy.p),
    }, 0.14)
    .fromTo('[data-flip-frame="stats"] .mono-tiny.text-dim',
      { y: 26, opacity: 0 }, { y: 0, opacity: 1, stagger: 0.008, duration: 0.04 }, 0.185)
    .fromTo('[data-flip-frame="stats"] [data-fade]',
      { y: 26, opacity: 0 }, { y: 0, opacity: 1, stagger: 0.008, duration: 0.035 }, 0.225)
    .to(statsFrame, { autoAlpha: 0, yPercent: -7, duration: 0.045 }, 0.27);

  /* ============ SNAP — the lime flipbook of cards ============ */
  const cards = [...snapFrame.querySelectorAll<HTMLElement>('[data-snap-card]')];
  const connectors = [...snapFrame.querySelectorAll<SVGLineElement>('[data-connector]')];
  tl.set(snapFrame, { autoAlpha: 1 }, 0.3);
  tl.fromTo('[data-snap-label]', { opacity: 0 }, { opacity: 1, stagger: 0.012, duration: 0.025 }, 0.305);
  if (snapHeadChars.length) {
    tl.fromTo(snapHeadChars, { yPercent: 120 }, { yPercent: 0, stagger: 0.012, duration: 0.045 }, 0.31);
  }
  tl.fromTo('[data-snap-viewall]', { yPercent: 130 }, { yPercent: 0, duration: 0.03 }, 0.345);

  const beat = 0.0365;
  cards.forEach((card, i) => {
    const at = 0.355 + i * beat;
    const side = i % 2 === 0 ? -1 : 1;
    tl.fromTo(
      card,
      { x: side * (90 + (i % 3) * 40), y: 110, rotation: side * 5, opacity: 0, scale: 0.72 },
      { x: 0, y: 0, rotation: 0, opacity: 1, scale: 1, duration: 0.05 },
      at,
    );
    tl.fromTo(
      card.querySelectorAll('[data-card-meta]'),
      { y: 22, opacity: 0 },
      { y: 0, opacity: 1, stagger: 0.01, duration: 0.02 },
      at + 0.028,
    );
  });
  connectors.forEach((line, i) => {
    tl.fromTo(line, { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.022 }, 0.355 + (i + 1) * beat + 0.02);
  });
  tl.fromTo(snapFrame, { scale: 0.988 }, { scale: 1, duration: 0.04 }, 0.665)
    .to(snapFrame, { autoAlpha: 0, duration: 0.035 }, 0.70);

  /* ============ WORKED AT — accordion opens by crank ============ */
  const rows = [...workFrame.querySelectorAll<HTMLElement>('.wa-item')];
  tl.set(workFrame, { autoAlpha: 1 }, 0.735)
    .fromTo('[data-flip-frame="work"] > section > p',
      { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.025 }, 0.735);
  if (workHeadChars.length) {
    tl.fromTo(workHeadChars, { yPercent: 120 }, { yPercent: 0, stagger: 0.008, duration: 0.035 }, 0.74);
  }
  rows.forEach((row, i) => {
    tl.fromTo(row, { x: -44, opacity: 0 }, { x: 0, opacity: 1, duration: 0.03 }, 0.765 + i * 0.012);
    /* panel unfolds + description rises, driven by position */
    tl.to(row, { '--wa-rows': '1fr', duration: 0.024 }, 0.8 + i * 0.028);
    tl.fromTo(row.querySelector('.wa-panel p'),
      { y: 18, opacity: 0 }, { y: 0, opacity: 1, duration: 0.02 }, 0.808 + i * 0.028);
    const plus = row.querySelector('.wa-plus');
    if (plus) tl.fromTo(plus, { rotate: 0 }, { rotate: 45, duration: 0.02 }, 0.8 + i * 0.028);
  });
  tl.to(workFrame, { autoAlpha: 0, yPercent: -6, duration: 0.04 }, 0.898);

  /* ============ FOOTER — the last pages ============ */
  tl.set(footFrame, { autoAlpha: 1 }, 0.935)
    .fromTo('[data-flip-frame="foot"] > footer > div > .mono-tiny',
      { y: 18, opacity: 0 }, { y: 0, opacity: 1, duration: 0.025 }, 0.935);
  if (footCtaChars.length) {
    tl.fromTo(footCtaChars, { yPercent: 120 }, { yPercent: 0, stagger: 0.0025, duration: 0.028 }, 0.938);
  }
  tl.fromTo('[data-flip-frame="foot"] [data-fade]',
    { y: 26, opacity: 0 }, { y: 0, opacity: 1, stagger: 0.004, duration: 0.022 }, 0.948)
    .fromTo('[data-flip-frame="foot"] .hairline-h', { scaleX: 0 }, { scaleX: 1, duration: 0.028, transformOrigin: 'left' }, 0.95);

  /* anchor: the film is EXACTLY 1.0 long — scroll progress maps
     1:1 to timeline positions, bands land where the storyboard says */
  tl.set({}, {}, 1);

  /* refresh when the world settles — pins and bands stay true */
  document.fonts?.ready.then(() => ScrollTrigger.refresh());
  addEventListener('load', () => ScrollTrigger.refresh());
}
