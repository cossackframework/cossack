#!/usr/bin/env node

/**
 * SSG Build Script
 *
 * This script runs the SSG (Static Site Generation) build process.
 * It should be run after `vite build` which produces the client assets.
 * The script:
 * 1. Collects all pages marked with ssg: true
 * 2. Renders each page to static HTML
 * 3. Generates a sitemap.xml
 *
 * Usage:
 *   vite build && tsx scripts/build-ssg.ts
 *   VITE_SSG_BASE_URL=https://my-site.com tsx scripts/build-ssg.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// Import SSG utilities using relative paths (tsx will handle TypeScript)
import { collectSsgRoutes, getStaticParams, renderSsgPage, HtmlTemplate } from '../src/ssg-renderer.ts';
import { generateSitemapFromUrls } from '../src/sitemap-generator.ts';
import { getSiteUrl } from '../src/ssg-config.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
// SSG HTML and sitemap.xml are written directly into the Cloudflare ASSETS
// directory (dist/client), so they are served as static assets before the
// Worker is ever invoked. This eliminates the previous dist/ssg-static/
// superset directory and the redundant copy-back step.
const DIST_DIR = path.resolve(PROJECT_ROOT, 'dist/client');

/**
 * Optionally load a custom htmlTemplate module. Set COSSACK_HTML_TEMPLATE to a
 * module path (absolute or relative to the project root) that default-exports
 * a string or a (helpers) => string function. If not set or load fails, SSG
 * falls back to renderRoot's built-in template.
 */
async function loadHtmlTemplate(): Promise<HtmlTemplate | undefined> {
  const templatePath = process.env.COSSACK_HTML_TEMPLATE;
  if (!templatePath) return undefined;
  const resolved = path.isAbsolute(templatePath)
    ? templatePath
    : path.resolve(PROJECT_ROOT, templatePath);
  try {
    const mod = await import(`file://${resolved}`);
    return mod.default as HtmlTemplate;
  } catch (e) {
    console.warn(`[build-ssg] Could not load htmlTemplate from ${resolved}: ${e}`);
    return undefined;
  }
}

