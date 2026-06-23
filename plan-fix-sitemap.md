# Fix - Sitemap generator
Currently, `sitemap.xml` is generated as `example.com`, we should have configuration for the domain name to generate, since we will run via `build:ssg`, should we create `.env` file for configuration, but we need to make sure that we are compatibility with Cloudflare Workers too which use their `wrangler.jsonc` and `[vars]` for configuration. Maybe we prefer `wrangler.jsonc` or `wrangler.toml`, then fallback to `.env` if not found. 

Example current `sitemap.xml`:

```xml
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url>
<loc>https://example.com/about</loc>
<lastmod>2026-06-23</lastmod>
<changefreq>weekly</changefreq>
<priority>0.5</priority>
</url>
<url>
<loc>https://example.com/</loc>
<lastmod>2026-06-23</lastmod>
<changefreq>weekly</changefreq>
<priority>1</priority>
</url>
<url>
<loc>https://example.com/portfolio</loc>
<lastmod>2026-06-23</lastmod>
<changefreq>weekly</changefreq>
<priority>0.5</priority>
</url>
<url>
<loc>https://example.com/services</loc>
<lastmod>2026-06-23</lastmod>
<changefreq>weekly</changefreq>
<priority>0.5</priority>
</url>
</urlset>
```