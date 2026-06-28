import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { collectSsgRoutes, getStaticParams, renderSsgPage, type HtmlTemplate } from './ssg-renderer';
import { generateSitemapFromUrls } from './sitemap-generator';
import { getSiteUrl } from './ssg-config';
import type { RoutesManifest } from './route-ids';

/** Native dynamic import (the tsx loader registered by the CLI resolves `.ts`). */
const importModule = (absPath: string) => import(pathToFileURL(absPath).href);

export interface BuildSsgOptions {
  /** Project root (defaults to `process.cwd()`). */
  projectRoot?: string;
  /** Output directory (defaults to `<root>/dist/client`). */
  outDir?: string;
  /** Base URL for sitemap/canonical (defaults to `getSiteUrl()`). */
  baseUrl?: string;
  /** Path to the app entry exporting `App` (defaults to `<root>/src/App.ts`). */
  appPath?: string;
  /** Path to the module exporting `template` (defaults to `<root>/src/root.ts`). */
  templatePath?: string;
}

/**
 * Run the SSG build using the authoritative `cossack-routes.json` manifest
 * emitted by the Vite plugin, and the project's own `App` + html template
 * (the same values passed to `createApp()`). Replaces the per-project
 * `scripts/build-ssg.ts` copy.
 *
 * Must be run AFTER `vite build` (which writes the manifest + client assets).
 */
