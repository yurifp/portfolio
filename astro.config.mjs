import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import vercel from '@astrojs/vercel';
import { fileURLToPath } from 'node:url';

// One config, two targets:
//   DEPLOY_TARGET unset  -> Vercel: serverless (output 'server'), Astro Actions + /api live
//   DEPLOY_TARGET=github -> GitHub Pages: pure static mirror, backend features degrade gracefully
const isGhPages = process.env.DEPLOY_TARGET === 'github';

const SITE_URL =
  process.env.SITE_URL || (isGhPages ? 'https://yurifp.github.io' : 'https://yurifp-portfolio.vercel.app');

export default defineConfig({
  site: SITE_URL,
  base: '/',
  output: isGhPages ? 'static' : 'server',
  adapter: isGhPages ? undefined : vercel(),
  integrations: [react(), sitemap()],
  devToolbar: { enabled: false },
  vite: {
    plugins: [tailwindcss()],
    // The static mirror bakes real view counts at build time (creds may be
    // ambient), but its same-origin /api is dead JSON — writes are gated off.
    // The server build (and any mirror pointing PUBLIC_VIEWS_API at prod)
    // keeps incrementing.
    define: {
      'import.meta.env.PUBLIC_VIEWS_WRITABLE': JSON.stringify(isGhPages ? 'false' : 'true'),
    },
    // Static build: src/actions is parked by scripts/build.mjs, so the real
    // astro:actions module does not exist — resolve imports to a stub instead.
    resolve: isGhPages
      ? {
          alias: [
            {
              find: 'astro:actions',
              replacement: fileURLToPath(new URL('./src/lib/actions-stub.ts', import.meta.url)),
            },
          ],
        }
      : undefined,
  },
});
