/**
 * Node-only checks for the reserved `/assets/` namespace. Cloudflare serves
 * `/assets/*` without running the Worker and the generated Node server serves
 * it before the framework, so nothing there passes page or global policies.
 * Builds and deploy preflight share these checks. They read the filesystem and
 * the client manifest only; they never import application modules.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { ASSETS_RUN_WORKER_FIRST, STATIC_ASSET_DIRECTORY, isStaticAssetFile } from '@cossackframework/core/static-assets';
import { scanPagesDir } from './route-codegen.js';
import { classifyRoute, filePathToHttpRoute } from './route-ids.js';

export interface StaticAssetNamespaceDiagnostic {
  code: 'COSSACK_ASSETS_NAMESPACE_RESERVED';
  message: string;
  /** Absolute path of the reserved directory or route source. */
  file: string;
}

export interface StaticAssetRouteFact {
  pattern: string;
  /** Root-relative source key, for example `/src/pages/assets/index.ts`. */
  filePath: string;
  addressable?: boolean;
}

export interface StaticAssetNamespaceOptions {
  /** Vite's resolved `publicDir`; `false` or `''` when disabled. Defaults to `<root>/public`. */
  publicDir?: string | false;
  /** Routes already discovered by the caller. Otherwise `src/pages` is scanned. */
  routes?: readonly StaticAssetRouteFact[];
  /** Treat Markdown pages as routes when scanning. Defaults to true. */
  includeMarkdown?: boolean;
}

const namespace = `/${STATIC_ASSET_DIRECTORY}`;

/** Addressable facts for the routes under `src/pages`, for checks that run without a manifest. */
export function discoverRouteFacts(root: string, includeMarkdown: boolean): StaticAssetRouteFact[] {
  return scanPagesDir(path.join(root, 'src/pages'), includeMarkdown).pageKeys.flatMap(filePath => {
    // Unsupported patterns fail route generation with their own diagnostic.
    try {
      const pattern = filePathToHttpRoute(filePath);
      const kind = classifyRoute(pattern);
      return [{ filePath, pattern, addressable: kind !== '404' && kind !== 'error' }];
    } catch { return []; }
  });
}

/** Report `public/assets/` and routes that resolve under `/assets`. */
export function checkStaticAssetNamespace(root: string, options: StaticAssetNamespaceOptions = {}): StaticAssetNamespaceDiagnostic[] {
  const diagnostics: StaticAssetNamespaceDiagnostic[] = [];
  const publicDir = options.publicDir === undefined ? path.join(root, 'public') : options.publicDir;
  if (publicDir) {
    const reserved = path.join(path.resolve(root, publicDir), STATIC_ASSET_DIRECTORY);
    if (existsSync(reserved)) {
      const shown = path.relative(root, reserved).replaceAll('\\', '/') || reserved;
      diagnostics.push({ code: 'COSSACK_ASSETS_NAMESPACE_RESERVED', file: reserved,
        message: `${shown}/ uses the ${namespace}/ namespace, which is reserved for hashed build output. ` +
          `Cloudflare serves ${namespace}/* without running the Worker, and the generated Node server serves it before the framework, ` +
          'so page and global policies cannot protect these files. Move them to another public directory.' });
    }
  }
  for (const route of options.routes ?? discoverRouteFacts(root, options.includeMarkdown ?? true)) {
    if (route.addressable === false) continue;
    if (route.pattern !== namespace && !route.pattern.startsWith(`${namespace}/`)) continue;
    diagnostics.push({ code: 'COSSACK_ASSETS_NAMESPACE_RESERVED', file: path.join(root, route.filePath.replace(/^\/+/, '')),
      message: `${route.filePath.replace(/^\/+/, '')} resolves to ${route.pattern}, inside the ${namespace}/ namespace reserved for hashed build output. ` +
        `Cloudflare serves ${namespace}/* without running the Worker, so routes there do not run and their policies do not apply. Rename the route.` });
  }
  return diagnostics;
}

interface ManifestChunk { file?: unknown; css?: unknown; assets?: unknown }

/** Files listed in a Vite client manifest that are outside `assets/`. */
export function uncoveredClientOutput(manifest: unknown): string[] {
  const files = new Set<string>();
  if (!manifest || typeof manifest !== 'object') return [];
  for (const chunk of Object.values(manifest as Record<string, ManifestChunk>)) {
    if (!chunk || typeof chunk !== 'object') continue;
    const listed = [chunk.file, ...(Array.isArray(chunk.css) ? chunk.css : []), ...(Array.isArray(chunk.assets) ? chunk.assets : [])];
    for (const file of listed) if (typeof file === 'string' && !isStaticAssetFile(file)) files.add(file);
  }
  return [...files].sort();
}

/** Explain why client output outside `assets/` loses the direct-serving path. */
export function describeUncoveredClientOutput(files: readonly string[]): string {
  const shown = files.slice(0, 5).join(', ') + (files.length > 5 ? `, and ${files.length - 5} more` : '');
  return `The client build wrote ${shown} outside ${STATIC_ASSET_DIRECTORY}/. ` +
    `The run_worker_first pattern ${JSON.stringify(ASSETS_RUN_WORKER_FIRST)} and the generated Node server serve only ${namespace}/* ` +
    'without the request pipeline, so these files run global middleware on every request. ' +
    `Keep entryFileNames, chunkFileNames and assetFileNames under ${STATIC_ASSET_DIRECTORY}/, or set assets.run_worker_first to true.`;
}
