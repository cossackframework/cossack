import { Cossack, Page } from '@cossackframework/core';
import { html, component } from '@cossackframework/renderer';
import { Image } from '@cossackframework/core';
import { Layout } from '@/components/Layout';

@Page({ transport: 'http' })
export default class ImageDemo extends Cossack {
  render() {
    return component(Layout, { dir: 'ltr' }, html`
      <h1>Image Optimization Demo</h1>
      <p>This image is rendered using the <code>Image</code> helper.</p>
      
      <div class="max-w-[600px] border border-gray-300">
        ${Image({
            src: 'https://images.unsplash.com/photo-1550989460-0adf9ea622e2?q=80&w=600&auto=format&fit=crop',
            width: 600,
            height: 400,
            fit: 'cover',
            alt: 'Demo Image',
            class: 'demo-img'
        })}
      </div>

      <p>
        If <code>VITE_COSSACK_IMAGE_PROVIDER=cloudflare</code> is set, this will be served via Cloudflare Image Resizing.
        Otherwise, it serves the original Unsplash URL.
      </p>

      <hr>
      <p>
        <a href="/optimistic-counter">Go Back to Optimistic Counter</a>
      </p>
    `);
  }
}
