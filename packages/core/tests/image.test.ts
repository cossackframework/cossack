import { describe, expect, it } from 'vitest';
import { renderToString } from '@cossackframework/renderer';
import { Image, imageDiagnostics } from '../src/shared/image';

describe('Image', () => {
  it('renders supplied intrinsic dimensions on the image element', () => {
    const output = renderToString(Image({
      src: '/hero.png',
      width: 1200,
      height: 630,
      alt: 'Hero',
    }));

    expect(output).toContain('width="1200"');
    expect(output).toContain('height="630"');
  });

  it('omits dimensions that were not supplied', () => {
    const output = renderToString(Image({ src: '/avatar.png', alt: 'Avatar' }));
    expect(output).not.toContain('width=');
    expect(output).not.toContain('height=');
  });
});

it('explains unsupported transforms and missing image provider setup without echoing sources', () => {
  const props = { src: 'https://private.test/token', quality: 80, format: 'webp' as const };
  const result = imageDiagnostics(props);
  expect(result).toContainEqual(expect.objectContaining({ code: 'COSSACK_IMAGE_TRANSFORM_UNAVAILABLE', action: expect.stringContaining('Cloudflare') }));
  expect(JSON.stringify(result)).not.toContain(props.src);
  expect(imageDiagnostics(props, { provider: 'cloudflare', development: true })[0]?.code).toBe('COSSACK_IMAGE_TRANSFORM_LOCAL');
  expect(imageDiagnostics(props, { provider: 'cloudflare' })).toEqual([]);
  expect(imageDiagnostics(props, { provider: 'unknown' })[0]?.code).toBe('COSSACK_IMAGE_PROVIDER_INVALID');
});
it('rejects invalid dimensions, quality and non-image formats with fixed diagnostics', () => {
  expect(() => Image({ src: '/image.png', width: -1 })).toThrow(expect.objectContaining({ code: 'COSSACK_IMAGE_DIMENSION_INVALID' }));
  expect(imageDiagnostics({ src: '/image.png', quality: 101 })[0]?.code).toBe('COSSACK_IMAGE_QUALITY_INVALID');
  expect(imageDiagnostics({ src: '/image.png', format: 'json' as never })[0]?.code).toBe('COSSACK_IMAGE_FORMAT_INVALID');
});
