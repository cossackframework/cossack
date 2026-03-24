# Sitemap Generation

Cossack Framework automatically generates a `sitemap.xml` file when building with SSG. The sitemap helps search engines discover and index your pages.

## Overview

The sitemap is automatically generated during SSG build and includes:

- All pre-rendered SSG pages
- Proper URL formatting with your site's base URL
- Metadata like `lastmod`, `changefreq`, and `priority`
- Excludes API routes, 404 pages, and error pages

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

Set the base URL used in the sitemap via environment variable:

```bash
VITE_SSG_BASE_URL=https://my-site.com pnpm run build:ssg
```

Default: `https://example.com`

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

The following routes are automatically excluded from the sitemap:

- **API Routes**: Paths containing `/api/` (e.g., `/api/users`)
- **404 Pages**: Paths containing `/404`
- **Error Pages**: Paths containing `/error`

## Priority Settings

| Route | Priority | Reason |
|-------|----------|--------|
| Homepage (`/`) | 1.0 | Highest priority for the root page |
| All other pages | 0.5 (default) | Standard priority |

You can customize the default priority in the options:

```typescript
// In build-ssg.ts or your custom SSG build script
const sitemap = generateSitemapFromUrls(routes, {
  baseUrl: 'https://example.com',
  defaultPriority: 0.7,
  defaultChangefreq: 'daily',
});
```

## Change Frequency

The `changefreq` field indicates how often the page is likely to change. Default is `weekly`.

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

Generates a sitemap from an array of URL strings. Useful when you have the rendered URLs.

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

The generated sitemap is saved to:

```
dist/ssg/sitemap.xml
```

## Submitting to Search Engines

After generating your sitemap, submit it to search engines:

- **Google**: Use Google Search Console → Sitemaps
- **Bing**: Use Bing Webmaster Tools → Sitemaps

## Best Practices

1. **Keep it Updated**: Rebuild your SSG pages when content changes
2. **Use Correct Priority**: Set higher priority for important pages
3. **Set Appropriate Changefreq**: Match the update frequency of your content
4. **Validate**: Use XML sitemap validators to ensure proper format
