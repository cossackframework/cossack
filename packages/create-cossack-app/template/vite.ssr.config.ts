import { defineConfig } from 'vite';
import path from 'path';
import tailwindcss from '@tailwindcss/vite';
import { cossackPages } from '@cossackframework/framework/vite-plugin';

export default defineConfig(({ mode }) => {
  return {
    mode,
    plugins: [
      tailwindcss(),
      cossackPages({ mode }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        '~': path.resolve(__dirname, './dist/client'),
      },
    },
    ssr: {
      noExternal: ['@cossackframework/framework'],
    },
    build: {
      ssr: true,
      outDir: 'dist/worker',
      target: 'esnext',
      rollupOptions: {
        input: 'src/index.ts',
        output: {
          entryFileNames: 'index.js',
          format: 'esm',
        },
      },
    },
  };
});
