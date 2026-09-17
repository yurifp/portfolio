import type { APIRoute } from 'astro';

// Prerendered in the static build, served dynamically on Vercel — the sitemap
// URL follows the SITE_URL of whichever target is being built.
export const GET: APIRoute = ({ site }) =>
  new Response(`User-agent: *\nAllow: /\n\nSitemap: ${new URL('sitemap-index.xml', site)}`, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
