import { defineConfig } from 'vite';
import { cossackCompiler } from '@cossackframework/renderer/plugin';

export default defineConfig({
  plugins: [
    cossackCompiler()
  ],
});
