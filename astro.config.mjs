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
