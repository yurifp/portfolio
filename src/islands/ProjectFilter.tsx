import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import gsap from 'gsap';
import { Flip } from 'gsap/Flip';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import ViewCounter from './ViewCounter';

gsap.registerPlugin(Flip, ScrollTrigger);

export type ProjectData = {
  slug: string;
  title: string;
  description: string;
  role: string;
  stack: string[];
  year: number;
  links: { repo?: string; live?: string };
  featured: boolean;
  tags: string[];
  metrics: { label: string; value: string }[];
  coverSrc?: string;
};

const TAG_LABELS: Record<string, string> = {
  '3d': '3D & WebGL',
  frontend: 'Front-end',
  fullstack: 'Full-stack',
  ai: 'AI',
};

/* Designed, signed placeholder — a missing module in the panel, not a fake screenshot */
function Placeholder({ label }: { label: string }) {
  return (
    <div
      className="panel-hatch relative flex min-h-40 items-end justify-between rounded-panel border border-line/70 p-4"
      aria-label={`${label}: image pending`}
    >
      <span className="t-value text-[11px] tracking-wide text-dim">{label} pending</span>
      <span className="t-value text-[11px] text-dim">TODO: cover</span>
    </div>
  );
}

function MetricRow({ metric }: { metric: { label: string; value: string } }) {
  return (
    <div className="flex flex-col gap-0.5 border-l-2 border-line pl-3">
      <span className="text-xs text-dim">{metric.label}</span>
      <span className="text-sm text-ink">{metric.value}</span>
    </div>
  );
}

function Links({ links }: { links: { repo?: string; live?: string } }) {
  const items = [
    links.repo ? { href: links.repo, label: 'repository' } : null,
    links.live ? { href: links.live, label: 'live' } : null,
  ].filter((x): x is { href: string; label: string } => x !== null);

  if (!items.length) return null;
  return (
    <div className="flex flex-wrap gap-4">
      {items.map((l) => (
        <a
          key={l.href}
          href={l.href}
          target="_blank"
          rel="noopener"
          className="border-b border-line pb-0.5 text-sm text-ink transition-colors hover:border-signal hover:text-signal"
        >
          {l.label}
        </a>
      ))}
    </div>
  );
}

/* Height animation via grid-template-rows (see global.css); inert when collapsed.
   Padding lives on a grandchild — a grid item cannot shrink below its own padding,
   which would leave a 24px sliver visible in the collapsed state. */
function Expandable({ id, open, children }: { id: string; open: boolean; children: ReactNode }) {
  return (
    <div id={id} className={`case-grid ${open ? 'case-open' : ''}`}>
      <div className="case-inner min-h-0 overflow-hidden" inert={!open}>
        <div className="px-5 pb-6 sm:px-6">{children}</div>
      </div>
    </div>
  );
}

