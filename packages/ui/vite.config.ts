import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, 'src/index.ts'),
        'blocks/index': resolve(__dirname, 'src/blocks/index.ts'),
      },
      formats: ['es'],
    },
    rolldownOptions: {
      external: [
        '@cossackframework/core',
        '@cossackframework/renderer',
        /^@cossackframework\/solar-icons(?:\/|$)/,
        // CodeMirror stays a dependency: one copy per application, loaded only by the CodeEditor.
        'codemirror',
        /^@codemirror\//,
        /^@lezer\//,
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
