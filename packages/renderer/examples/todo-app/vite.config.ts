import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  // Ensure we are serving from the example root
  root: path.resolve(__dirname), 
  resolve: {
    alias: {
      // Create a clean alias for the library
      'cossack-renderer': path.resolve(__dirname, '../../src/index.ts')
    }
  }
});
