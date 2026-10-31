// A cookie-keeping HTTP client for generated CMS applications: pages, form posts and
// server methods through /crpc, with assertions that report the page's main content.

/** Rendered markup without hydration markers. */
export const visible = html => html.replace(/<!--[\s\S]*?-->/g, '');
/** Assert that markup contains text, reporting the page's main content when it does not. */
export function contains(html, text) {
  if (html.includes(text)) return;
  const start = Math.max(0, html.indexOf('<main'));
  throw new Error(`Expected the page to contain ${JSON.stringify(text)}:\n${html.slice(start, start + 3000)}`);
}
export function lacks(html, text) {
  if (!html.includes(text)) return;
  const at = html.indexOf(text);
  throw new Error(`Expected the page not to contain ${JSON.stringify(text)}:\n${html.slice(Math.max(0, at - 500), at + 500)}`);
}
export const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

/** A cookie-keeping client for form posts and server actions. */
export function browserless(origin, routeIds, diagnostics = () => '') {
  const jar = new Map();
  const request = async (pathname, init = {}) => {
    const headers = new Headers(init.headers);
    headers.set('cookie', [...jar].map(([name, value]) => `${name}=${value}`).join('; '));
    if (init.method === 'POST') { headers.set('origin', origin); headers.set('sec-fetch-site', 'same-origin'); }
    const response = await fetch(origin + pathname, { ...init, headers, redirect: 'manual' });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(';');
      const [name, value] = pair.split('=');
      if (/Max-Age=0/i.test(cookie)) jar.delete(name); else jar.set(name, value);
    }
    return response;
  };
  const post = (pathname, fields) => request(pathname, { method: 'POST', body: new URLSearchParams(fields) });
  const page = async pathname => {
    const response = await request(pathname);
    const html = await response.text();
    if (response.status !== 200) throw new Error(`${pathname} answered ${response.status}: ${visible(html).slice(0, 2000)}\n${diagnostics().slice(-6000)}`);
    return visible(html);
  };
  /** Call a page's server method through /crpc. */
  /** A layout's method runs under the page the browser is on (`page`). */
  const action = async (file, name, payload, { state = {}, params = {}, page } = {}) => {
    const componentRouteId = routeIds[`/src/pages/${file}`];
    if (!componentRouteId) throw new Error(`No route ID for ${file}`);
    const response = await request('/crpc', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ componentRouteId, action: name, payload, state, pageParams: params, ...(page ? { pageRouteId: routeIds[`/src/pages/${page}`] } : {}) }) });
    const body = await response.json();
    if (response.status !== 200) throw new Error(`${file} ${name} answered ${response.status}: ${JSON.stringify(body)}\n${diagnostics().slice(-6000)}`);
    return body;
  };
  return { request, post, page, action, jar };
}

