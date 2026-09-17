/**
 * View counters backed by Upstash Redis (REST API — plain fetch, no SDK).
 * Keys are allowlisted: the public endpoint can only touch known counters.
 */

export const VIEW_SLUGS = new Set(['home', 'impacts', 'globeexplorers', 'this-site']);

export type ViewsResult = {
  slug: string;
  views: number | null;
  live: boolean;
};

function redisCredentials(): { url: string; token: string } | null {
  // process.env first: Vercel injects runtime env into functions reliably,
  // while import.meta.env is build-time-inlined (undefined in local builds).
  const url = process.env.UPSTASH_REDIS_REST_URL || import.meta.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || import.meta.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
}

async function redisCommand(
  command: 'incr' | 'get',
  slug: string,
): Promise<{ ok: boolean; value: number | null }> {
  const cred = redisCredentials();
  if (!cred) return { ok: false, value: null };

  const res = await fetch(`${cred.url}/${command}/${encodeURIComponent(`views:${slug}`)}`, {
    headers: { Authorization: `Bearer ${cred.token}` },
  });
  if (!res.ok) return { ok: false, value: null };

  const json = (await res.json()) as { result: unknown };
  // INCR answers a number, GET answers a string (or null for a missing key)
  const r = json.result;
  const value =
    typeof r === 'number'
      ? r
      : typeof r === 'string' && /^\d+$/.test(r)
        ? parseInt(r, 10)
        : null;
  return { ok: true, value };
}

export async function incrementView(slug: string): Promise<ViewsResult> {
  if (!VIEW_SLUGS.has(slug)) {
    throw new Error(`Unknown slug: ${slug}`);
  }
  const { ok, value } = await redisCommand('incr', slug);
  return { slug, views: value, live: ok };
}

export async function getView(slug: string): Promise<ViewsResult> {
  if (!VIEW_SLUGS.has(slug)) {
    throw new Error(`Unknown slug: ${slug}`);
  }
  const { ok, value } = await redisCommand('get', slug);
  // A missing key is a real zero, not a backend failure — render "0", not "—"
  return { slug, views: value ?? 0, live: ok };
}
