/*
  Field runtime — one entry, every behavior.
  Lenis smooth scroll + GSAP ScrollTrigger orchestration:
  split reveals, odometers, theme flips, cursor, menu, preloader,
  progress rail, nav clock, page wipes.
*/
import Lenis from 'lenis';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { initScramble, feedVelocity, currentVelocity } from './scramble';

gsap.registerPlugin(ScrollTrigger);

/* dev-only: this runtime owns the whole page (tickers, controllers,
   listeners). A soft HMR update would re-execute the module against
   a live page — half-installed controllers fighting old ones. Decline
   hot updates so Vite falls back to a FULL PAGE RELOAD: what you see
   in dev is always the code on disk. */
if (import.meta.hot) {
  (import.meta.hot as unknown as { decline?: () => void }).decline?.();
}

const prefersReduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ------------------------------------------------------------------ */
/* smooth scroll                                                        */
/* ------------------------------------------------------------------ */
let lenis: Lenis | null = null;

function initLenis() {
  if (prefersReduced) return;
  /* flipbook crank: lerp smoothing (0.1) — the wheel charges inertia,
     the timeline plays through it */
  lenis = new Lenis({
    lerp: 0.1,
    wheelMultiplier: 1,
    touchMultiplier: 1.6,
  });
  lenis.on('scroll', (e: { velocity: number }) => feedVelocity(e.velocity));
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((t) => lenis?.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);
}

export function scrollTo(target: string | HTMLElement | number, offset = 0) {
  if (lenis) lenis.scrollTo(target as never, { offset });
  else if (typeof target === 'number') scrollToPolyfill(target);
  else
    (typeof target === 'string' ? document.querySelector(target) : target)?.scrollIntoView();
}

function scrollToPolyfill(y: number) {
  window.scrollTo({ top: y, behavior: 'smooth' });
}

/* ------------------------------------------------------------------ */
/* split text — chars for headings, words for body                      */
/* ------------------------------------------------------------------ */
export function splitChars(el: HTMLElement) {
  const text = el.textContent ?? '';
  el.textContent = '';
  /* accessible original + hidden visual chars */
  const sr = document.createElement('span');
  sr.className = 'sr-only';
  sr.textContent = text;
  el.appendChild(sr);
  const frag = document.createDocumentFragment();
  for (const ch of text) {
    const wrap = document.createElement('span');
    wrap.className = 'split-line';
    wrap.setAttribute('aria-hidden', 'true');
    const inner = document.createElement('span');
    inner.textContent = ch === ' ' ? '\u00A0' : ch;
    wrap.appendChild(inner);
    frag.appendChild(wrap);
  }
  el.appendChild(frag);
  return [...el.querySelectorAll<HTMLElement>('.split-line > span')];
}

export function splitWords(el: HTMLElement) {
  const text = el.textContent ?? '';
  el.textContent = '';
  const sr = document.createElement('span');
  sr.className = 'sr-only';
  sr.textContent = text;
  el.appendChild(sr);
  const frag = document.createDocumentFragment();
  for (const word of text.split(/\s+/)) {
    const wrap = document.createElement('span');
    wrap.className = 'split-line';
    wrap.setAttribute('aria-hidden', 'true');
    const inner = document.createElement('span');
    inner.textContent = word;
    wrap.appendChild(inner);
    frag.appendChild(wrap);
    frag.append(' ');
  }
  el.appendChild(frag);
  return [...el.querySelectorAll<HTMLElement>('.split-line > span')];
}

