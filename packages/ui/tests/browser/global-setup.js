// Runs once per `test:browser` run: one Tailwind build shared by every browser
// test file (consumed through helpers.js). Each file launches its own Chromium:
// a shared, remotely connected browser made keyboard/focus tests flaky.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { standardStyle, toolRequire } from './helpers.js';

export default async function setup(project) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-ui-browser-'));
  await compileStandardStyle(root);
  project.provide('tailwindCssFile', path.join(root, 'tailwind.css'));
  return async () => {
    await fs.rm(root, { recursive: true, force: true });
  };
}

async function compileStandardStyle(root) {
  const { build } = await import(toolRequire.resolve('vite'));
  const { default: tailwind } = await import(toolRequire.resolve('@tailwindcss/vite'));
  const app = path.join(root, 'app');
  await fs.mkdir(app);
  await fs.writeFile(path.join(app, 'style.css'), standardStyle());
  await fs.writeFile(path.join(app, 'main.js'), `import './style.css';`);
  await fs.writeFile(path.join(app, 'index.html'), '<html><body><script type="module" src="/main.js"></script></body></html>');
  const built = await build({
    root: app, configFile: false, logLevel: 'silent', plugins: [tailwind()],
    build: { outDir: 'dist', emptyOutDir: true, write: false, minify: false, cssMinify: false },
  });
  const output = (Array.isArray(built) ? built : [built]).flatMap(result => result.output);
  const css = output.find(file => file.type === 'asset' && file.fileName.endsWith('.css'));
  if (!css) throw new Error('Failed to compile the shared Tailwind stylesheet for browser tests.');
  await fs.writeFile(path.join(root, 'tailwind.css'), css.source);
}
