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
      // Ensure we don't bundle dependencies if we had any
      external: [],
    },
  },
  test: {
    environment: 'happy-dom',
  }
});
