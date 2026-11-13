import { defineConfig } from 'vite'
import path from 'path'

const sourceRoot = path.resolve(__dirname, 'src');

// https://vite.dev/config/
export default defineConfig({
  // The consuming application's Vite mode selects diagnostics. A library build
  // must not erase development checks before the app can select its mode.
  define: { 'import.meta.env.DEV': 'import.meta.env?.DEV' },
  plugins: [{
    name: 'cossack-environment-boundary',
    enforce: 'pre',
    resolveId(id, importer) {
      if (!importer || !id.startsWith('.')) return;
      const target = path.resolve(path.dirname(importer), id).replace(/\.(?:js|ts)$/, '');
      if (target === path.join(sourceRoot, 'shared/environment')) {
        // Keep runtime selection deferred to the consuming app's conditions.
        // Source imports stay relative so unit tests can mock the environment.
        return { id: '#cossack-environment', external: true };
      }
    },
  }],
  resolve: {
    tsconfigPaths: true,
  },
  build: {
    sourcemap: true,
    lib: {
      entry: {
        index: path.resolve(__dirname, 'src/index.ts'),
        'storage/index': path.resolve(__dirname, 'src/storage/index.ts'),
        'workflows/index': path.resolve(__dirname, 'src/workflows/index.ts'),
        'jobs/index': path.resolve(__dirname, 'src/jobs/index.ts'),
        'schedules/index': path.resolve(__dirname, 'src/schedules/index.ts'),
        'notifications/index': path.resolve(__dirname, 'src/notifications/index.ts'),
        'hooks/index': path.resolve(__dirname, 'src/hooks/index.ts'),
        input: path.resolve(__dirname, 'src/input.ts'),
        'app-model': path.resolve(__dirname, 'src/app-model.ts'),
        devtools: path.resolve(__dirname, 'src/devtools.ts'),
        'shared/server-diagnostics': path.resolve(__dirname, 'src/shared/server-diagnostics.ts'),
        'shared/static-assets': path.resolve(__dirname, 'src/shared/static-assets.ts'),
        'shared/transport-routes': path.resolve(__dirname, 'src/shared/transport-routes.ts'),
        'shared/environment': path.resolve(__dirname, 'src/shared/environment.ts'),
        'shared/browser-environment': path.resolve(__dirname, 'src/shared/browser-environment.ts'),
        // These contracts are type-only. Keep an empty runtime module beside
        // the declaration so strict ESM consumers can resolve the `.js`
        // specifier used in emitted declarations.
        'shared/user': path.resolve(__dirname, 'src/shared/user.ts'),
        'shared/runtime-adapter': path.resolve(__dirname, 'src/shared/runtime-adapter.ts'),
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
