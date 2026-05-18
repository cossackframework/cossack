import type { Plugin } from 'vite';
import { marked } from 'marked';
import matter from 'gray-matter';

const virtualModuleId = 'virtual:cossack-pages';
const resolvedVirtualModuleId = '\0' + virtualModuleId;

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

      if (id.endsWith('.mdx')) {
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
    }
  };
}