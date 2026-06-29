---
title: 'Static Site Generation (SSG)'
description: 'Pre-render pages at build time for faster page loads, better SEO, and hosting on any static hosting service.'
---

# Static Site Generation (SSG)

Cossack Framework supports Static Site Generation (SSG) to pre-render pages at build time. This enables faster page loads, better SEO, and the ability to host your application on any static hosting service.

## Overview

SSG in Cossack works by:

1. During build, identifying pages marked with `ssg: true`
2. Rendering each page to a static HTML file
3. Generating a `sitemap.xml` for SEO

## Usage

### Basic Static Page

Mark any page with `ssg: true` to enable static generation:

```typescript
import { Cossack, Page } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

@Page({ ssg: true })
export class About extends Cossack {
  render() {
    return html`<h1>About Us</h1>`;
  }
}
```

This will generate `dist/ssg/about/index.html` at build time.

### Dynamic Routes with Static Params

For dynamic routes (e.g., `/users/[username]`), use `generateStaticParams` to specify which parameter combinations to pre-render:

```typescript
import { Cossack, Page, State } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

@Page({
  ssg: {
    enabled: true,
    generateStaticParams: async () => {
      // Return array of params to pre-render
      return [{ username: 'alice' }, { username: 'bob' }, { username: 'charlie' }];
    },
  },
})
export class UserProfile extends Cossack {
  @State() username: string = '';

  render() {
    const name = this.c.req.param('username');
    return html`<h1>User: ${name}</h1>`;
  }
}
```

This will generate:

- `dist/ssg/users/alice/index.html`
- `dist/ssg/users/bob/index.html`
- `dist/ssg/users/charlie/index.html`

## Build Commands

SSG is driven by the `cossack` CLI (`cossack ssg`), which ships in the
standalone [`cossack`](https://www.npmjs.com/package/cossack) package (a
dependency of projects created by `cossack create`). It reads the `cossack-routes.json`
manifest emitted by the Cossack Vite plugin during `vite build`, and renders
your pages using **your own `App` and html template** (the same values you pass
to `createApp()` in `src/index.ts`) — so global `<head>` tags, branding, and
your html shell are applied identically in SSR and SSG. There is no per-project
build script to maintain.

### Standard Build

```bash
pnpm run build
```

Builds client assets and SSR bundle (no static HTML generation).

### SSG Build

```bash
pnpm run build:ssg
```

Runs `vite build` (which emits `cossack-routes.json`) followed by `cossack ssg`
to generate static HTML files.

### Build All

```bash
pnpm run build:all
```

Runs both standard build and SSG build.

### CLI flags

```bash
cossack ssg \
  --project-root ./ \       # project root (default: cwd)
  --out-dir dist/client \   # output dir (default: <root>/dist/client)
  --base-url https://… \    # override the sitemap/canonical base URL
  --app src/App.ts \        # override the App module
  --template src/root.ts    # override the html-template module
```

### Custom Base URL

The base URL used for sitemap and canonical URLs is read automatically from
your project config (`wrangler.jsonc` `vars.BASE_URL`, `.env`, or the `BASE_URL`
shell env). See [Sitemap → Base URL](./sitemap.md#base-url) for the full
resolution order. You can also override it per-build with
`cossack ssg --base-url …`.

The legacy `VITE_SSG_BASE_URL` env var is still respected as a fallback.

## How SSG resolves your App + html template

The CLI imports these by convention from your project root:

| What                   | Default path  | Export                  |
| ---------------------- | ------------- | ----------------------- |
| Global `App` component | `src/App.ts`  | `App` (or default)      |
| Html shell template    | `src/root.ts` | `template` (or default) |

These match what a scaffolded app passes to `createApp({ AppComponent, htmlTemplate })`,
so SSR and SSG stay in sync automatically. Override the paths with `--app` /
`--template` if your project layout differs.

## Output Structure

After SSG build, the `dist/client/` directory contains the static HTML alongside
the client assets:

```
dist/client/
├── index.html                    # Root page
├── about/
│   └── index.html                # /about page
├── users/
│   ├── alice/
│   │   └── index.html            # /users/alice page
│   └── bob/
│       └── index.html            # /users/bob page
├── cossack-routes.json           # Route/ID manifest (emitted by the Vite plugin)
├── sitemap.xml                   # XML sitemap for SEO
└── routes.json                   # List of generated routes
```

## PageOptions Interface

```typescript
export interface PageOptions {
  // ... existing options
  ssg?: boolean | SsgOptions;
}

export interface SsgOptions {
  enabled?: boolean;
  generateStaticParams?: () => Promise<Record<string, string>[]>;
}
```

## Limitations

- **No Server-Side State**: SSG pages cannot use `@State` with server-only data at build time. All state must be either:
  - Static content
  - Client-side state (use `@ClientState` instead)
  - Pre-defined via `generateStaticParams`

- **No Dynamic Data**: Pages that require real-time data (user-specific content, live prices, etc.) should not use SSG.

- **HTTP Transport Required**: SSG pages must use `transport: 'http'` in their `@Page` options.

## Best Practices

1. **Use SSG for Content Pages**: Marketing sites, blogs, documentation, about pages
2. **Use SSR for User Pages**: Dashboards, profiles, authenticated content
3. **Combine Both**: Some frameworks can use hybrid approaches where SSG is the default with SSR fallback

## Example: SSG Demo Page

See `src/pages/ssg-demo/` in the framework package for a complete example demonstrating:

- Static page generation
- Dynamic route generation with `generateStaticParams`
- Integration with the Layout component