function initSplits() {
  /* FLIPBOOK: every reveal is scrubbed — tied to scroll POSITION, not
     time. Each pixel of scroll moves letters; scrolling back un-moves
     them. Elements inside the pinned stage are owned by its timeline. */
  const inStage = (el: Element) => !!el.closest('[data-art-stage]');
  document.querySelectorAll<HTMLElement>('[data-split="chars"]').forEach((el) => {
    const chars = splitChars(el);
    if (prefersReduced || inStage(el)) return;
    gsap.fromTo(
      chars,
      { yPercent: 115 },
      {
        yPercent: 0,
        ease: 'none',
        stagger: 0.02,
        scrollTrigger: { trigger: el, start: 'top 94%', end: 'top 45%', scrub: 0.6 },
      },
    );
  });
  document.querySelectorAll<HTMLElement>('[data-split="words"]').forEach((el) => {
    const words = splitWords(el);
    if (prefersReduced || inStage(el)) return;
    gsap.fromTo(
      words,
      { yPercent: 115 },
      {
        yPercent: 0,
        ease: 'none',
        stagger: 0.012,
        scrollTrigger: { trigger: el, start: 'top 94%', end: 'top 50%', scrub: 0.6 },
      },
    );
  });
  if (prefersReduced) return;
  document.querySelectorAll<HTMLElement>('[data-fade]').forEach((el) => {
    if (inStage(el)) return;
    gsap.fromTo(
      el,
      { y: 44, opacity: 0 },
      {
        y: 0,
        opacity: 1,
        ease: 'none',
        scrollTrigger: { trigger: el, start: 'top 96%', end: 'top 62%', scrub: 0.6 },
      },
    );
  });
}

/* ------------------------------------------------------------------ */
/* odometers — digits roll with SCROLL POSITION: every tick of the
   wheel moves the columns, both directions */
/* ------------------------------------------------------------------ */
function initOdometers() {
  document.querySelectorAll<HTMLElement>('[data-odo]').forEach((el) => {
    const target = el.dataset.odo ?? '0';
    const cols = [...el.querySelectorAll<HTMLElement>('.odo-digit__col')];
    const apply = (p: number) => {
      const shown = Math.round(Number(target) * p)
        .toString()
        .padStart(cols.length, '0');
      cols.forEach((col, i) => {
        const d = Number(shown[i] ?? 0);
        col.style.transform = `translateY(-${d * 10}%)`;
      });
    };
    if (prefersReduced) {
      apply(1);
      return;
    }
    apply(0);
    ScrollTrigger.create({
      trigger: el,
      start: 'top 97%',
      end: 'top 55%',
      scrub: 0.35,
      onUpdate: (self) => apply(self.progress),
    });
  });
}

/* ------------------------------------------------------------------ */
/* artboard cards (outside the stage) — scrubbed clip reveals          */
/* ------------------------------------------------------------------ */
function initCardEffects() {
  if (prefersReduced) return;
  document.querySelectorAll<HTMLElement>('[data-art-card]').forEach((card) => {
    const speed = Number(card.dataset.speed ?? 0);
    if (speed !== 0) {
      gsap.to(card, {
        yPercent: speed,
        ease: 'none',
        scrollTrigger: {
          trigger: card.closest('[data-art-scatter]') ?? card,
          start: 'top bottom',
          end: 'bottom top',
          scrub: 1.1,
        },
      });
    }
    const img = card.querySelector<HTMLElement>('.art-card__img');
    if (img) {
      gsap.fromTo(
        img,
        { clipPath: 'inset(12% 18% 12% 18%)', opacity: 0.4 },
        {
          clipPath: 'inset(0% 0% 0% 0%)',
          opacity: 1,
          ease: 'none',
          scrollTrigger: { trigger: card, start: 'top 96%', end: 'top 55%', scrub: 0.6 },
        },
      );
    }
    const metas = card.querySelectorAll<HTMLElement>('[data-card-meta]');
    if (metas.length) {
      gsap.fromTo(
        metas,
        { y: 26, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          ease: 'none',
          stagger: 0.08,
          scrollTrigger: { trigger: card, start: 'top 96%', end: 'top 62%', scrub: 0.6 },
        },
      );
    }
  });
}

