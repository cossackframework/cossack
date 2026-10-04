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
        external: [/^node:/, 'vite', '@hono/node-server', 'ws', 'http', 'url', 'fs', 'path', 'os', 'nodemailer', '@cossackframework/core']
    }
  },
});
