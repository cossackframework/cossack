import type { Plugin } from 'vite';

const virtualModuleId = 'virtual:cossack-pages';
const resolvedVirtualModuleId = '\0' + virtualModuleId;

export function cossackPages(): Plugin {
  return {
    name: 'cossack-pages',
    resolveId(id) {
      if (id === virtualModuleId) {
        return resolvedVirtualModuleId;
      }
    },
    load(id) {
      if (id === resolvedVirtualModuleId) {
        return `
          const pages = import.meta.glob('/src/pages/**/index.ts', { eager: true });
          const layouts = import.meta.glob('/src/pages/**/layout.ts', { eager: true });
          export default { pages, layouts };
        `;
      }
    },
  };
}