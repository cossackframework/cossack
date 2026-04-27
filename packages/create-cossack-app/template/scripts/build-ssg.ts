#!/usr/bin/env node

/**
 * SSG Build Script
 *
 * This script runs the SSG (Static Site Generation) build process.
 * It:
 * 1. Builds the SSR bundle with SSG mode
 * 2. Collects all pages marked with ssg: true
 * 3. Renders each page to static HTML
 * 4. Generates a sitemap.xml
 *
 * Usage:
 *   tsx scripts/build-ssg.js
 *   VITE_SSG_BASE_URL=https://my-site.com tsx scripts/build-ssg.js
 */

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// Import SSG utilities from framework package
import { collectSsgRoutes, getStaticParams, renderSsgPage } from '@cossackframework/framework/ssg-renderer';
import { generateSitemapFromUrls } from '@cossackframework/framework/sitemap-generator';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
// SSG files go to dist/ssg-static (separate from dist/client which Vite may overwrite)
const DIST_DIR = path.resolve(PROJECT_ROOT, 'dist/ssg-static');

async function main() {
  console.log('Starting SSG build...');

  // Get base URL from environment or use default
  const baseUrl = process.env.VITE_SSG_BASE_URL || 'https://example.com';
  console.log(`Using base URL: ${baseUrl}`);

  // Step 1: Run the SSR build
  console.log('\nRunning SSR build...');

  const env = {
    ...process.env,
    VITE_BUILD_SSG: 'true',
    VITE_BUILD_SSR: 'true',
    VITE_SSG_BASE_URL: baseUrl,
  };

  await new Promise((resolve, reject) => {
    const buildProcess = spawn('pnpm', ['exec', 'vite', 'build', '--config', 'vite.ssr.config.ts', '--mode', 'ssg'], {
      cwd: PROJECT_ROOT,
      env,
      shell: true,
      stdio: 'inherit',
    });

    buildProcess.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`SSR build failed with code ${code}`));
      }
    });

    buildProcess.on('error', (err) => {
      reject(err);
    });
  });

  console.log('\nSSR build complete!');

  // Step 2: Run SSG rendering
  console.log('\nRunning SSG rendering...');

  // Collect pages and layouts using Node.js fs
  const pagesDir = path.resolve(PROJECT_ROOT, 'src/pages');
  const pages: Record<string, unknown> = {};
  const layouts: Record<string, unknown> = {};

  function collectFiles(dir: string, baseRoute: string = '') {
    if (!fs.existsSync(dir)) return;

    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        const indexPath = path.join(fullPath, 'index.ts');
        const layoutPath = path.join(fullPath, 'layout.ts');
        const routePart = entry.name;

        if (fs.existsSync(indexPath)) {
          const route = `${baseRoute}/${routePart}/index.ts`;
          const key = `/src/pages${route}`;
          pages[key] = { default: null };
        }

        if (fs.existsSync(layoutPath)) {
          const route = `${baseRoute}/${routePart}/layout.ts`;
          const key = `/src/pages${route}`;
          layouts[key] = { default: null };
        }

        collectFiles(fullPath, `${baseRoute}/${routePart}`);
      }
    }
  }

  collectFiles(pagesDir);

  // Check for root layout at src/pages/layout.ts
  const rootLayoutPath = path.join(pagesDir, 'layout.ts');
  if (fs.existsSync(rootLayoutPath)) {
    layouts['/src/pages/layout.ts'] = { default: null };
  }

  // Load actual modules using dynamic import with file:// URL
  const loadedPages: Record<string, unknown> = {};
  for (const key of Object.keys(pages)) {
    // Remove leading slash and /src/pages prefix
    let filePath = key.replace('/src/pages', '').replace(/^\//, '');
    let fullPath: string;

    if (filePath.endsWith('/index.ts')) {
      fullPath = path.join(pagesDir, filePath);
    } else {
      fullPath = path.join(pagesDir, filePath, 'index.ts');
    }

    try {
      const module = await import(`file://${fullPath}`);
      loadedPages[key] = module;
    } catch (e) {
      console.warn(`[build-ssg] Could not load page: ${key} from ${fullPath}: ${e}`);
    }
  }

  const loadedLayouts: Record<string, unknown> = {};
  for (const key of Object.keys(layouts)) {
    // Remove leading slash and /src/pages prefix
    let filePath = key.replace('/src/pages', '').replace(/^\//, '');
    const fullPath = path.join(pagesDir, filePath);
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
          baseUrl
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

  // Copy client assets to SSG static directory for hydration
  const CLIENT_DIR = path.resolve(PROJECT_ROOT, 'dist/client');
  if (fs.existsSync(CLIENT_DIR)) {
    console.log('\nCopying client assets to SSG static directory...');
    copyDirectory(CLIENT_DIR, DIST_DIR);
    console.log('Client assets copied.');
  }

  // Copy sitemap.xml and SSG pages to dist/client so they are served at the root URL
  if (fs.existsSync(CLIENT_DIR)) {
    console.log('\nCopying SSG files to dist/client for serving...');
    const sitemapSrc = path.join(DIST_DIR, 'sitemap.xml');
    if (fs.existsSync(sitemapSrc)) {
      fs.copyFileSync(sitemapSrc, path.join(CLIENT_DIR, 'sitemap.xml'));
      console.log('Copied sitemap.xml to dist/client/');
    }
    const routesJsonSrc = path.join(DIST_DIR, 'routes.json');
    if (fs.existsSync(routesJsonSrc)) {
      fs.copyFileSync(routesJsonSrc, path.join(CLIENT_DIR, 'routes.json'));
      console.log('Copied routes.json to dist/client/');
    }
  }

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

function copyDirectory(src: string, dest: string): void {
  if (!fs.existsSync(src)) return;

  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirectory(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
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
