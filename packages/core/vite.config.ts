import { defineConfig } from 'vite'
import path from 'path'

const sourceRoot = path.resolve(__dirname, 'src');

// https://vite.dev/config/
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  build: {
    sourcemap: true,
    lib: {
      entry: {
        index: path.resolve(__dirname, 'src/index.ts'),
        // `User` is intentionally type-only, but Deno resolves the `.js`
        // specifier in emitted declarations before loading `user.d.ts`.
        // Keep an empty runtime module beside the declaration for strict ESM
        // consumers such as `deno check`.
        'shared/user': path.resolve(__dirname, 'src/shared/user.ts'),
      },
      name: '@cossackframework/core',
      formats: ['es'],
    },
    outDir: 'dist',
    rolldownOptions: {
      external: [
        '@cossackframework/renderer',
        /^hono(?:\/|$)/,
        'reflect-metadata',
      ],
      output: {
        // Preserve public source-module boundaries so applications only retain
        // the core capabilities they actually import.
        preserveModules: true,
        preserveModulesRoot: sourceRoot,
        banner: (chunk) => chunk.facadeModuleId?.startsWith(sourceRoot)
          ? `// @ts-self-types="./${path.posix.basename(chunk.fileName, '.js')}.d.ts"`
          : '',
      },
    },
  },
});
