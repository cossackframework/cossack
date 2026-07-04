import { describe, it, expect } from 'vitest';
import { filePathToHttpRoute, filePathToRoutePath, APP_ROUTE_ID } from '../src/route-ids';

describe('filePathToHttpRoute', () => {
  it('converts a dynamic segment', () => {
    expect(filePathToHttpRoute('/src/pages/hello/[name]/index.ts')).toBe('/hello/:name');
  });

  it('converts a catch-all segment to :name* (Hono wildcard)', () => {
    expect(filePathToHttpRoute('/src/pages/docs/[...slug]/index.ts')).toBe('/docs/:slug*');
  });

  it('handles a catch-all at the root', () => {
    expect(filePathToHttpRoute('/src/pages/[...all]/index.ts')).toBe('/:all*');
  });

  it('mixes dynamic and catch-all segments', () => {
    expect(filePathToHttpRoute('/src/pages/users/[id]/files/[...rest]/index.ts'))
      .toBe('/users/:id/files/:rest*');
  });

  it('removes route groups', () => {
    expect(filePathToHttpRoute('/src/pages/(auth)/login/index.ts')).toBe('/login');
  });

  it('normalises the index route to /', () => {
    expect(filePathToHttpRoute('/src/pages/index.ts')).toBe('/');
    expect(filePathToHttpRoute('/src/pages/index/index.ts')).toBe('/');
  });

  it('does NOT leave the invalid :...slug token', () => {
    const route = filePathToHttpRoute('/src/pages/catch/[...path]/index.ts');
    expect(route).not.toContain('...');
    expect(route).toContain(':path*');
  });
});

describe('filePathToRoutePath (kept-bracket form for IDs)', () => {
  it('keeps bracketed segment names', () => {
    expect(filePathToRoutePath('/src/pages/hello/[name]/index.ts')).toBe('/hello/[name]');
  });

  it('exposes the reserved App route id', () => {
    expect(APP_ROUTE_ID).toBe('cossack_app');
  });
});
