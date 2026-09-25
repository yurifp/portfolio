import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';

gsap.registerPlugin(ScrollTrigger);

/**
 * ExperienceManager — the ONE frame source of the whole site.
 *
 * Lenis drives ScrollTrigger (never the reverse); Lenis's RAF lives inside
 * gsap.ticker; everything that needs a per-frame value (scroll progress rail,
 * shader uniforms, FPS-sensitive work) reads from here instead of opening
 * its own requestAnimationFrame. Under prefers-reduced-motion none of this
 * runs: native scroll, static content.
 *
 * Also owns the smoothed scroll velocity (|lenis velocity| eased), the value
 * the reference feeds into its shaders — here it is a first-class citizen.
 */
class ExperienceManager {
  private started = false;
  private lenis: Lenis | null = null;
  private rawVelocity = 0;
  private frameCbs = new Set<(dt: number, t: number) => void>();
  private lastT = 0;

  /** eased |velocity| in px/frame-ish units — read by shaders as uVelocity */
  velocity = 0;
  /** shared state — the "one value" of one-value-many-destinations */
  state = { progress: 0 };
  reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /**
   * Register a per-frame callback (dt seconds, t seconds). The WebGL stage
   * renders through this — the whole site shares gsap.ticker as its only RAF.
   */
  onFrame(cb: (dt: number, t: number) => void) {
    this.frameCbs.add(cb);
    return () => this.frameCbs.delete(cb);
  }

  private raf = (time: number) => {
    if (!this.lenis) return;
    this.lenis.raf(time * 1000);
    // Smooth the velocity so shaders glide instead of stuttering
    this.velocity += (this.rawVelocity - this.velocity) * 0.08;
    this.updateRail();

    const t = time;
    const dt = this.lastT ? Math.min(t - this.lastT, 0.05) : 0.016;
    this.lastT = t;
    for (const cb of this.frameCbs) cb(dt, t);
  };

  private onScroll = (e: { velocity: number }) => {
    ScrollTrigger.update();
    this.rawVelocity = Math.min(Math.abs(e.velocity), 120) / 120;
  };

  private updateRail() {
    const fill = document.getElementById('scroll-rail-fill');
    if (!fill) return;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const p = max > 0 ? window.scrollY / max : 0;
    fill.style.transform = `scaleY(${p})`;
  }

  init() {
    if (this.started || this.reducedMotion) return;
    this.started = true;

    // lerp por frame (0..1): resposta ao wheel quase imediata, mantendo o
    // glide — o 'duration' padrão (~1s) tornava flicks longos em 'tela presa'.
    this.lenis = new Lenis({ anchors: true, lerp: 0.14 });
    this.lenis.on('scroll', this.onScroll as never);

    gsap.ticker.add(this.raf);
    gsap.ticker.lagSmoothing(0);

    // Tab hidden → ticker keeps running but Lenis/RAF work is trivial; the
    // WebGL layer observes visibilitychange itself for the heavy pausing.
  }

  /** Scroll to a target with the shared easing (used by nav + storytelling) */
  scrollTo(target: string | HTMLElement, offset = 0) {
    if (this.lenis) {
      this.lenis.scrollTo(target as never, { offset, duration: 1.2 });
    } else if (typeof target === 'string') {
      document.querySelector(target)?.scrollIntoView();
    }
  }
}

export const experience = new ExperienceManager();
