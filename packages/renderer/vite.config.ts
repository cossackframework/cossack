import { resolve } from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, 'src/index.ts'),
        server: resolve(__dirname, 'src/server.ts'),
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
        preserveModulesRoot: resolve(__dirname, 'src'),
      },
    },
  },
  test: {
    environment: 'happy-dom',
  }
});
