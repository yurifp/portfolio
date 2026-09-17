import type { APIRoute } from 'astro';
import { getView, incrementView, VIEW_SLUGS } from '../../../lib/views';

// Serverless on Vercel. In the static GitHub Pages build this bakes into four
// harmless JSON files; the mirror's islands read the production API instead
// (PUBLIC_VIEWS_API), so these are never the source of truth there.
export const prerender = process.env.DEPLOY_TARGET !== 'github';

export function getStaticPaths() {
  return [...VIEW_SLUGS].map((slug) => ({ params: { slug } }));
}

const CORS_HEADERS = {
  // Open on purpose: the static GitHub Pages mirror reads the production API
  // so its counters stay alive instead of breaking silently.
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
} as const;

const JSON_HEADERS = { ...CORS_HEADERS, 'Content-Type': 'application/json' } as const;

function badSlug(slug: string) {
  return new Response(JSON.stringify({ error: `Unknown slug: ${slug}` }), {
    status: 400,
    headers: JSON_HEADERS,
  });
}

export const GET: APIRoute = async ({ params }) => {
  const { slug } = params;
  if (!slug || !VIEW_SLUGS.has(slug)) return badSlug(slug ?? '');

  const data = await getView(slug);
  return new Response(JSON.stringify(data), { status: 200, headers: JSON_HEADERS });
};

export const POST: APIRoute = async ({ params }) => {
  const { slug } = params;
  if (!slug || !VIEW_SLUGS.has(slug)) return badSlug(slug ?? '');

  const data = await incrementView(slug);
  return new Response(JSON.stringify(data), { status: 200, headers: JSON_HEADERS });
};

export const OPTIONS: APIRoute = () => new Response(null, { status: 204, headers: CORS_HEADERS });
