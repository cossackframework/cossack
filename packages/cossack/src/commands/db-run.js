/**
 * Resolve ORM tooling from the application, never from the globally installed
 * Cossack CLI. This keeps provider drivers and the exact ORM version owned by
 * the generated project.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { findProjectRoot } from '../fs-utils.js';
import { commandFailure, diagnosticMessage, writeResult } from '../output.js';

export async function loadORMTooling(root) {
  const requireFromProject = createRequire(path.join(root, 'package.json'));
  const projectPackage = JSON.parse(
    await fs.readFile(path.join(root, 'package.json'), 'utf8'),
  );
  const declared = projectPackage.dependencies?.['@cossackframework/database'] ??
    projectPackage.devDependencies?.['@cossackframework/database'] ??
    projectPackage.optionalDependencies?.['@cossackframework/database'];
  if (!declared) {
    throw new Error(
      '@cossackframework/database is not installed in this project. Run `cossack add database` ' +
      '(or `pnpm install`) first.',
    );
  }
  let packageJson;
  try {
    packageJson = requireFromProject.resolve('@cossackframework/database/package.json');
  } catch {
    throw new Error(
      '@cossackframework/database is not installed in this project. Run `cossack add database` ' +
      '(or `pnpm install`) first.',
    );
  }
  const entry = path.join(path.dirname(packageJson), 'dist', 'tooling', 'index.js');
  const tooling = await import(pathToFileURL(entry).href);
  if (typeof tooling.runORMCommand !== 'function') {
    throw new Error(
      'The installed @cossackframework/database does not export tooling support. ' +
      'Upgrade it to version 0.9.0 or newer.',
    );
  }
  return tooling;
}

function flagArgv(flags = {}) {
  const argv = [];
  for (const [name, value] of Object.entries(flags)) {
    if (name === 'f' && flags.force !== undefined) continue;
    if (value === undefined) continue;
    const values = Array.isArray(value) ? value : [value];
    for (const item of values) argv.push(item === true ? `--${name}` : `--${name}=${item}`);
  }
  return argv;
}

export async function runORMToolingCommand(argv, ctx) {
  const command = argv[0] === 'seed' ? 'seeder' : argv[0] ?? 'orm';
  try {
    const root = await findProjectRoot(ctx.cwd);
    const { runORMCommand } = await loadORMTooling(root);
    const results = [];
    const json = ctx.flags?.json === true;
    const exitCode = await runORMCommand([...argv, ...flagArgv(ctx.flags)], {
      cwd: root,
      stdout: message => {
        if (!json) { console.log(message); return; }
        try {
          const result = JSON.parse(message);
          if (result?.schemaVersion === 1 && result.command === argv[0] &&
              typeof result.ok === 'boolean' && Array.isArray(result.diagnostics) &&
              result.diagnostics.every(d => typeof d?.code === 'string' &&
                ['error', 'warning', 'info'].includes(d.severity) && typeof d.message === 'string')) results.push(result);
        } catch { /* Arbitrary project output is not a result. */ }
      },
      stderr: message => { if (!json) console.error(message); },
    });
    if (!json) return exitCode;
    const result = results[0];
    if (results.length !== 1 || ![0, 1].includes(exitCode) || result.ok !== (exitCode === 0)) {
      return commandFailure(ctx, command, 'COSSACK_ORM_RESULT_INVALID',
        'Database tooling returned no valid result. Check the installed ORM version; run without --json for diagnostics.');
    }
    writeResult(command, { ok: result.ok,
      data: { action: result.action ?? argv[1] ?? null, ...(result.data ?? {}) }, diagnostics: result.diagnostics });
    return exitCode;
  } catch (error) {
    return commandFailure(ctx, command, 'COSSACK_ORM_UNAVAILABLE',
      ctx.flags?.json === true ? diagnosticMessage(error, 'COSSACK_ORM_UNAVAILABLE') : error.message);
  }
}