async function main() {
  console.log('Starting SSG rendering...');

  // Resolve base URL from project config (wrangler.jsonc/.env/shell env).
  const baseUrl = getSiteUrl({ projectRoot: PROJECT_ROOT });
  console.log(`Using base URL: ${baseUrl}`);

  // Optional custom htmlTemplate
  const htmlTemplate = await loadHtmlTemplate();
  if (htmlTemplate) {
    console.log('Using custom htmlTemplate.');
  }

  // Collect pages and layouts using Node.js fs.
  // The key format MUST match the vite plugin's `import.meta.glob` keys
  // (e.g. "/src/pages/ssg-demo/index.ts") because the router assigns
  // deterministic componentRouteIds by sorting these keys — if the set
  // differs, the IDs will be wrong and client-side RPC will break.
  const pagesDir = path.resolve(PROJECT_ROOT, 'src/pages');
  const pageKeys = new Set<string>();
  const layoutKeys = new Set<string>();

  function scanFiles(dir: string) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        scanFiles(fullPath);
      } else if (entry.isFile()) {
        const relPath = path.relative(pagesDir, fullPath).split(path.sep).join('/');
        const key = `/src/pages/${relPath}`;

        if (entry.name === 'layout.ts') {
          layoutKeys.add(key);
        } else if (entry.name === 'loading.ts') {
          // loading.ts files are not pages or layouts — skip (matches the
          // vite plugin's glob exclusions).
        } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.mdx')) {
          pageKeys.add(key);
        }
      }
    }
  }

  scanFiles(pagesDir);

  // Compute the componentRouteId map using the same logic as router.ts:
  //   [...pageKeys, ...layoutKeys].sort() → cmp_0, cmp_1, ...
  const sortedKeys = [...pageKeys, ...layoutKeys].sort();
  const routeIdMap = new Map<string, string>();
  sortedKeys.forEach((p, i) => {
    routeIdMap.set(p, `cmp_${i.toString(36)}`);
  });

  // Load actual modules using dynamic import with file:// URL.
  // Only .ts files can be loaded by tsx; .mdx files require the vite plugin's
  // transform and are skipped (they can't be SSG pages anyway).
  const loadedPages: Record<string, unknown> = {};
  for (const key of pageKeys) {
    if (!key.endsWith('.ts')) continue;

    const relFile = key.replace('/src/pages/', '').replace(/^\//, '');
    const fullPath = path.join(pagesDir, relFile);

    try {
      const module = await import(`file://${fullPath}`);
      loadedPages[key] = module;
    } catch (e) {
      console.warn(`[build-ssg] Could not load page: ${key} from ${fullPath}: ${e}`);
    }
  }

  const loadedLayouts: Record<string, unknown> = {};
  for (const key of layoutKeys) {
    const relFile = key.replace('/src/pages/', '').replace(/^\//, '');
    const fullPath = path.join(pagesDir, relFile);
    try {
      const module = await import(`file://${fullPath}`);
      loadedLayouts[key] = module;
    } catch (e) {
      console.warn(`[build-ssg] Could not load layout: ${key} from ${fullPath}: ${e}`);
    }
  }

  // Collect SSG routes
  const ssgRoutes = collectSsgRoutes(loadedPages, loadedLayouts);

  console.log(`Found ${ssgRoutes.length} SSG routes`);

  // Ensure output directory exists
  if (!fs.existsSync(DIST_DIR)) {
    fs.mkdirSync(DIST_DIR, { recursive: true });
  }

  // Render each SSG page
  const renderedRoutes: string[] = [];

  for (const route of ssgRoutes) {
    console.log(`Rendering: ${route.routePath}`);

    try {
      // Get static params if this is a dynamic route
      const staticParamsList = await getStaticParams(route.pageOptions);

      for (const staticParams of staticParamsList) {
        // Generate the route path with params
        let routePath = route.routePath;
        if (staticParams && Object.keys(staticParams).length > 0) {
          for (const [key, value] of Object.entries(staticParams)) {
            // Handle both :name and [name] style segments
            routePath = routePath.replace(`:${key}`, value);
            routePath = routePath.replace(`[${key}]`, value);
          }
        }

        // Render the page
        const html = await renderSsgPage(
          route.component,
          routePath,
          staticParams,
          loadedLayouts as Record<string, { default: new () => any }>,
          baseUrl,
          undefined,
          htmlTemplate,
          route.filePath,
          routeIdMap.get(route.filePath)
        );

        // Determine output file path
        const outputFilePath = getOutputFilePath(routePath, DIST_DIR);

        // Ensure directory exists
        const outputDir = path.dirname(outputFilePath);
        if (!fs.existsSync(outputDir)) {
          fs.mkdirSync(outputDir, { recursive: true });
        }

        // Write the HTML file
        fs.writeFileSync(outputFilePath, html, 'utf-8');
        console.log(`Written: ${outputFilePath}`);

        renderedRoutes.push(routePath);
      }
    } catch (error) {
      console.error(`Error rendering ${route.routePath}:`, error);
    }
  }

  // Generate sitemap
  console.log('\nGenerating sitemap...');

  const sitemap = generateSitemapFromUrls(renderedRoutes, {
    baseUrl,
    lastmod: new Date(),
  });

  const sitemapPath = path.join(DIST_DIR, 'sitemap.xml');
  fs.writeFileSync(sitemapPath, sitemap, 'utf-8');
  console.log(`Written sitemap: ${sitemapPath}`);

  // Also export the routes data
  const routesDataPath = path.join(DIST_DIR, 'routes.json');
  fs.writeFileSync(
    routesDataPath,
    JSON.stringify(renderedRoutes, null, 2),
    'utf-8'
  );

  // List generated files
  console.log('\nGenerated SSG files:');
  listFiles(DIST_DIR, '');

  console.log('\nSSG build complete!');
}

function getOutputFilePath(routePath: string, outputDir: string): string {
  let normalizedPath = routePath;

  if (!normalizedPath.startsWith('/')) {
    normalizedPath = '/' + normalizedPath;
  }

  if (normalizedPath !== '/' && normalizedPath.endsWith('/')) {
    normalizedPath = normalizedPath.slice(0, -1);
  }

  if (normalizedPath === '/' || normalizedPath === '') {
    return path.join(outputDir, 'index.html');
  }

  const segments = normalizedPath.split('/').filter(Boolean);
  const dirPath = path.join(outputDir, ...segments);
  return path.join(dirPath, 'index.html');
}

function listFiles(dir: string, prefix: string) {
  if (!fs.existsSync(dir)) return;

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      console.log(`${prefix}${entry.name}/`);
      listFiles(entryPath, prefix + '  ');
    } else {
      const stats = fs.statSync(entryPath);
      const size = formatSize(stats.size);
      console.log(`${prefix}${entry.name} (${size})`);
    }
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

main().catch((err) => {
  console.error('SSG build failed:', err);
  process.exit(1);
});
