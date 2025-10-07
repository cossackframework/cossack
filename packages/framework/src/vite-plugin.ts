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
        const globPath = '/src/pages/**/*.ts';
        
        return `
          const pages = import.meta.glob('${globPath}', { eager: true });
          export default pages;
        `;
      }
    },
  };
}