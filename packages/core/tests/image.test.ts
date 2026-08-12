import { describe, expect, it } from 'vitest';
import { renderToString } from '@cossackframework/renderer';
import { Image } from '../src/shared/image';

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
