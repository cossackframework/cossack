import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, 'src/index.ts'),
      },
      formats: ['es'],
    },
    rolldownOptions: {
      external: [
        '@cossackframework/core',
        '@cossackframework/renderer',
        /^@cossackframework\/solar-icons(?:\/|$)/,
      ],
      output: {
        // UI components contain class-decorator initialization. Keeping every
        // component in one output module prevents downstream tree-shaking;
        // preserve the source boundaries so unused component modules vanish.
        preserveModules: true,
        preserveModulesRoot: resolve(__dirname, 'src'),
      },
    },
  },
});
