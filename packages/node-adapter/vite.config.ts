import { defineConfig } from 'vite'
import path from 'path'

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  build: {
    lib: {
      entry: { index: path.resolve(__dirname, 'src/index.ts'), vite: path.resolve(__dirname, 'src/vite.ts') },
      name: '@cossackframework/node-adapter',
      fileName: (_format, entryName) => `${entryName}.js`,
      formats: ['es'],
    },
    outDir: 'dist',
    rolldownOptions: {
        external: ['vite', '@hono/node-server', 'node:http', 'ws', 'http', 'url', 'fs', 'path', 'os', 'nodemailer', '@cossackframework/core']
    }
  },
});
