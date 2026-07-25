import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export interface StudioSecurity {
  launchToken: string;
  sessionToken: string;
  origin: string;
  authorize(request: IncomingMessage, response: ServerResponse): boolean | 'redirect';
  applyHeaders(response: ServerResponse): void;
}

function safeEqual(left: string | undefined, right: string): boolean {
  if (!left) return false;
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function cookieValue(header: string | undefined, name: string): string | undefined {
  for (const item of (header ?? '').split(';')) {
    const [candidate, ...value] = item.trim().split('=');
    if (candidate === name) return value.join('=');
  }
  return undefined;
}

export function createStudioSecurity(port: number): StudioSecurity {
  const launchToken = randomBytes(32).toString('base64url');
  const sessionToken = randomBytes(32).toString('base64url');
  const origin = `http://127.0.0.1:${port}`;
  return {
    launchToken,
    sessionToken,
    origin,
    authorize(request, response) {
      const host = request.headers.host;
      if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
        response.statusCode = 403;
        response.end('Invalid Host header');
        return false;
      }
      const requestOrigin = request.headers.origin;
      if (requestOrigin && requestOrigin !== origin && requestOrigin !== `http://localhost:${port}`) {
        response.statusCode = 403;
        response.end('Invalid Origin header');
        return false;
      }
      const url = new URL(request.url ?? '/', origin);
      if (
        url.pathname === '/logo.svg' &&
        ['GET', 'HEAD'].includes(request.method ?? 'GET')
      ) {
        return true;
      }
      const launch = url.searchParams.get('token') ?? undefined;
      if (safeEqual(launch, launchToken)) {
        response.statusCode = 302;
        response.setHeader(
          'Set-Cookie',
          `cossack_studio_session=${sessionToken}; Path=/; HttpOnly; SameSite=Strict`,
        );
        response.setHeader('Location', `${url.pathname}${url.hash}`);
        response.end();
        return 'redirect';
      }
      if (!safeEqual(cookieValue(request.headers.cookie, 'cossack_studio_session'), sessionToken)) {
        response.statusCode = 401;
        response.end('Open Studio using the private launch URL printed by the CLI.');
        return false;
      }
      return true;
    },
    applyHeaders(response) {
      response.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; " +
        "frame-ancestors 'none'; form-action 'self'",
      );
      response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
      response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
      response.setHeader('Referrer-Policy', 'no-referrer');
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.setHeader('X-Frame-Options', 'DENY');
    },
  };
}