export default function ProjectFilter({ projects }: { projects: ProjectData[] }) {
  const [active, setActive] = useState('all');
  const [expanded, setExpanded] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const flipState = useRef<Flip.FlipState | null>(null);

  const tags = Array.from(new Set(projects.flatMap((p) => p.tags)));
  const visible = active === 'all' ? projects : projects.filter((p) => p.tags.includes(active));

  function selectTag(tag: string) {
    if (tag === active) return;
    if (gridRef.current && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      flipState.current = Flip.getState(gridRef.current.querySelectorAll('[data-project]'));
    }
    setActive(tag);
  }

  /* Reflow surviving cards to their new positions — motion answering the user's click */
  useEffect(() => {
    if (!flipState.current || !gridRef.current) return;
    Flip.from(flipState.current, {
      duration: 0.45,
      ease: 'power2.inOut',
      scale: false,
      absolute: true,
      onEnter: (els) => gsap.fromTo(els, { opacity: 0 }, { opacity: 1, duration: 0.3 }),
    });
    flipState.current = null;
  }, [active]);

  /* Island-owned reveal: runs post-hydration, so GSAP never mutates SSR HTML
     before React sees it (that would break hydration). Same grammar as the
     global Motion layer, scoped to these articles only. */
  useEffect(() => {
    if (!gridRef.current || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const els = Array.from(gridRef.current.querySelectorAll<HTMLElement>('[data-reveal]'));
    if (!els.length) return;

    gsap.set(els, { y: 18 });
    ScrollTrigger.batch(els, {
      start: 'top 92%',
      once: true,
      onEnter: (batch) =>
        gsap.to(batch, { autoAlpha: 1, y: 0, duration: 0.6, ease: 'power2.out', stagger: 0.08 }),
    });
    ScrollTrigger.refresh();
  }, []);

  const featured = visible.find((p) => p.featured);
  const rows = visible.filter((p) => !p.featured);

  return (
    <div>
      <div role="group" aria-label="Filter projects" className="mb-6 flex flex-wrap gap-2">
        <FilterChip label="all" active={active === 'all'} onClick={() => selectTag('all')} />
        {tags.map((tag) => (
          <FilterChip
            key={tag}
            label={TAG_LABELS[tag] ?? tag}
            active={active === tag}
            onClick={() => selectTag(tag)}
          />
        ))}
      </div>

      <div ref={gridRef} className="flex flex-col gap-3">
        {featured && (
          <article
            data-project
            data-reveal
            className="rounded-panel border border-line bg-raised/60 p-5 sm:p-7"
          >
            <div className="grid gap-6 sm:grid-cols-[1.4fr_1fr]">
              <div>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-2xl font-semibold tracking-tight">{featured.title}</h3>
                  <span className="t-value text-xs text-dim">{featured.year}</span>
                </div>
                <p className="mt-1 text-sm text-dim">{featured.role}</p>
                <p className="mt-4 max-w-xl text-ink/90">{featured.description}</p>
                <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2">
                  {featured.stack.map((s) => (
                    <span key={s} className="text-sm text-dim">
                      {s}
                    </span>
                  ))}
                </div>
                <div className="mt-5 flex items-center gap-3">
                  <ViewCounter slug={featured.slug} />
                  <span className="text-xs text-dim">views, counted in Redis</span>
                </div>
              </div>
              <div>
                {featured.coverSrc ? (
                  <img
                    src={featured.coverSrc}
                    alt={`${featured.title} interface`}
                    className="min-h-40 w-full rounded-panel border border-line/70 object-cover"
                    loading="lazy"
                  />
                ) : (
                  <Placeholder label={`${featured.title} cover`} />
                )}
              </div>
            </div>

            <Expandable id={`case-${featured.slug}`} open={expanded === featured.slug}>
              <div className="grid gap-4 sm:grid-cols-3">
                {featured.metrics.map((m) => (
                  <MetricRow key={m.label} metric={m} />
                ))}
              </div>
              <div className="mt-5">
                <Links links={featured.links} />
              </div>
            </Expandable>

            <button
              type="button"
              aria-expanded={expanded === featured.slug}
              aria-controls={`case-${featured.slug}`}
              onClick={() => setExpanded(expanded === featured.slug ? null : featured.slug)}
              className="mt-2 flex w-full items-center gap-2 border-t border-line pt-4 text-sm text-dim transition-colors hover:text-ink"
            >
              <span
                aria-hidden="true"
                className={`inline-block transition-transform duration-300 ${expanded === featured.slug ? 'rotate-45' : ''}`}
              >
                +
              </span>
              {expanded === featured.slug ? 'collapse case' : 'expand case'}
            </button>
          </article>
        )}

        {rows.map((p) => {
          const open = expanded === p.slug;
          return (
            <article
              key={p.slug}
              data-project
              data-reveal
              className="rounded-panel border border-line bg-raised/40"
            >
              <button
                type="button"
                aria-expanded={open}
                aria-controls={`case-${p.slug}`}
                onClick={() => setExpanded(open ? null : p.slug)}
                className="flex w-full flex-wrap items-baseline gap-x-4 gap-y-1 px-5 py-4 text-left transition-colors hover:bg-raised/70 sm:px-6"
              >
                <h3 className="text-lg font-medium tracking-tight">{p.title}</h3>
                <span className="text-sm text-dim">{p.role}</span>
                <span className="ml-auto t-value text-xs text-dim">{p.year}</span>
                <span className="t-value text-xs text-dim">{p.stack[0]}</span>
                <span className="t-value text-xs text-dim">
                  <ViewCounter slug={p.slug} />
                </span>
                <span
                  aria-hidden="true"
                  className={`inline-block text-dim transition-transform duration-300 ${open ? 'rotate-45' : ''}`}
                >
                  +
                </span>
              </button>

              <Expandable id={`case-${p.slug}`} open={open}>
                <div className="grid gap-6 sm:grid-cols-[1fr_1.2fr]">
                  <div className="flex flex-col gap-3">
                    {p.metrics.map((m) => (
                      <MetricRow key={m.label} metric={m} />
                    ))}
                    <Links links={p.links} />
                  </div>
                  <div className="flex flex-col gap-3">
                    {p.coverSrc ? (
                      <img
                        src={p.coverSrc}
                        alt={`${p.title} interface`}
                        className="min-h-40 w-full rounded-panel border border-line/70 object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <Placeholder label={`${p.title} cover`} />
                    )}
                    <p className="text-sm text-ink/90">{p.description}</p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      {p.stack.map((s) => (
                        <span key={s} className="text-sm text-dim">
                          {s}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </Expandable>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-full border px-3.5 py-1.5 text-sm transition-colors ${
        active
          ? 'border-signal bg-signal/10 text-signal'
          : 'border-line text-dim hover:border-dim hover:text-ink'
      }`}
    >
      {label}
    </button>
  );
}