/* ------------------------------------------------------------------ */
/* THE FLIPBOOK — Snap-shots pinned stage. The viewport locks on the
   lime field and every scroll beat turns a page: heading flips in,
   a card flies from its side with rotation, its meta rises, a
   connector draws, the collage accumulates. Back up = un-flip.
/* ------------------------------------------------------------------ */
function initSnapshots() {
  const stage = document.querySelector<HTMLElement>('[data-art-stage]');
  if (!stage) return;
  const cards = [...stage.querySelectorAll<HTMLElement>('[data-snap-card]')];
  if (!cards.length) return;

  /* mobile: no pin — cards stack in normal flow (CSS handles it) */
  if (prefersReduced || matchMedia('(max-width: 700px)').matches) {
    stage.querySelectorAll<HTMLElement>('[data-snap-label], [data-snap-viewall]').forEach((el) => (el.style.opacity = '1'));
    return;
  }

  const headChars = stage.querySelectorAll('[data-stage-split] .split-line > span');
  const connectors = [...stage.querySelectorAll<SVGLineElement>('[data-connector]')];
  const labels = stage.querySelectorAll('[data-snap-label]');
  const viewAll = stage.querySelector<HTMLElement>('[data-snap-viewall]');

  const tl = gsap.timeline({
    defaults: { ease: 'none' },
    scrollTrigger: {
      trigger: stage,
      start: 'top top',
      end: '+=340%',
      pin: true,
      scrub: 0.7,
      anticipatePin: 1,
      /* the lime field owns the theme for the whole pin */
      onToggle(self) {
        document.body.dataset.theme = self.isActive ? 'lime' : 'void';
      },
    },
  });

  /* page 0: corner labels + heading flips */
  tl.fromTo(labels, { opacity: 0 }, { opacity: 1, duration: 0.04, stagger: 0.015 }, 0);
  if (headChars.length) {
    tl.fromTo(headChars, { yPercent: 120 }, { yPercent: 0, duration: 0.34, stagger: 0.028 }, 0.02);
  }
  if (viewAll) {
    tl.fromTo(viewAll, { yPercent: 130 }, { yPercent: 0, duration: 0.16 }, 0.3);
  }

  /* pages 1..9: one card per beat, alternating entry sides */
  const beat = 0.072;
  cards.forEach((card, i) => {
    const at = 0.1 + i * beat;
    const side = i % 2 === 0 ? -1 : 1;
    tl.fromTo(
      card,
      {
        x: side * (90 + (i % 3) * 40),
        y: 110,
        rotation: side * 5,
        opacity: 0,
        scale: 0.72,
      },
      { x: 0, y: 0, rotation: 0, opacity: 1, scale: 1, duration: 0.62 },
      at,
    );
    const metas = card.querySelectorAll('[data-card-meta]');
    if (metas.length) {
      tl.fromTo(metas, { y: 22, opacity: 0 }, { y: 0, opacity: 1, duration: 0.22, stagger: 0.06 }, at + 0.34);
    }
  });

  /* connectors draw once both of their cards have landed */
  connectors.forEach((line, i) => {
    tl.fromTo(
      line,
      { strokeDashoffset: 1 },
      { strokeDashoffset: 0, duration: 0.3 },
      0.1 + (i + 1) * beat + 0.18,
    );
  });

  /* closing beat: the whole collage breathes into place */
  tl.fromTo(stage, { scale: 0.985 }, { scale: 1, duration: 0.12 }, 0.9);
}

/* ------------------------------------------------------------------ */
/* section theme flip (dark <-> lime)                                   */
/* ------------------------------------------------------------------ */
function initThemeFlips() {
  const secs = [...document.querySelectorAll<HTMLElement>('[data-theme-section]')];
  if (!secs.length) return;
  /* deterministic: the page wears the theme of the section that holds
     the viewport CENTER (with a margin so edges belong to the dark).
     At the top the center sits in the hero → always void. No trigger
     state to desync, both directions by construction. */
  const apply = () => {
    const center = scrollY + innerHeight / 2;
    let theme = 'void';
    for (const sec of secs) {
      const top = sec.offsetTop;
      const bottom = top + sec.offsetHeight;
      if (center > top + innerHeight * 0.12 && center < bottom - innerHeight * 0.12) {
        theme = sec.dataset.themeSection || 'void';
      }
    }
    if (document.body.dataset.theme !== theme) document.body.dataset.theme = theme;
  };
  apply();
  addEventListener('scroll', apply, { passive: true });
  addEventListener('resize', apply);
}

