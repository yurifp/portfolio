---
title: This site
description: 'The page you are reading. One codebase, two deploy targets: serverless on Vercel (Actions, Redis counters), a static mirror on GitHub Pages that degrades without breaking.'
role: Design, front-end, backend, infrastructure
stack:
  - Astro 7
  - TypeScript
  - React islands
  - Tailwind CSS v4
  - GSAP
  - Upstash Redis
  - Resend
  - GitHub Actions
year: 2026
links: {}
  # repo link lands here once you push it — the schema validates on build
featured: false
tags:
  - fullstack
metrics:
  - label: Backend
    value: Typed Astro Action (Zod) + Resend for the contact form below
  - label: Persistence
    value: Per-page view counters in Upstash Redis — the hero readout is one
  - label: Deploys
    value: Vercel (serverless) + GitHub Pages (static) from one config
---

This portfolio is the proof-of-work for the full-stack claim. The contact
form is a typed Astro Action validated with Zod and delivered through Resend;
the view counters — including the one in the hero — persist in Upstash Redis
and increment through a serverless endpoint with an allowlisted key set. The
same codebase builds twice: serverless for Vercel, static for GitHub Pages,
switched by an environment flag in `astro.config.mjs` — and the static mirror
keeps its counters alive by reading the production API instead of silently
dying.
