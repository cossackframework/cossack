import { commandSpecs } from '../command-specs.js';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fork } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { findProjectRoot } from '../fs-utils.js';
import { flagString } from '../flags.js';
import { runWithSpec } from '../command-spec.js';
import { writeResult } from '../output.js';

const spec = commandSpecs.studio;

export async function studioCommand(args, ctx) {
  return runWithSpec(spec, args, ctx, async () => {
    const root = await findProjectRoot(ctx.cwd);
    const requireFromProject = createRequire(path.join(root, 'package.json'));
    const rawPort = flagString(ctx.flags.port);
    const port = rawPort === undefined ? undefined : Number(rawPort);
    if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) {
      throw Object.assign(new Error('--port must be an integer between 1 and 65535.'),
        { code: 'COSSACK_STUDIO_PORT_INVALID' });
    }
    let projectPackage;
    try {
      projectPackage = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
    } catch {
      throw Object.assign(new Error('Cannot read project package.json. Check that it contains valid JSON.'),
        { code: 'COSSACK_PROJECT_INVALID' });
    }
    const installed = projectPackage.dependencies?.['@cossackframework/studio'] ??
      projectPackage.devDependencies?.['@cossackframework/studio'];
    if (!installed) {
      throw Object.assign(new Error(
        '@cossackframework/studio is not installed in this project. ' +
        'Run `cossack add studio` followed by `pnpm install`.',
      ), { code: 'COSSACK_STUDIO_NOT_INSTALLED' });
    }
    let packageJson;
    try {
      packageJson = requireFromProject.resolve('@cossackframework/studio/package.json');
    } catch {
      throw Object.assign(new Error(
        '@cossackframework/studio is not installed in this project. ' +
        'Run `cossack add studio` followed by `pnpm install`.',
      ), { code: 'COSSACK_STUDIO_NOT_INSTALLED' });
    }
    const entry = path.join(path.dirname(packageJson), 'dist', 'index.js');
    const options = {
      projectRoot: root, remote: ctx.flags.remote === true,
      database: flagString(ctx.flags.database), provider: flagString(ctx.flags.driver),
      env: flagString(ctx.flags.env), port, open: ctx.flags['no-open'] !== true,
    };
    if (ctx.dryRun) return { event: 'planned', ...options, open: false };
    if (ctx.flags.json === true) {
      const timeout = Number(flagString(ctx.flags.timeout) ?? 30_000);
      if (!Number.isInteger(timeout) || timeout < 1 || timeout > 300_000) throw Object.assign(
        new Error('--timeout must be an integer between 1 and 300000 milliseconds.'),
        { code: 'COSSACK_STUDIO_TIMEOUT_INVALID' });
      return runMachineStudio(entry, options, timeout);
    }
    const module = await import(pathToFileURL(entry).href);
    if (typeof module.runStudio !== 'function') {
      throw Object.assign(new Error('@cossackframework/studio does not export runStudio().'),
        { code: 'COSSACK_STUDIO_EXPORT_MISSING' });
    }
    await module.runStudio(options);
    return 0;
  }, studioHelp);
}

function runMachineStudio(entry, options, timeout) {
  return new Promise(resolve => {
    const child = fork(fileURLToPath(new URL('../studio-runner.js', import.meta.url)),
      [JSON.stringify({ entry, options })], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    let ready = false;
    let timedOut = false;
    const forwardInterrupt = () => child.kill('SIGTERM');
    process.once('SIGINT', forwardInterrupt);
    process.once('SIGTERM', forwardInterrupt);
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeout);
    child.on('message', message => {
      if (message?.event !== 'ready' || ready || timedOut) return;
      // Only public loopback metadata crosses the child boundary. Never emit
      // the Studio launch token or application-provided arbitrary objects.
      const origin = `http://127.0.0.1:${options.port ?? 4983}`;
      if (message.origin !== origin && message.origin !== `http://localhost:${options.port ?? 4983}`) return;
      ready = true;
      clearTimeout(timer);
      writeResult('studio', { data: { event: 'ready', origin: message.origin, remote: options.remote } });
    });
    child.once('error', () => child.kill());
    child.once('close', code => {
      clearTimeout(timer);
      process.removeListener('SIGINT', forwardInterrupt);
      process.removeListener('SIGTERM', forwardInterrupt);
      const ok = ready && code === 0 && !timedOut;
      resolve({ exitCode: ok ? 0 : 1, data: { event: ok ? 'stopped' : 'failed', ready },
        diagnostics: ok ? [] : [{ code: timedOut ? 'COSSACK_STUDIO_STARTUP_TIMEOUT' : 'COSSACK_STUDIO_EXECUTION_FAILED',
          severity: 'error', message: timedOut ? 'Studio did not become ready before the startup deadline.'
            : 'Studio could not start or close. Check the installed package and ORM configuration.' }] });
    });
  });
}

export function studioHelp() {
  return commandSpecs.studio.help(`cossack studio [options]

Open a loopback-only database inspector using this project's orm.config.ts.`);
}