/* ------------------------------------------------------------------ */
/* worked-at accordion                                                  */
/* ------------------------------------------------------------------ */
function initAccordion() {
  document.querySelectorAll<HTMLElement>('.wa-item').forEach((item) => {
    item.querySelector('.wa-head')?.addEventListener('click', () => {
      const open = item.dataset.open === 'true';
      document.querySelectorAll<HTMLElement>('.wa-item[data-open="true"]').forEach((o) => {
        o.dataset.open = 'false';
        o.querySelector('.wa-head')?.setAttribute('aria-expanded', 'false');
      });
      if (!open) {
        item.dataset.open = 'true';
        item.querySelector('.wa-head')?.setAttribute('aria-expanded', 'true');
      }
      setTimeout(() => ScrollTrigger.refresh(), 700);
    });
  });
}

/* ------------------------------------------------------------------ */
/* cursor                                                               */
/* ------------------------------------------------------------------ */
function initCursor() {
  const root = document.querySelector<HTMLElement>('.cursor-root');
  if (!root || matchMedia('(hover: none)').matches) return;
  const dot = root.querySelector<HTMLElement>('.cursor-dot')!;
  const label = root.querySelector<HTMLElement>('.cursor-label')!;
  const pos = { x: innerWidth / 2, y: innerHeight / 2 };
  const to = { x: pos.x, y: pos.y };
  addEventListener('mousemove', (e) => {
    to.x = e.clientX;
    to.y = e.clientY;
  });
  gsap.ticker.add(() => {
    pos.x += (to.x - pos.x) * 0.2;
    pos.y += (to.y - pos.y) * 0.2;
    root.style.transform = `translate(${pos.x}px, ${pos.y}px)`;
  });
  document.querySelectorAll<HTMLElement>('[data-cursor]').forEach((el) => {
    el.addEventListener('mouseenter', () => {
      label.textContent = el.dataset.cursor || 'VIEW';
      label.style.opacity = '1';
      dot.style.opacity = '0';
    });
    el.addEventListener('mouseleave', () => {
      label.style.opacity = '0';
      dot.style.opacity = '1';
    });
    /* magnetic pull — target leans toward the pointer, springs back */
    if (!prefersReduced) {
      const strength = 0.22;
      const xTo = gsap.quickTo(el, 'x', { duration: 0.5, ease: 'power3.out' });
      const yTo = gsap.quickTo(el, 'y', { duration: 0.5, ease: 'power3.out' });
      el.addEventListener('mousemove', (e) => {
        const r = el.getBoundingClientRect();
        xTo((e.clientX - (r.left + r.width / 2)) * strength);
        yTo((e.clientY - (r.top + r.height / 2)) * strength);
      });
      el.addEventListener('mouseleave', () => {
        xTo(0);
        yTo(0);
      });
    }
  });
}

/* ------------------------------------------------------------------ */
/* menu overlay                                                         */
/* ------------------------------------------------------------------ */
function initMenu() {
  const overlay = document.querySelector<HTMLElement>('.menu-overlay');
  const btn = document.querySelector<HTMLElement>('[data-menu-btn]');
  if (!overlay || !btn) return;
  const links = [...overlay.querySelectorAll<HTMLElement>('[data-menu-stagger]')];
  const set = (open: boolean) => {
    overlay.dataset.open = String(open);
    btn.setAttribute('aria-expanded', String(open));
    btn.textContent = open ? 'Close' : 'Menu';
    document.documentElement.style.overflow = open ? 'hidden' : '';
    if (open && !prefersReduced) {
      gsap.fromTo(
        links,
        { yPercent: 120, opacity: 0 },
        { yPercent: 0, opacity: 1, duration: 0.8, ease: 'power4.out', stagger: 0.05, delay: 0.25 },
      );
    }
  };
  btn.addEventListener('click', () => set(overlay.dataset.open !== 'true'));
  overlay.querySelectorAll('a').forEach((a) =>
    a.addEventListener('click', () => set(false)),
  );
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape') set(false);
  });
}

