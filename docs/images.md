---
title: "Image Optimization"
description: "Built-in Image helper for rendering responsive, optimized images that can leverage Cloudflare Image Resizing when deployed."
---

# Image Optimization

Cossack provides a built-in `Image` helper to easily render responsive, optimized images. When deployed to Cloudflare, it can automatically leverage **Cloudflare Image Resizing** to serve images at the perfect size and format for your user's device.

## Usage

Import the `Image` helper from `@cossackframework/core` and use it in your templates.

```typescript
import { Cossack, Page } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';
import { Image } from '@cossackframework/core';

@Page()
export class Hero extends Cossack {
    protected render() {
        return html`
            <div class="hero">
                ${Image({
                    src: '/assets/banner.jpg',
                    width: 800,
                    height: 400,
                    fit: 'cover',
                    alt: 'Welcome Banner',
                    loading: 'eager'
                })}
            </div>
        `;
    }
}
```

## Props

The `Image` helper accepts the following properties:

| Prop | Type | Description |
| :--- | :--- | :--- |
| `src` | `string` | The source URL of the image (relative or absolute). |
| `width` | `number` | The desired width in pixels. |
| `height` | `number` | The desired height in pixels. |
| `fit` | `'cover' \| 'contain' \| ...` | How the image should be resized to fit the dimensions. |
| `quality` | `number` | The quality of the image (1-100). |
| `format` | `'webp' \| 'avif' \| 'json'` | The output format. |
| `alt` | `string` | The alt text for accessibility. |
| `class` | `string` | CSS class names. |
| `loading` | `'lazy' \| 'eager'` | Native browser loading behavior (default: 'lazy'). |

## Configuration

The optimization behavior depends on your environment configuration.

### 1. Development (Local)

By default, in development mode (`import.meta.env.DEV`), the `Image` helper renders a standard `<img>` tag pointing to the original `src`. No optimization is applied to avoid breaking local assets that aren't proxied.

### 2. Production (Cloudflare)

To enable Cloudflare Image Resizing in production, set the following environment variable in your `wrangler.jsonc` or build environment:

```bash
VITE_COSSACK_IMAGE_PROVIDER=cloudflare
```

When this is set, the helper transforms your URL:
*   **Input:** `/assets/banner.jpg` (with `width: 800`)
*   **Output:** `/cdn-cgi/image/width=800/assets/banner.jpg`

### 3. Production (Node.js / Other)

If `VITE_COSSACK_IMAGE_PROVIDER` is not set or set to `none`, the helper acts as a pass-through, rendering the original `src`. This ensures your application works correctly on any platform, even without an image optimization service.
