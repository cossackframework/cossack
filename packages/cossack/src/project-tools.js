import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import { run, runCaptured } from './spawn.js';

/** Run the project's installed tool, including when the CLI was installed globally. */
async function invokeProjectTool(root, name, args, options, execute) {
  const require = createRequire(path.join(root, 'package.json'));
  const manifestPath = require.resolve(`${name}/package.json`);
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.[name];
  if (!bin) throw new Error(`The installed ${name} package has no ${name} executable.`);
  return execute(process.execPath, [path.resolve(path.dirname(manifestPath), bin), ...args], {
    ...options, cwd: root, shell: false,
  });
}

export function runProjectTool(root, name, args, options = {}) {
  return invokeProjectTool(root, name, args, options, run);
}
export function runProjectToolCaptured(root, name, args, options = {}) {
  return invokeProjectTool(root, name, args, options, runCaptured);
}