/* ------------------------------------------------------------------ */
/* sound toggle — tiny WebAudio drone, no assets                        */
/* ------------------------------------------------------------------ */
function initSound() {
  const btn = document.querySelector<HTMLButtonElement>('[data-sound-btn]');
  if (!btn) return;
  let ctx: AudioContext | null = null;
  let gain: GainNode | null = null;
  let on = false;
  btn.addEventListener('click', async () => {
    if (!ctx) {
      ctx = new AudioContext();
      gain = ctx.createGain();
      gain.gain.value = 0;
      gain.connect(ctx.destination);
      // two detuned sines + slow LFO = quiet machine-room hum
      for (const [f, v] of [[55, 0.5], [110.7, 0.22]] as const) {
        const osc = ctx.createOscillator();
        osc.frequency.value = f;
        osc.type = 'sine';
        const g = ctx.createGain();
        g.gain.value = v;
        osc.connect(g).connect(gain!);
        osc.start();
      }
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.08;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 0.4;
      lfo.connect(lfoGain).connect(gain.gain);
      lfo.start();
    }
    await ctx.resume();
    on = !on;
    gain!.gain.linearRampToValueAtTime(on ? 0.045 : 0, ctx.currentTime + 0.6);
    btn.querySelector('span')!.textContent = on ? 'On' : 'Off';
    btn.setAttribute('aria-pressed', String(on));
  });
}

/* ------------------------------------------------------------------ */
/* nav clock + progress rail                                            */
/* ------------------------------------------------------------------ */
function initClock() {
  const el = document.querySelector<HTMLElement>('[data-clock]');
  if (!el) return;
  const tick = () => {
    el.textContent = new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'America/Bahia',
    }).format(new Date());
  };
  tick();
  setInterval(tick, 15_000);
}

function initProgress() {
  const fill = document.querySelector<HTMLElement>('.progress-rail__fill');
  const pct = document.querySelector<HTMLElement>('[data-progress-pct]');
  if (!fill) return;
  ScrollTrigger.create({
    start: 0,
    end: () => document.documentElement.scrollHeight - innerHeight,
    onUpdate(self) {
      fill.style.transform = `scaleY(${self.progress})`;
      if (pct) pct.textContent = `${Math.round(self.progress * 100)}%`;
    },
  });
  document.querySelector('[data-scroll-top]')?.addEventListener('click', (e) => {
    e.preventDefault();
    scrollTo(0);
  });
}

/* ------------------------------------------------------------------ */
/* preloader + page wipes                                               */
/* ------------------------------------------------------------------ */
function initPreloader() {
  const pre = document.querySelector<HTMLElement>('.preloader');
  if (!pre) return;
  const pctEl = pre.querySelector<HTMLElement>('.preloader__pct')!;
  const state = { p: 0 };
  let loaded = false;
  let fontsReady = false;

  const release = () => {
    document.documentElement.classList.remove('is-loading');
    if (prefersReduced) {
      pre.remove();
      return;
    }
    gsap.to(state, {
      p: 100,
      duration: 0.6,
      ease: 'power2.in',
      onUpdate: () => {
        pctEl.textContent = `${Math.round(state.p)}%`;
      },
      onComplete: () => {
        gsap.to(pre, {
          yPercent: -100,
          duration: 0.9,
          ease: 'power4.inOut',
          onComplete: () => {
            pre.remove();
            ScrollTrigger.refresh();
            document.body.dataset.ready = 'true';
            dispatchEvent(new CustomEvent('field:ready'));
          },
        });
      },
    });
  };

  document.documentElement.classList.add('is-loading');
  gsap.to(state, {
    p: 86,
    duration: 2.4,
    ease: 'power1.out',
    onUpdate: () => {
      pctEl.textContent = `${Math.round(state.p)}%`;
    },
  });

  const maybe = () => loaded && fontsReady && release();
  addEventListener('load', () => {
    loaded = true;
    maybe();
  });
  document.fonts?.ready.then(() => {
    fontsReady = true;
    maybe();
  });
  // hard fallback: never trap the user behind the curtain
  setTimeout(() => {
    loaded = fontsReady = true;
    maybe();
  }, 6000);
}

