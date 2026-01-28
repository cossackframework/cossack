import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  root: __dirname,
  resolve: {
    alias: {
      'cossack-renderer': path.resolve(__dirname, '../../src/index.ts')
    }
  }
});
