# yurifp — portfolio

Portfolio of Yuri Ferreira Paulo, front-end engineer going full-stack. The
site is designed to prove the claim instead of stating it: the contact form is
a typed server action, the view counters persist in Redis, and one codebase
deploys twice — serverless on Vercel, static mirror on GitHub Pages.

Design concept: **Telemetry** — a dark instrument panel in abyssal blue
(`#0C1420`), Archivo for text, IBM Plex Mono strictly for data values, and one
semantic amber (`#F2B441`) reserved for live data and confirmed interaction.

## Stack

- [Astro 7](https://astro.build) — static-first, islands where state exists
- React islands (`client:visible`/`client:idle`): project filter with GSAP
  Flip, live view counters. Everything else is zero-JS `.astro`
- Tailwind CSS v4 (tokens in `src/styles/global.css` via `@theme`)
- GSAP + ScrollTrigger + Flip; Lenis for smooth scroll, wired through GSAP's
  ticker (single frame source)
- Astro Actions (Zod) + Resend for the contact form
- Upstash Redis (REST, plain fetch) for per-page view counters
- `sharp` for the generated OG image (`npm run og`)

## Run it

```bash
npm install
cp .env.example .env   # optional locally — see "Backend features"
npm run dev
```

## Backend features (the point)

| Feature | Needs | Without the env var |
| --- | --- | --- |
| Contact form (`src/actions/index.ts`) | `RESEND_API_KEY` (+ optional `RESEND_TO`) | Logs to the server console, form still succeeds with an honest note |
| View counters (`src/lib/views.ts`, `/api/views/[slug]`) | `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` | API answers `{ live: false }`, counters render an em dash |

Slugs are allowlisted in `VIEW_SLUGS`; a counter increments once per browser
session (`sessionStorage`). The endpoint is CORS-open on purpose: the static
mirror reads the production API so its counters stay alive.

> Resend note: until you verify a domain, the free tier sends only from
> `onboarding@resend.dev` to your own account e-mail.

## Two deploy targets, one config

`astro.config.mjs` branches on `DEPLOY_TARGET` — no duplicated configs.

**Vercel (production, has the backend):** import the repo, add env vars
`SITE_URL`, `RESEND_API_KEY`, `UPSTASH_REDIS_REST_URL`,
`UPSTASH_REDIS_REST_TOKEN`. Defaults apply (`output: 'server'`,
`@astrojs/vercel`). `/api/*` and `/_actions/*` run serverless; the page itself
is prerendered static.

**GitHub Pages (static mirror of the root `yurifp.github.io`):** push this
code to the `yurifp/yurifp.github.io` repo, then Settings → Pages → Source:
**GitHub Actions**. The included workflow builds with `DEPLOY_TARGET=github`
(pure static, no adapter) and deploys with `actions/deploy-pages@v5`. In the
mirror, the contact form is replaced by a notice linking to the full version —
nothing points at a dead endpoint. Update `PUBLIC_VIEWS_API` in the workflow
to the real Vercel URL after the first deploy so the mirror's counters read
production.

## Content

- Projects: `src/content/projects/*.md` — typed collection
  (`src/content.config.ts`); add a file, the grid updates. `cover: ./cover.jpg`
  in the frontmatter adds an optimized image (`astro:assets`).
- Bio draft: `src/components/About.astro` — **TODO(yuri-review)** marker
  inside; rewrite in your own words before going public.
- Known signed TODOs: Impacts repo/live links, project cover images.
- OG card: `npm run og` regenerates `public/og.png` after copy changes.

## Motion rules

One orchestrated moment (hero power-on), one quiet batched reveal (project
panels), motion that answers user actions (filter reflow via GSAP Flip, case
expansion, counter count-up). The hero background (`TelemetryMesh`) is the
single decorative layer: spring-mass grid reacting to the cursor, amber only
near the pointer, O(n) neighbor connections, `gsap.ticker` as the project's
only frame source, paused when the tab is hidden or the hero is offscreen,
and a static frame under `prefers-reduced-motion`.
`prefers-reduced-motion` disables Lenis and all
entry/scroll animation; the page renders fully visible without JS.
