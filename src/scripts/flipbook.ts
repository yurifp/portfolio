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
import { mountDither, mountDitherIcon, type DitherHandle } from './dither';

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
    /* the mode decision must track the breakpoint: resizing across
       700px re-decides (clean reload — deterministic either side) */
    matchMedia('(max-width: 700px)').addEventListener('change', () => location.reload());
    return;
  }

  const frames = [...stage.querySelectorAll<HTMLElement>('[data-flip-frame]')];
  const frame = (name: string) => stage.querySelector<HTMLElement>(`[data-flip-frame="${name}"]`)!;
  const heroFrame = frame('hero');
  const limeFrame = frame('lime');
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
  /* (old whole-page odometers left with Stats — lime cards own theirs) */
  /* (the old whole-page odometer system left with Stats — the lime
     scene owns its per-card odometers below) */

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
        filmScroll.progress = self.progress;
        const p = self.progress;
        /* lime owns 12–30; snap (also lime) owns 30–72 */
        document.body.dataset.theme = p > 0.132 && p < 0.72 ? 'lime' : 'void';
        /* HUD ink scrub: light→ink as the lime wipe covers (13.0–13.5),
           back to light at snap exit (71.5–73) */
        const ramp = (x: number, a: number, b: number) => Math.min(1, Math.max(0, (x - a) / (b - a)));
        const mixT = ramp(p, 0.13, 0.135) * (1 - ramp(p, 0.715, 0.73));
        const r = Math.round(245 + (7 - 245) * mixT);
        const g = Math.round(240 + (2 - 240) * mixT);
        const b = Math.round(235 + (16 - 235) * mixT);
        document.documentElement.style.setProperty('--hud-ink', `rgb(${r},${g},${b})`);
        /* only the live frame takes pointer events */
        const live = p < 0.118 ? 'hero' : p >= 0.13 && p < 0.295 ? 'lime' : p >= 0.3 && p < 0.725 ? 'snap' : p > 0.93 ? 'foot' : '';
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
    /* hero must be FULLY gone before 12.0% (was ending at 14%) */
    .to(heroFrame, { autoAlpha: 0, duration: 0.03 }, 0.088);

  /* ============ THE LIME SCENE (12–30%) ============
     Fail-loud + one-role-per-element (postmortem: the old build left
     cards stuck at the opening clip because a CSS-baked initial state
     was never undone — opacity hit 1 while clip-path stayed at
     inset(0 100% 0 0) in real Chromium). Rules now: CSS base = the
     FINAL composed state; every tween is an explicit fromTo with
     unit-consistent strings; selectors resolve through qs() which
     THROWS on count mismatch; the whole scene lives in its own
     try/catch — if it fails, every other scene keeps working and the
     scene simply renders composed. */
  try {
    const qs = (scope: ParentNode, selector: string, expected: number): HTMLElement[] => {
      const found = [...scope.querySelectorAll<HTMLElement>(selector)];
      if (found.length !== expected) {
        throw new Error(`[lime] selector "${selector}" resolved ${found.length}/${expected} targets`);
      }
      return found;
    };
    const limeCards = qs(limeFrame, '[data-lime-card]', 14);
    const limeReveals = qs(limeFrame, '[data-lime-reveal]', 14);
    const limeLines = qs(limeFrame, '.lime-line', 7);
    const limeLabels = qs(limeFrame, '[data-lime-label]', 14);

    /* dither canvases — SVG logo paths via Path2D (real icons, not
       letters); built synchronously, one draw after mount */
    const ditherMap = new Map<HTMLCanvasElement, DitherHandle>();
    limeFrame.querySelectorAll<HTMLCanvasElement>('[data-dither-icon]').forEach((cv) => {
      ditherMap.set(cv, mountDitherIcon(cv, cv.dataset.iconPath || '', { ink: '#070210' }));
    });

    /* per-card odometers */
    const limeOdos = qs(limeFrame, '[data-lime-odo]', 4).map((el) => ({
      cols: [...el.querySelectorAll<HTMLElement>('.odo-digit__col')],
      target: el.dataset.limeOdo ?? '0',
    }));
    const applyLimeOdo = (idx: number, p: number) => {
      const o = limeOdos[idx];
      if (!o) return;
      const shown = Math.round(Number(o.target) * p)
        .toString()
        .padStart(o.cols.length, '0');
      o.cols.forEach((col, i) => {
        col.style.transform = `translateY(-${Number(shown[i] ?? 0) * 10}%)`;
      });
    };
    limeOdos.forEach((_, i) => applyLimeOdo(i, 0));

    /* 12.0–13.5 wipe in from the bottom (unit-consistent inset) */
    tl.set(limeFrame, { autoAlpha: 1 }, 0.12)
      .fromTo(limeFrame,
        { clipPath: 'inset(100% 0% 0% 0%)' },
        { clipPath: 'inset(0% 0% 0% 0%)', duration: 0.015 }, 0.12);

    /* 13.5–14.5 column lines draw top→bottom, staggered (7 lines,
       tighter stagger so the tail overlaps card 1 — no dead zone) */
    limeLines.forEach((line, i) => {
      tl.fromTo(line, { scaleY: 0 }, { scaleY: 1, duration: 0.006 }, 0.135 + i * 0.0008);
    });

    /* 14.0–27.4: eight entry windows, one per card, in board order
       (4 stats then 4 tools; starts 14.0 — no dead zone) */
    const windowDur = 0.02;
    const step = 0.0084;
    limeCards.forEach((unit, cardIdx) => {
      const at = 0.142 + cardIdx * step;

      /* 0–0.35 open: the REVEAL layer clip left→right (% units) */
      tl.fromTo(limeReveals[cardIdx],
        { clipPath: 'inset(0% 100% 0% 0%)', opacity: 0 },
        { clipPath: 'inset(0% 0% 0% 0%)', opacity: 1, duration: windowDur * 0.35 }, at);
      /* 0.2–0.6 label rises */
      tl.fromTo(limeLabels[cardIdx],
        { yPercent: 60, opacity: 0 },
        { yPercent: 0, opacity: 1, duration: windowDur * 0.4 }, at + windowDur * 0.2);
      /* 0.35–0.85 odometer rolls / number settles as a word */
      if (limeOdos[cardIdx]) {
        const prox = { p: 0 };
        tl.fromTo(prox, { p: 0 }, {
          p: 1,
          duration: windowDur * 0.5,
          onUpdate: () => applyLimeOdo(cardIdx, prox.p),
        }, at + windowDur * 0.35);
      }
      /* dither resolution tied to this card's window */
      const cv = unit.querySelector('[data-dither-icon]') as HTMLCanvasElement | null;
      const handle = cv ? ditherMap.get(cv) : undefined;
      if (handle) {
        const prox = { r: 6 };
        tl.fromTo(prox, { r: 6 }, {
          r: 28,
          duration: windowDur * 0.5,
          onUpdate: () => handle.draw(prox.r),
        }, at + windowDur * 0.35);
      }
    });

    /* 27.4–29.0 micro-parallax alternate by column (never static);
       scaled down with the cards (was ±8px at 5×3) */
    const parallaxPx = Math.max(4, Math.min(8, innerWidth * 0.003));
    limeCards.forEach((card, i) => {
      const col = i % 2 === 0 ? 1 : -1;
      tl.fromTo(card, { y: col * parallaxPx }, { y: col * -parallaxPx, duration: 0.016 }, 0.274);
    });

    /* 29.0–30.0 exit: cards up, wipe retracts up (stagger by column) */
    limeCards.forEach((card, i) => {
      tl.to(card, { yPercent: -40, duration: 0.008 }, 0.29 + (i % 7) * 0.0015);
    });
    tl.to(limeFrame, { clipPath: 'inset(0% 0% 100% 0%)', duration: 0.01 }, 0.29)
      .to(limeFrame, { autoAlpha: 0, duration: 0.001 }, 0.299);

    /* settle: dither first frame + fonts can change layout */
    requestAnimationFrame(() => ScrollTrigger.refresh());
  } catch (err) {
    /* fail loud, keep the rest of the film alive */
    const msg = '[flipbook] lime scene failed: ' + String(err);
    console.error(msg);
    (window.__pageErrors = window.__pageErrors || []).push(msg);
    /* CSS base is the composed state — the scene still shows */
    tl.set(limeFrame, { autoAlpha: 1 }, 0.12)
      .to(limeFrame, { autoAlpha: 0, duration: 0.01 }, 0.29);
  }

  /* ============ SNAP — the lime flipbook of cards ============ */
  const cards = [...snapFrame.querySelectorAll<HTMLElement>('[data-snap-card]')];
  const connectors = [...snapFrame.querySelectorAll<SVGLineElement>('[data-connector]')];
  tl.set(snapFrame, { autoAlpha: 1 }, 0.285);
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
  const workLead = workFrame.querySelector<HTMLElement>('section p');
  tl.set(workFrame, { autoAlpha: 1 }, 0.735);
  if (workLead) {
    tl.fromTo(workLead, { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.025 }, 0.735);
  }
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

  /* read-only probe for the test harness */
  (window as unknown as { __flipbook?: { progress: () => number; mode: string } }).__flipbook = {
    progress: () => filmScroll.progress,
    mode: 'desktop',
  };
}

/* the ScrollTrigger instance behind the film — kept module-scoped so
   the __flipbook probe can read true progress */
let filmScroll: { progress: number } = { progress: 0 };
