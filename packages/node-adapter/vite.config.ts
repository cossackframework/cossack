import { defineConfig } from 'vite'
import path from 'path'

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  build: {
    lib: {
      entry: { storage: path.resolve(__dirname, 'src/storage.ts'), index: path.resolve(__dirname, 'src/index.ts'), vite: path.resolve(__dirname, 'src/vite.ts'), notifications: path.resolve(__dirname, 'src/notifications.ts') },
      name: '@cossackframework/node-adapter',
      fileName: (_format, entryName) => `${entryName}.js`,
      formats: ['es'],
    },
    outDir: 'dist',
    rolldownOptions: {
        external: [/^node:/, 'vite', 'hono', '@hono/node-server', 'ws', 'http', 'url', 'fs', 'path', 'os', 'nodemailer', '@cossackframework/core', '@cossackframework/core/notifications', '@cossackframework/core/storage']
    }
  },
});
