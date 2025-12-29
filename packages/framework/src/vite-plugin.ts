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
        return `
          const pages = import.meta.glob(['/src/pages/**/index.ts', '/src/pages/**/index.mdx'], { eager: true });
          const layouts = import.meta.glob('/src/pages/**/layout.ts', { eager: true });
          export default { pages, layouts };
        `;
      }
    },
    async transform(code, id) {
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
    }
  };
}