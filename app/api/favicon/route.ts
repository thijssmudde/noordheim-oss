/**
 * Sponsor favicons, served from our own origin. Posters are painted on a
 * canvas that becomes a WebGL texture, and a cross-origin image would taint
 * that canvas, so the icon is fetched here instead of in the browser.
 */
const HOST =
  /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const DAY = 24 * 60 * 60;

export async function GET(request: Request) {
  const domain =
    new URL(request.url).searchParams.get('domain')?.toLowerCase() ?? '';
  if (!HOST.test(domain)) return new Response('Bad domain', { status: 400 });
  const source = new URL('https://t1.gstatic.com/faviconV2');
  source.search = new URLSearchParams({
    client: 'SOCIAL',
    type: 'FAVICON',
    fallback_opts: 'TYPE,SIZE,URL',
    url: `https://${domain}`,
    size: '128',
  }).toString();
  const upstream = await fetch(source).catch(() => null);
  // Google answers 404 with a generic globe when a site has no icon; the poster draws its own emblem instead.
  if (
    !upstream?.ok ||
    !upstream.headers.get('content-type')?.startsWith('image/')
  )
    return new Response('No icon', {
      status: 404,
      headers: { 'cache-control': `public, max-age=${DAY}` },
    });
  return new Response(upstream.body, {
    headers: {
      'content-type': upstream.headers.get('content-type')!,
      'cache-control': `public, max-age=${7 * DAY}, stale-while-revalidate=${30 * DAY}`,
      'x-content-type-options': 'nosniff',
    },
  });
}
