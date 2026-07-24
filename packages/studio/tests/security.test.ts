import { describe, expect, it, vi } from 'vitest';
import { createStudioSecurity } from '../src/server/security';

function response() {
  const headers = new Map<string, unknown>();
  return {
    statusCode: 200,
    setHeader: vi.fn((name: string, value: unknown) => headers.set(name.toLowerCase(), value)),
    end: vi.fn(),
    headers,
  };
}

describe('Studio loopback security', () => {
  it('establishes a strict HttpOnly session from the private launch URL', () => {
    const security = createStudioSecurity(4983);
    const target = response();
    const result = security.authorize({
      headers: { host: '127.0.0.1:4983' },
      url: `/?token=${security.launchToken}`,
    } as any, target as any);
    expect(result).toBe('redirect');
    expect(target.statusCode).toBe(302);
    expect(target.headers.get('set-cookie')).toContain('HttpOnly; SameSite=Strict');
    expect(target.headers.get('location')).toBe('/');
  });

  it('rejects missing sessions and cross-site Host/Origin headers', () => {
    const security = createStudioSecurity(4983);
    const missing = response();
    expect(security.authorize({
      headers: { host: '127.0.0.1:4983' },
      url: '/',
    } as any, missing as any)).toBe(false);
    expect(missing.statusCode).toBe(401);

    for (const headers of [
      { host: 'evil.example' },
      { host: '127.0.0.1:4983', origin: 'https://evil.example' },
    ]) {
      const target = response();
      expect(security.authorize({ headers, url: '/' } as any, target as any)).toBe(false);
      expect(target.statusCode).toBe(403);
    }
  });

  it('sets restrictive browser headers', () => {
    const security = createStudioSecurity(4983);
    const target = response();
    security.applyHeaders(target as any);
    expect(target.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(target.headers.get('content-security-policy')).toContain("object-src 'none'");
    expect(target.headers.get('x-frame-options')).toBe('DENY');
    expect(target.headers.get('referrer-policy')).toBe('no-referrer');
  });
});
