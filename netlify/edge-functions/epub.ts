/*
 * Stateless CORS proxy for Project Gutenberg EPUB downloads.
 *
 * Gutenberg doesn't serve CORS headers, so a browser fetch() is blocked.
 * This edge function streams the upstream body through and tacks on the
 * one header the browser needs. It stores nothing, logs nothing we didn't
 * already know (a public book URL), and only proxies gutenberg.org hosts.
 */

const ALLOWED_HOSTS = new Set([
  'www.gutenberg.org',
  'gutenberg.org',
  'www.gutenberg.net.au',
]);

export default async (request: Request): Promise<Response> => {
  const { searchParams } = new URL(request.url);
  const target = searchParams.get('url');

  if (!target) {
    return new Response('missing ?url=', { status: 400 });
  }

  let upstreamUrl: URL;
  try {
    upstreamUrl = new URL(target);
  } catch {
    return new Response('invalid url', { status: 400 });
  }

  if (upstreamUrl.protocol !== 'https:' || !ALLOWED_HOSTS.has(upstreamUrl.hostname)) {
    return new Response('host not allowed', { status: 403 });
  }

  const upstream = await fetch(upstreamUrl.toString(), {
    redirect: 'follow',
    headers: { 'user-agent': 'kathai-reader/1.0 (+https://kathai.app)' },
  });

  const headers = new Headers();
  const contentType = upstream.headers.get('content-type') ?? 'application/epub+zip';
  headers.set('content-type', contentType);
  headers.set('access-control-allow-origin', '*');
  headers.set('cache-control', 'public, max-age=31536000, immutable');
  const contentLength = upstream.headers.get('content-length');
  if (contentLength) headers.set('content-length', contentLength);

  return new Response(upstream.body, { status: upstream.status, headers });
};

export const config = { path: '/api/epub' };
