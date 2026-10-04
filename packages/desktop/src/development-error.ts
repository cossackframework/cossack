/** Keep Vite connected after a source error without injecting exception text as HTML. */
export function desktopDevelopmentError(error: unknown): Response {
  const message = (error instanceof Error ? (error.stack ?? error.message) : String(error)).slice(0, 8192);
  const escaped = message.replace(
    /[&<>"']/g,
    (value) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[value]!,
  );
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><title>Desktop development error</title></head><body><h1>Desktop source could not load</h1><pre id="cossack-development-error">${escaped}</pre><script type="module" src="/@vite/client"></script></body></html>`,
    {
      status: 500,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    },
  );
}