/* wipe cover on internal navigation */
function initWipes() {
  if (prefersReduced) return;
  let cover: HTMLElement | null = null;
  document.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest('a');
    if (!a) return;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin || a.target === '_blank' || a.hasAttribute('download')) return;
    if (url.pathname === location.pathname && url.hash) return;
    e.preventDefault();
    cover ??= Object.assign(document.createElement('div'), {
      className: 'fixed inset-0 z-[280] bg-void pointer-events-none',
    });
    cover.style.transform = 'translateY(100%)';
    document.body.appendChild(cover);
    gsap.to(cover, {
      yPercent: -0.01,
      translateY: 0,
      duration: 0.65,
      ease: 'power4.inOut',
      onStart: () => gsap.set(cover, { y: '100%' }),
      onComplete: () => {
        location.href = a.href;
      },
    });
    gsap.fromTo(cover, { yPercent: 100 }, { yPercent: 0, duration: 0.65, ease: 'power4.inOut' });
  });
}

/* ------------------------------------------------------------------ */
/* hero exit choreography — scrubbed, so it plays on the way down and
   rewinds on the way back up: the hero is never static */
/* ------------------------------------------------------------------ */
function initHeroChoreo() {
  if (prefersReduced) return;
  const hero = document.querySelector('#about');
  if (!hero || !hero.querySelector('[data-choreo]')) return;
  const tl = gsap.timeline({
    defaults: { ease: 'none' },
    scrollTrigger: {
      trigger: hero,
      start: 'top top',
      end: '78% top',
      scrub: 0.8,
    },
  });
  tl.to('[data-choreo="name"], [data-hero-name]', { yPercent: -26, opacity: 0.12 }, 0)
    .to('[data-choreo="bio"]', { yPercent: -16, opacity: 0 }, 0)
    .to('[data-choreo="portrait"]', { yPercent: -22, opacity: 0, scale: 0.94 }, 0)
    .to('[data-choreo="br"]', { yPercent: -16, opacity: 0 }, 0)
    .to('#about [data-choreo="meta"]', { opacity: 0, stagger: 0.04 }, 0);
}

/* ------------------------------------------------------------------ */
/* velocity skew — the whole document leans into the scroll and
   straightens at rest; sign follows direction (up leans up) */
/* ------------------------------------------------------------------ */
function initVelocitySkew() {
  if (prefersReduced) return;
  const main = document.getElementById('main');
  if (!main) return;
  const setSkew = gsap.quickTo(main, 'skewY', { duration: 0.55, ease: 'power3.out' });
  gsap.ticker.add(() => {
    setSkew(gsap.utils.clamp(-1.1, 1.1, currentVelocity() * 0.045));
  });
}

/* ------------------------------------------------------------------ */
/* worked-at rows — scrubbed drift, reversible both directions */
/* ------------------------------------------------------------------ */
function initRowDrift() {
  if (prefersReduced) return;
  document.querySelectorAll<HTMLElement>('.wa-item').forEach((row) => {
    gsap.from(row, {
      yPercent: 16,
      opacity: 0.25,
      ease: 'none',
      scrollTrigger: { trigger: row, start: 'top 97%', end: 'top 62%', scrub: 0.6 },
    });
  });
}

/* ------------------------------------------------------------------ */
export function initField() {
  /* idempotent: HMR module re-execution must not stack a second
     runtime (duplicate tickers fight over the same DOM — the
     stuck-green-text class of bug) */
  const w = window as unknown as { __fieldRuntime?: symbol };
  if (w.__fieldRuntime) return;
  w.__fieldRuntime = Symbol('field');

  /* the home page is a FILM: the flipbook owns every reveal inside
     the stage — main only runs the chrome there */
  const film = !!document.querySelector('[data-flip-stage]');

  initLenis();
  if (!film) {
    initSplits();
    initOdometers();
    initCardEffects();
    initSnapshots();
    initHeroChoreo();
    initVelocitySkew();
    initRowDrift();
    initThemeFlips();
    initAccordion();
  }
  initCursor();
  initMenu();
  initSound();
  initClock();
  initProgress();
  initPreloader();
  initWipes();
  initScramble();
  ScrollTrigger.refresh();
}
