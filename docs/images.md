---
title: "Image Optimization"
description: "Render responsive images with the Image helper and Cloudflare Image Resizing."
---

# Image Optimization

Use the `Image` helper to render responsive images. On Cloudflare, the helper can use Cloudflare Image Resizing to serve an image at a requested size and format.

## Usage

Import `Image` from `@cossackframework/core` and call it in a template.

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

The `Image` helper accepts these properties:

| Prop | Type | Description |
| :--- | :--- | :--- |
| `src` | `string` | The source URL of the image (relative or absolute). |
| `width` | `number` | The desired width in pixels. |
| `height` | `number` | The desired height in pixels. |
| `fit` | `'cover' \| 'contain' \| ...` | The method used to resize the image to the requested dimensions. |
| `quality` | `number` | The quality of the image (1-100). |
| `format` | `'webp' \| 'avif' \| 'json'` | The output format. |
| `alt` | `string` | The alt text for accessibility. |
| `class` | `string` | CSS class names. |
| `loading` | `'lazy' \| 'eager'` | Native browser loading behavior (default: 'lazy'). |

## Configuration

Image behavior depends on your environment configuration.

### 1. Development (Local)

In development mode (`import.meta.env.DEV`), the helper renders an `<img>` tag that points to the original `src`. You can also optimize images at build time with [`cossack image optimize`](#build-time-optimization).

### 2. Production (Cloudflare)

To use Cloudflare Image Resizing in production, set this environment variable in `wrangler.jsonc` or in your build environment:

```bash
VITE_COSSACK_IMAGE_PROVIDER=cloudflare
```

When this is set, the helper transforms your URL:
* **Input:** `/assets/banner.jpg` (with `width: 800`)
* **Output:** `/cdn-cgi/image/width=800/assets/banner.jpg`

### 3. Production (Node.js / Other)

If `VITE_COSSACK_IMAGE_PROVIDER` is not set or is set to `none`, the helper renders the original `src`.

## Build Time Optimization

For hosts without an image CDN, such as Node.js, or to commit pre-generated image variants, optimize images at build time with the CLI.

### `cossack image optimize`

The command scans `src/` for `Image({ ... })` calls. It finds each local `src` file under `public/` and writes resized versions beside the original. Install **ImageMagick** to use this command.

```bash
cossack image optimize
cossack image optimize --format avif --quality 85
cossack image optimize --dry-run      # preview without writing
```

For each `Image({ src, width })` call that references a local asset, the command generates a variant. Set `width` to size the variant. If you set `height`, the filename includes both dimensions:

```
public/img/hero.png  +  Image({ src: '/img/hero.png', width: 800 })          ->  public/img/hero-800.webp
public/img/hero.png  +  Image({ src: '/img/hero.png', width: 800, height: 600 })  ->  public/img/hero-800x600.webp
```

| Option | Description |
| :--- | :--- |
| `--format <webp\|avif>` | Output format (default: `webp`). |
| `--quality <0-100>` | Output quality (default: `80`). |
| `--dry-run` | List the image variants without writing them. |

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

> **Cloudflare deployments:** prefer runtime resizing via `/cdn-cgi/image/...` (set `VITE_COSSACK_IMAGE_PROVIDER=cloudflare`) : it generates variants on demand at the edge with no build step. Use `cossack image optimize` for the Node.js adapter or when you want the files committed to your repository.

See the [Cossack CLI reference](/docs/cossack-cli.md#image-optimization) for the full `image optimize` options.
