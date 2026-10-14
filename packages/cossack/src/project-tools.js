import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import { run, runCaptured } from './spawn.js';

/**
 * Resolve the project's installed tool to `process.execPath` plus its JS entry,
 * so it runs without PATH lookup or a shell, including when the CLI itself was
 * installed globally.
 */
export async function resolveProjectTool(root, name) {
  const require = createRequire(path.join(root, 'package.json'));
  let manifestPath;
  try {
    manifestPath = require.resolve(`${name}/package.json`);
  } catch {
    throw Object.assign(new Error(`Cannot find the project's ${name} package. Install the project dependencies first.`),
      { code: 'COSSACK_PROJECT_TOOL_MISSING' });
  }
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.[name];
  if (!bin) throw Object.assign(new Error(`The installed ${name} package has no ${name} executable.`),
    { code: 'COSSACK_PROJECT_TOOL_MISSING' });
  return { command: process.execPath, args: [path.resolve(path.dirname(manifestPath), bin)] };
}

/** Run the project's installed tool, including when the CLI was installed globally. */
async function invokeProjectTool(root, name, args, options, execute) {
  const tool = await resolveProjectTool(root, name);
  return execute(tool.command, [...tool.args, ...args], { ...options, cwd: root });
}

export function runProjectTool(root, name, args, options = {}) {
  return invokeProjectTool(root, name, args, options, run);
}
export function runProjectToolCaptured(root, name, args, options = {}) {
  return invokeProjectTool(root, name, args, options, runCaptured);
}
