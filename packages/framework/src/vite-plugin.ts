import type { Plugin } from 'vite';
import { marked } from 'marked';
import matter from 'gray-matter';

const virtualModuleId = 'virtual:cossack-pages';
const resolvedVirtualModuleId = '\0' + virtualModuleId;

export interface CossackPagesOptions {
  mode?: string;
}

export function cossackPages(options: CossackPagesOptions = {}): Plugin {
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
        return `
          const pages = import.meta.glob(['/src/pages/**/index.ts', '/src/pages/**/index.mdx', '/src/pages/api/**/*.ts'], { eager: true });
          const layouts = import.meta.glob('/src/pages/**/layout.ts', { eager: true });
          const loadings = import.meta.glob('/src/pages/**/loading.ts', { eager: true });
          const components = import.meta.glob('/src/components/**/*.ts', { eager: true });
          export default { pages, layouts, loadings, components };
        `;
      }
    },
    async transform(code, id) {
      const isDev = options.mode === 'development' || process.env.NODE_ENV === 'development';

      // Inject source metadata for DevTools
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