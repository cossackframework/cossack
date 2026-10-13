---
title: "Sitemap Generation"
description: "Automatic sitemap.xml generation during SSG builds with proper URL formatting and metadata for search engine discovery."
---

# Sitemap Generation

Cossack Framework generates a `sitemap.xml` file during every SSG build. The sitemap helps search engines discover and index your pages.

## Overview

The sitemap is generated during the SSG build and includes:

- All pre-rendered SSG pages
- URL formatting with your site's base URL
- Metadata such as `lastmod`, `changefreq`, and `priority`
- No API routes, 404 pages, or error pages

## Generated Sitemap Example

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://example.com/</loc>
    <lastmod>2026-03-23</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>https://example.com/about</loc>
    <lastmod>2026-03-23</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.5</priority>
  </url>
  <url>
    <loc>https://example.com/users/alice</loc>
    <lastmod>2026-03-23</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.5</priority>
  </url>
</urlset>
```

## Configuration

### Base URL

Cossack resolves the base URL in this order. The first match wins:

1. `APP_URL` in the shell environment. This override is useful in CI:
   ```bash
   APP_URL=https://my-site.com pnpm run build
   ```
2. `vars.APP_URL` in `wrangler.jsonc` or `wrangler.json`, or `APP_URL` in the `[vars]`
   table of `wrangler.toml`. This value is also available to your Worker at runtime
   through `config('app.url')`:
   ```jsonc
   {
     "vars": {
       "APP_URL": "https://my-site.com"
     }
   }
   ```
3. `APP_URL` in dotenv files. Later files override earlier ones:
   `.env`, `.env.<environment>`, `.env.local`, `.env.<environment>.local`.
   Without an environment, only `.env` and `.env.local` are used.
4. `https://example.com`. This is the final default.

When `CLOUDFLARE_ENV` is set, Wrangler values come from that environment's
`vars` object or `[env.<environment>.vars]` table. Top-level variables are not
inherited. The shell `APP_URL` override still takes precedence. An explicit
`baseUrl` on the `cossackSsg()` plugin overrides this resolution entirely.

### Sitemap Options

The sitemap generator accepts these options:

```typescript
interface SitemapOptions {
  baseUrl: string;
  defaultPriority?: number;      // Default: 0.5
  defaultChangefreq?: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';
  lastmod?: Date;                 // Default: current date
}
```

## Auto-Excluded Routes

The generator excludes these routes from the sitemap:

- API routes: paths that contain `/api/`, for example `/api/users`
- 404 pages: paths that contain `/404`
- Error pages: paths that contain `/error`

## Priority Settings

| Route | Priority | Reason |
|-------|----------|--------|
| Homepage (`/`) | 1.0 | Highest priority for the root page |
| All other pages | 0.5 (default) | Standard priority |

Customize the default priority in the options:

```typescript
// In build-ssg.ts or your custom SSG build script
const sitemap = generateSitemapFromUrls(routes, {
  baseUrl: 'https://example.com',
  defaultPriority: 0.7,
  defaultChangefreq: 'daily',
});
```

## Change Frequency

The `changefreq` field tells search engines how often the page changes. The default is `weekly`.

Supported values:

- `always`: With every change
- `hourly`: Every hour
- `daily`: Every day
- `weekly`: Every week
- `monthly`: Every month
- `yearly`: Every year
- `never`: Never changes

## API Reference

### generateSitemap

Generates a sitemap from route objects.

```typescript
function generateSitemap(
  routes: SsgRoute[],
  options: SitemapOptions
): string
```

### generateSitemapFromUrls

Generates a sitemap from an array of URL strings. Use it when you have the rendered URLs.

```typescript
function generateSitemapFromUrls(
  urls: string[],
  options: SitemapOptions
): string
```

### generateSitemapIndex

Generates a sitemap index for large sites with multiple sitemaps.

```typescript
function generateSitemapIndex(
  sitemaps: { loc: string; lastmod: Date }[],
  options: Pick<SitemapOptions, 'baseUrl'>
): string
```

## Output Location

The build saves the sitemap to:

```
dist/ssg/sitemap.xml
```

## Submitting to Search Engines

Submit the generated sitemap to search engines:

- Google: use the Sitemaps section in Google Search Console
- Bing: use the Sitemaps section in Bing Webmaster Tools

## Best Practices

1. Rebuild your SSG pages when content changes
2. Set a higher priority for important pages
3. Match `changefreq` to the update frequency of your content
4. Use XML sitemap validators to make sure that the format is correct
