/**
 * Resolve ORM tooling from the application, never from the globally installed
 * Cossack CLI. This keeps provider drivers and the exact ORM version owned by
 * the generated project.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { findProjectRoot } from '../fs-utils.js';

export async function loadORMTooling(root) {
  const requireFromProject = createRequire(path.join(root, 'package.json'));
  let packageJson;
  try {
    packageJson = requireFromProject.resolve('@cossackframework/orm/package.json');
  } catch {
    throw new Error(
      '@cossackframework/orm is not installed in this project. Run `cossack add orm` ' +
      '(or `pnpm install`) first.',
    );
  }
  const entry = path.join(path.dirname(packageJson), 'dist', 'tooling', 'index.js');
  const tooling = await import(pathToFileURL(entry).href);
  if (typeof tooling.runORMCommand !== 'function') {
    throw new Error(
      'The installed @cossackframework/orm does not export tooling support. ' +
      'Upgrade it to version 1.1.0 or newer.',
    );
  }
  return tooling;
}

function flagArgv(flags = {}) {
  const argv = [];
  for (const [name, value] of Object.entries(flags)) {
    if (value === false || value === undefined) continue;
    argv.push(value === true ? `--${name}` : `--${name}=${value}`);
  }
  return argv;
}

export async function runORMToolingCommand(argv, ctx) {
  const root = await findProjectRoot(ctx.cwd);
  const { runORMCommand } = await loadORMTooling(root);
  return runORMCommand([...argv, ...flagArgv(ctx.flags)], {
    cwd: root,
    stdout: (message) => console.log(message),
    stderr: (message) => console.error(message),
  });
}
