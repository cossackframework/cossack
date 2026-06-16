import type { Plugin } from 'vite';
import { marked } from 'marked';
import matter from 'gray-matter';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';

const virtualModuleId = 'virtual:cossack-pages';
const resolvedVirtualModuleId = '\0' + virtualModuleId;

/**
 * Public path the SSR runtime uses to fetch the Vite manifest via the
 * Cloudflare ASSETS binding. The Cloudflare Vite plugin generates a
 * `.assetsignore` that excludes the `.vite` directory from the ASSETS
 * binding, so the manifest cannot be served from its default location.
 * The `writeBundle` hook below copies it to this non-ignored path after
 * the client build so `env.ASSETS.fetch` can reach it in production.
 */
export const SSR_MANIFEST_ASSET_PATH = '/cossack-manifest.json';

export function cossackPages(): Plugin {
  return {
    name: 'cossack-pages',
    enforce: 'pre',
    resolveId(id) {
      if (id === virtualModuleId) {
        return resolvedVirtualModuleId;
      }
    },
    load(id) {
      if (id === resolvedVirtualModuleId) {
        // Detect environment via the Vite 6 Environment API
        // SSR/worker environment: eager loading (synchronous access needed for server routes)
        // Client environment: lazy loading (code splitting for performance)
        const isSsrEnvironment = this.environment?.name !== 'client';

        return `
          const pages = import.meta.glob(['/src/pages/**/*.ts', '/src/pages/**/*.mdx', '!/src/pages/**/layout.ts', '!/src/pages/**/loading.ts']${isSsrEnvironment ? ', { eager: true }' : ''});

          // Layouts: always eager (small, shared, needed immediately)
          const layouts = import.meta.glob('/src/pages/**/layout.ts', { eager: true });

          // Loading states: always eager (small, needed immediately for UX)
          const loadings = import.meta.glob('/src/pages/**/loading.ts', { eager: true });

          // Components: always eager (typically small UI components)
          const components = import.meta.glob('/src/components/**/*.ts', { eager: true });

          export default { pages, layouts, loadings, components };
        `;
      }
    },
    async transform(code, id) {
      // Inject source metadata for DevTools (only in dev mode for client environment)
      const isDev = this.environment?.mode === 'dev';
      if (isDev && id.endsWith('.ts') && code.includes('extends Cossack')) {
        const regex = /(export\s+default\s+|export\s+)?class\s+(\w+)\s+extends\s+Cossack\s*(<[^>]+>)?\s*\{/;
        const match = code.match(regex);
        if (match) {
            const insertionIndex = match.index! + match[0].length;
            const sourceInfo = JSON.stringify({ file: id });
            const injection = `\n  static __source = ${sourceInfo};\n`;
            code = code.slice(0, insertionIndex) + injection + code.slice(insertionIndex);
        }
      }

      if (id.endsWith('.mdx') || id.endsWith('.md')) {
        const { data, content } = matter(code);
        const htmlContent = await marked(content);

        // Escape backticks and ${} to avoid breaking the template string
        const escapedHtml = htmlContent.replace(/\`/g, '\\`').replace(/\$\{/g, '\\${');

        return {
          code: `
            import { Cossack } from '@cossackframework/core';
            import { html } from '@cossackframework/renderer';

            class MdxPage extends Cossack {
              head() {
                return {
                  title: ${JSON.stringify(data.title || '')},
                  description: ${JSON.stringify(data.description || '')},
                  image: ${JSON.stringify(data.image || '')}
                };
              }

              render() {
                return html\`<div class="mdx-content">${escapedHtml}</div>\`;
              }
            }

            // Manually define metadata since decorators require extra build steps
            // when generated from a plugin transform hook
            Reflect.defineMetadata('page:options', { transport: 'http' }, MdxPage);

            export default MdxPage;
          `,
          map: null
        };
      }

      return { code, map: null };
    },
    writeBundle() {
      // After the CLIENT environment build, the Vite manifest exists at
      // dist/client/.vite/manifest.json. The Cloudflare plugin's generated
      // `.assetsignore` excludes the `.vite` directory from the ASSETS
      // binding, so copy the manifest to a non-ignored path the SSR runtime
      // can fetch via env.ASSETS.fetch(SSR_MANIFEST_ASSET_PATH).
      //
      // This hook fires once per environment build; only act on the client
      // environment where the manifest has just been emitted.
      if (this.environment?.name !== 'client') return;

      const clientOutDir = resolve(process.cwd(), 'dist', 'client');
      const src = resolve(clientOutDir, '.vite', 'manifest.json');
      if (!existsSync(src)) return;

      try {
        const data = readFileSync(src, 'utf-8');
        const destDir = clientOutDir;
        if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
        const dest = resolve(destDir, 'cossack-manifest.json');
        writeFileSync(dest, data);
      } catch {
        // Non-fatal: SSR will fall back to empty manifest.
      }
    }
  };
}