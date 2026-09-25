import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';

type Props = {
  slug: string;
  /** Base URL of the views API; defaults to same-origin (set for the static mirror) */
  api?: string;
  variant?: 'large' | 'inline';
};

/**
 * Live view counter backed by Redis (Upstash REST via /api/views/:slug).
 * - POSTs once per slug per session (increments), GETs afterwards
 * - when the API answers { live: false } (no Redis configured), renders an
 *   honest em dash instead of a fake number
 */
export default function ViewCounter({ slug, api, variant = 'inline' }: Props) {
  const base = api ?? import.meta.env.PUBLIC_VIEWS_API ?? '';
  const [views, setViews] = useState<number | null>(null);
  const [live, setLive] = useState(false);
  const numRef = useRef<HTMLSpanElement>(null);
  const animatedFor = useRef<string>('');

  useEffect(() => {
    const sessionKey = `viewed:${slug}`;
    // Baked same-origin JSON (static mirror) is read-only display data; writes
    // only happen where a real backend answers (server build) or when the
    // counter explicitly targets the production API (PUBLIC_VIEWS_API).
    const writable =
      import.meta.env.PUBLIC_VIEWS_WRITABLE === 'true' || !!import.meta.env.PUBLIC_VIEWS_API;

    fetch(`${base}/api/views/${slug}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { views: number | null; live: boolean } | null) => {
        if (!data?.live) return;
        setLive(true);
        setViews(data.views);

        if (!writable || sessionStorage.getItem(sessionKey)) return;
        sessionStorage.setItem(sessionKey, '1');
        fetch(`${base}/api/views/${slug}`, { method: 'POST' })
          .then((r) => (r.ok ? r.json() : null))
          .then((inc: { views: number | null; live: boolean } | null) => {
            if (inc?.live) setViews(inc.views);
          })
          .catch(() => {});
      })
      .catch(() => {
        /* counter is decoration-grade data: fail silent, stay honest */
      });
  }, [slug, base]);

  // Count-up when a new value lands (motion that answers data, not scroll)
  useEffect(() => {
    if (views === null || animatedFor.current === slug) return;
    animatedFor.current = slug;

    const el = numRef.current;
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      el.textContent = views.toLocaleString('en-US');
      return;
    }

    const state = { n: Math.max(0, views - 25) };
    gsap.to(state, {
      n: views,
      duration: 0.9,
      ease: 'power2.out',
      onUpdate: () => {
        el.textContent = Math.round(state.n).toLocaleString('en-US');
      },
    });
  }, [views, slug]);

  const className =
    variant === 'large' ? 't-value text-3xl text-signal' : 't-value text-sm text-dim';

  if (!live) {
    return (
      <span className={className} title="Counters go live where the backend runs (see the Vercel deployment)">
        —
      </span>
    );
  }

  return (
    <span className={className} title={`${views ?? 0} views, counted in Redis`}>
      <span ref={numRef}>{views === null ? '—' : views.toLocaleString('en-US')}</span>
    </span>
  );
}
