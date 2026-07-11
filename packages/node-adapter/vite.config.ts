import { defineConfig } from 'vite'
import path from 'path'

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  build: {
    lib: {
      entry: path.resolve(__dirname, 'src/index.ts'),
      name: '@cossackframework/node-adapter',
      fileName: 'index',
      formats: ['es'],
    },
    outDir: 'dist',
    rolldownOptions: {
        external: ['ws', 'http', 'url', 'fs', 'path', 'os', 'nodemailer', '@cossackframework/core']
    }
  },
});