export async function buildSsg(options: BuildSsgOptions = {}): Promise<void> {
  const projectRoot = path.resolve(options.projectRoot || process.cwd());
  const outDir = path.resolve(projectRoot, options.outDir || 'dist/client');
  const baseUrl = options.baseUrl || getSiteUrl({ projectRoot });

  console.log('Starting SSG rendering...');
  console.log(`Using base URL: ${baseUrl}`);

  // --- Read the routes manifest (single source of truth for cmp_N IDs) ---
  const manifestPath = path.join(outDir, 'cossack-routes.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(
      `[cossack/ssg] Routes manifest not found at ${manifestPath}. Run "vite build" first so the cossack Vite plugin can emit it.`,
    );
  }
  const manifest: RoutesManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

  // --- Load the project's App + html template (same wiring as createApp) ---
  const AppComponent = await loadAppComponent(options.appPath, projectRoot);
  const htmlTemplate = await loadHtmlTemplate(options.templatePath, projectRoot);

  // --- Load page + layout modules from the manifest keys ---
  const pagesDir = path.resolve(projectRoot, 'src', 'pages');
  const loadedPages: Record<string, unknown> = {};
  for (const key of manifest.pageKeys) {
    if (!key.endsWith('.ts')) continue; // .mdx needs the Vite transform; not SSG-eligible
    const relFile = key.replace('/src/pages/', '').replace(/^\//, '');
    const fullPath = path.join(pagesDir, relFile);
    try {
      loadedPages[key] = await importModule(fullPath);
    } catch (e) {
      console.warn(`[cossack/ssg] Could not load page: ${key} from ${fullPath}: ${e}`);
    }
  }

  const loadedLayouts: Record<string, unknown> = {};
  for (const key of manifest.layoutKeys) {
    const relFile = key.replace('/src/pages/', '').replace(/^\//, '');
    const fullPath = path.join(pagesDir, relFile);
    try {
      loadedLayouts[key] = await importModule(fullPath);
    } catch (e) {
      console.warn(`[cossack/ssg] Could not load layout: ${key} from ${fullPath}: ${e}`);
    }
  }

  // --- Collect SSG routes ---
  const ssgRoutes = collectSsgRoutes(loadedPages, loadedLayouts as Record<string, { default: new () => any }>);
  console.log(`Found ${ssgRoutes.length} SSG routes`);

  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  // --- Render each route ---
  const renderedRoutes: string[] = [];
  for (const route of ssgRoutes) {
    console.log(`Rendering: ${route.routePath}`);
    try {
      const staticParamsList = await getStaticParams(route.pageOptions!);
      for (const staticParams of staticParamsList) {
        let routePath = route.routePath;
        if (staticParams && Object.keys(staticParams).length > 0) {
          for (const [key, value] of Object.entries(staticParams)) {
            routePath = routePath.replace(`:${key}`, value);
            routePath = routePath.replace(`[${key}]`, value);
          }
        }

        const html = await renderSsgPage(
          route.component,
          routePath,
          staticParams,
          loadedLayouts as Record<string, { default: new () => any }>,
          baseUrl,
          AppComponent,
          htmlTemplate,
          route.filePath,
          manifest.filePathToId[route.filePath],
        );

        const outputFilePath = getOutputFilePath(routePath, outDir);
        const outputDir = path.dirname(outputFilePath);
        if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
        fs.writeFileSync(outputFilePath, html, 'utf-8');
        console.log(`Written: ${outputFilePath}`);
        renderedRoutes.push(routePath);
      }
    } catch (error) {
      console.error(`Error rendering ${route.routePath}:`, error);
    }
  }

  // --- Sitemap + routes.json ---
  console.log('\nGenerating sitemap...');
  const sitemap = generateSitemapFromUrls(renderedRoutes, { baseUrl, lastmod: new Date() });
  fs.writeFileSync(path.join(outDir, 'sitemap.xml'), sitemap, 'utf-8');
  console.log(`Written sitemap: ${path.join(outDir, 'sitemap.xml')}`);

  fs.writeFileSync(path.join(outDir, 'routes.json'), JSON.stringify(renderedRoutes, null, 2), 'utf-8');

  console.log('\nGenerated SSG files:');
  listFiles(outDir, '');
  console.log('\nSSG build complete!');
}

async function loadAppComponent(
  appPath: string | undefined,
  projectRoot: string,
): Promise<{ new (): any } | undefined> {
  const resolved = path.resolve(projectRoot, appPath || 'src/App.ts');
  if (!fs.existsSync(resolved)) {
    console.warn(`[cossack/ssg] App not found at ${resolved}; using framework default.`);
    return undefined;
  }
  try {
    const mod: any = await importModule(resolved);
    return mod.App || mod.default;
  } catch (e) {
    console.warn(`[cossack/ssg] Could not load App from ${resolved}: ${e}`);
    return undefined;
  }
}

async function loadHtmlTemplate(
  templatePath: string | undefined,
  projectRoot: string,
): Promise<HtmlTemplate | undefined> {
  const resolved = path.resolve(projectRoot, templatePath || 'src/root.ts');
  if (!fs.existsSync(resolved)) return undefined;
  try {
    const mod: any = await importModule(resolved);
    const template = mod.template ?? mod.default;
    if (typeof template === 'string' || typeof template === 'function') return template as HtmlTemplate;
    return undefined;
  } catch (e) {
    console.warn(`[cossack/ssg] Could not load html template from ${resolved}: ${e}`);
    return undefined;
  }
}

function getOutputFilePath(routePath: string, outputDir: string): string {
  let normalizedPath = routePath;
  if (!normalizedPath.startsWith('/')) normalizedPath = '/' + normalizedPath;
  if (normalizedPath !== '/' && normalizedPath.endsWith('/')) normalizedPath = normalizedPath.slice(0, -1);
  if (normalizedPath === '/' || normalizedPath === '') return path.join(outputDir, 'index.html');

  const segments = normalizedPath.split('/').filter(Boolean);
  return path.join(outputDir, ...segments, 'index.html');
}

function listFiles(dir: string, prefix: string): void {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      console.log(`${prefix}${entry.name}/`);
      listFiles(entryPath, prefix + '  ');
    } else {
      const size = fs.statSync(entryPath).size;
      console.log(`${prefix}${entry.name} (${formatSize(size)})`);
    }
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}
