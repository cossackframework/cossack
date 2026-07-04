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

## Optimization

For hosts without a built-in image CDN (e.g. the Node.js adapter), or when you want committed, pre-generated variants, use the CLI to optimize images at build time.

### `cossack image optimize`

The command scans `src/` for `Image({ ... })` helper calls, resolves each local `src` to a file under `public/`, and writes resized, re-encoded variants beside the original. It requires **ImageMagick** to be installed.

```bash
cossack image optimize
cossack image optimize --format avif --quality 85
cossack image optimize --dry-run      # preview without writing
```

For each `Image({ src, width, height })` call referencing a local asset, a file named `<name>-<w>x<h>.<format>` is generated:

```
public/img/hero.png  +  Image({ src: '/img/hero.png', width: 800, height: 600 })
                   ->  public/img/hero-800x600.webp
```

| Option | Description |
| :--- | :--- |
| `--format <webp\|avif>` | Output format (default: `webp`). |
| `--quality <0-100>` | Output quality (default: `80`). |
| `--dry-run` | List the variants that would be generated without writing. |

**Installing ImageMagick**

```bash
# macOS
brew install imagemagick
# Debian/Ubuntu
sudo apt-get install imagemagick
# Windows (Chocolatey)
choco install imagemagick
```

If the binary is missing, the command prints these instructions and exits with a non-zero code.

> **Cloudflare deployments:** prefer runtime resizing via `/cdn-cgi/image/...` (set `VITE_COSSACK_IMAGE_PROVIDER=cloudflare`) — it generates variants on demand at the edge with no build step. Use `cossack image optimize` for the Node.js adapter or when you want the files committed to your repository.

See the [Cossack CLI reference](/docs/cossack-cli.md#image-optimization) for the full `image optimize` options.
