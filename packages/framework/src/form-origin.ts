import type { Context, Handler } from 'hono';

/**
 * Whether a request comes from the application's own pages. `Sec-Fetch-Site: same-origin` (or
 * `none`) decides alone: a same-origin form post under `Referrer-Policy: no-referrer` carries
 * `Origin: null`, so comparing `Origin` would refuse every form. `cross-site` is refused. For
 * `same-site` (a subdomain) or no `Sec-Fetch-Site` (older browsers, scripts), a present
 * `Origin` must be the request's own, or its https form behind a TLS-terminating proxy that
 * sets `X-Forwarded-Proto: https`.
 */
export function isSameOriginRequest(request: Request): boolean {
  const site = request.headers.get('sec-fetch-site')?.toLowerCase();
  if (site === 'same-origin' || site === 'none') return true;
  // Another origin of the same site (a subdomain) must still name this origin.
  if (site !== undefined && site !== 'same-site') return false;
  const origin = request.headers.get('origin');
  if (origin === null) return true;
  let url: URL;
  try { url = new URL(request.url); } catch { return false; }
  if (origin === url.origin) return true;
  return request.headers.get('x-forwarded-proto')?.toLowerCase() === 'https' && origin === `https://${url.host}`;
}

/** Content types a cross-site page can post without a CORS preflight: an HTML form's, or none. */
function isSimpleBody(request: Request): boolean {
  const type = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  return !type || type === 'application/x-www-form-urlencoded' || type === 'multipart/form-data' || type === 'text/plain';
}

/**
 * A page's `post()` refuses a form post from another site with 403
 * `COSSACK_CROSS_SITE_REQUEST`. Other methods and JSON bodies need a CORS preflight, which the
 * CORS settings decide. `@Page({ allowCrossSiteForms: true })` turns the check off.
 */
export function refuseCrossSiteForms(handler: Handler): Handler {
  return async (c: Context, next) => {
    if (c.req.method === 'POST' && isSimpleBody(c.req.raw) && !isSameOriginRequest(c.req.raw)) {
      return c.json({ error: 'A form on another site cannot post to this page.', code: 'COSSACK_CROSS_SITE_REQUEST' }, 403);
    }
    return handler(c, next);
  };
}
