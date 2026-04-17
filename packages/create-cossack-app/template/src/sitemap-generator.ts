import type { Cossack, PageOptions } from '@cossackframework/core';

// Re-export types from core
export type { PageOptions, SsgOptions } from '@cossackframework/core';

export interface SsgRoute {
  routePath: string;
  filePath: string;
  component: new () => Cossack;
  pageOptions?: PageOptions;
}

export interface SitemapOptions {
  baseUrl: string;
  defaultPriority?: number;
  defaultChangefreq?: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';
  lastmod?: Date;
}

export interface SitemapEntry {
  loc: string;
  lastmod?: string;
  changefreq?: string;
  priority?: number;
}

/**
 * Check if a route should be excluded from the sitemap.
 * API routes, 404 pages, and error pages are excluded.
 */
function shouldExcludeRoute(routePath: string): boolean {
  // Exclude API routes
  if (routePath.includes('/api/')) return true;

  // Exclude 404 pages
  if (routePath.includes('/404')) return true;

  // Exclude error pages
  if (routePath.includes('/error')) return true;

  return false;
}

/**
 * Format a date to ISO 8601 format (YYYY-MM-DD).
 */
function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

/**
 * Generate a sitemap XML string from SSG routes.
 */
export function generateSitemap(
  routes: SsgRoute[],
  options: SitemapOptions
): string {
  const {
    baseUrl,
    defaultPriority = 0.5,
    defaultChangefreq = 'weekly',
    lastmod = new Date(),
  } = options;

  const lastmodStr = formatDate(lastmod);

  const entries: SitemapEntry[] = routes
    .filter((route) => !shouldExcludeRoute(route.routePath))
    .map((route) => {
      // Normalize route path (ensure it starts with /)
      let routePath = route.routePath;
      if (!routePath.startsWith('/')) {
        routePath = '/' + routePath;
      }

      // Remove trailing slashes except for root
      if (routePath !== '/' && routePath.endsWith('/')) {
        routePath = routePath.slice(0, -1);
      }

      return {
        loc: `${baseUrl.replace(/\/$/, '')}${routePath}`,
        lastmod: lastmodStr,
        changefreq: defaultChangefreq,
        priority:
          routePath === '/'
            ? 1.0 // Homepage gets highest priority
            : defaultPriority,
      };
    });

  // Build sitemap XML
  const urlEntries = entries
    .map(
      (entry) => `  <url>
    <loc>${escapeXml(entry.loc)}</loc>
    <lastmod>${entry.lastmod}</lastmod>
    <changefreq>${entry.changefreq}</changefreq>
    <priority>${entry.priority}</priority>
  </url>`
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urlEntries}
</urlset>`;
}

/**
 * Escape special XML characters.
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Generate a sitemap index XML for multiple sitemaps.
 */
export function generateSitemapIndex(
  sitemaps: { loc: string; lastmod: Date }[],
  options: Pick<SitemapOptions, 'baseUrl'>
): string {
  const lastmodStrs = sitemaps.map((s) => formatDate(s.lastmod));

  const sitemapEntries = sitemaps
    .map(
      (sitemap, i) => `  <sitemap>
    <loc>${escapeXml(sitemap.loc)}</loc>
    <lastmod>${lastmodStrs[i]}</lastmod>
  </sitemap>`
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapEntries}
</sitemapindex>`;
}

/**
 * Generate a sitemap XML string from an array of URL strings.
 * This is useful for SSG when you have the actual rendered URLs.
 */
export function generateSitemapFromUrls(
  urls: string[],
  options: SitemapOptions
): string {
  const {
    baseUrl,
    defaultPriority = 0.5,
    defaultChangefreq = 'weekly',
    lastmod = new Date(),
  } = options;

  const lastmodStr = formatDate(lastmod);

  const entries: SitemapEntry[] = urls
    .filter((url) => !shouldExcludeRoute(url))
    .map((url) => {
      // Normalize route path
      let routePath = url;
      if (!routePath.startsWith('/')) {
        routePath = '/' + routePath;
      }
      if (routePath !== '/' && routePath.endsWith('/')) {
        routePath = routePath.slice(0, -1);
      }

      return {
        loc: `${baseUrl.replace(/\/$/, '')}${routePath}`,
        lastmod: lastmodStr,
        changefreq: defaultChangefreq,
        priority: routePath === '/' ? 1.0 : defaultPriority,
      };
    });

  // Build sitemap XML
  const urlEntries = entries
    .map(
      (entry) => `  <url>
    <loc>${escapeXml(entry.loc)}</loc>
    <lastmod>${entry.lastmod}</lastmod>
    <changefreq>${entry.changefreq}</changefreq>
    <priority>${entry.priority}</priority>
  </url>`
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urlEntries}
</urlset>`;
}
