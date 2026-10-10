/** Inject Vite into document responses without consuming opaque RPC/API bodies. */
export async function transformDesktopDocument(
  request: Request,
  response: Response,
  transform: (pathname: string, html: string) => Promise<string>,
): Promise<Response> {
  if (
    request.method !== 'GET' ||
    !request.headers.get('accept')?.includes('text/html') ||
    response.headers.get('X-Cossack-Rpc-Response') === 'native' ||
    !response.body ||
    !response.headers.get('content-type')?.includes('text/html')
  )
    return response;
  const html = await transform(new URL(request.url).pathname, await response.text());
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return new Response(html, { status: response.status, statusText: response.statusText, headers });
}
