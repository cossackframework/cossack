import { describe, it, expect } from 'vitest';
import {
  extractImageCalls,
  isLocalSource,
  resolveOutputPath,
} from '../src/image-scan.js';

describe('extractImageCalls', () => {
  it('extracts a single Image call with src + width + height', () => {
    const src = `
      import { Image } from '@cossackframework/core';
      const x = Image({ src: '/img/foo.png', width: 600, height: 400, alt: 'x' });
    `;
    const calls = extractImageCalls(src);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      src: '/img/foo.png',
      width: 600,
      height: 400,
    });
  });

  it('extracts quality and format', () => {
    const src = `Image({ src: '/a.jpg', width: 100, quality: 90, format: 'avif' });`;
    const calls = extractImageCalls(src);
    expect(calls[0]).toMatchObject({ quality: 90, format: 'avif' });
  });

  it('handles multiple calls and template-literal src', () => {
    const src = `
      Image({ src: \`/img/\${name}.png\`, width: 100 });
      Image({ src: '/other.jpg', height: 50 });
    `;
    const calls = extractImageCalls(src);
    expect(calls).toHaveLength(2);
    // template literal capture: the simple regex grabs the inner expression literally
    expect(calls[0].width).toBe(100);
    expect(calls[1].height).toBe(50);
  });

  it('ignores nested braces inside string values', () => {
    const src = `Image({ src: '/a.png', width: 100, alt: 'a {b} c' });`;
    const calls = extractImageCalls(src);
    expect(calls).toHaveLength(1);
    expect(calls[0].src).toBe('/a.png');
  });

  it('ignores Image as a substring of another identifier', () => {
    const src = `const foo = myImageFunc({ src: '/a.png' });`;
    const calls = extractImageCalls(src);
    expect(calls).toHaveLength(0);
  });

  it('handles whitespace/newlines in the props object', () => {
    const src = `Image({
      src: '/img/foo.png',
      width: 200,
      height: 100,
    });`;
    const calls = extractImageCalls(src);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ src: '/img/foo.png', width: 200, height: 100 });
  });

  it('returns empty for empty/non-string input', () => {
    expect(extractImageCalls('')).toEqual([]);
    expect(extractImageCalls(null)).toEqual([]);
  });

  it('skips calls without src/width/height', () => {
    const src = `Image({ alt: 'no dims here' });`;
    expect(extractImageCalls(src)).toEqual([]);
  });
});

describe('isLocalSource', () => {
  it('true for relative and absolute local paths', () => {
    expect(isLocalSource('/img/foo.png')).toBe(true);
    expect(isLocalSource('img/foo.png')).toBe(true);
  });
  it('false for remote URLs', () => {
    expect(isLocalSource('https://example.com/a.png')).toBe(false);
    expect(isLocalSource('http://example.com/a.png')).toBe(false);
  });
  it('false for data URIs and already-resized CF URLs', () => {
    expect(isLocalSource('data:image/png;base64,abc')).toBe(false);
    expect(isLocalSource('/cdn-cgi/image/width=100/img/foo.png')).toBe(false);
  });
  it('false for empty/non-string', () => {
    expect(isLocalSource('')).toBe(false);
    expect(isLocalSource(null)).toBe(false);
  });
});

describe('resolveOutputPath', () => {
  it('appends size + format with leading slash', () => {
    expect(resolveOutputPath('/img/foo.png', 600, 400, 'webp')).toBe(
      '/img/foo-600x400.webp',
    );
  });
  it('works without leading slash', () => {
    expect(resolveOutputPath('foo.png', 100, 50, 'webp')).toBe('foo-100x50.webp');
  });
  it('omits height when not provided', () => {
    expect(resolveOutputPath('/a.jpg', 800, undefined, 'avif')).toBe(
      '/a-800.avif',
    );
  });
  it('defaults to webp when format omitted', () => {
    expect(resolveOutputPath('/a.jpg', 200)).toBe('/a-200.webp');
  });
});
