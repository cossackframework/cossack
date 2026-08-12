import { resolve } from 'path';
import path from 'path';
import { defineConfig } from 'vite';

const sourceRoot = resolve(import.meta.dirname, 'src');

export default defineConfig({
  build: {
    lib: {
      entry: {
        index: resolve(import.meta.dirname, 'src/index.ts'),
        server: resolve(import.meta.dirname, 'src/server.ts'),
      },
      formats: ['es'],
    },
    rolldownOptions: {
      // Let application bundlers consume the focused css-tree entry points
      // directly instead of copying its internal node_modules layout into the
      // published renderer package.
      external: [
        'css-tree/parser',
        'css-tree/generator',
        'css-tree/walker',
      ],
      output: {
        // Keep source modules separate in the published package. Downstream
        // application builds can then tree-shake unused renderer exports
        // instead of receiving one opaque pre-bundled module.
        preserveModules: true,
        preserveModulesRoot: sourceRoot,
        banner: (chunk) => chunk.facadeModuleId?.startsWith(sourceRoot)
          ? `// @ts-self-types="./${path.posix.basename(chunk.fileName, '.js')}.d.ts"`
          : '',
      },
    },
  },
  test: {
    environment: 'happy-dom',
  }
});
