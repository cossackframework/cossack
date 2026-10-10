import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { expect, it } from 'vitest';
// The acceptance runner is Node tooling, outside the portable database package.
// @ts-expect-error Standalone release script has no published declarations.
import { stopOwnedProcess } from '../../../scripts/test-database-providers.mjs';

it('waits for an owned cooperative process to terminate', async () => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
  await once(child, 'spawn');
  try {
    await stopOwnedProcess(child, 1000);
    expect(child.signalCode).toBe('SIGTERM');
    await stopOwnedProcess(child, 1000); // Already-exited ownership is harmless.
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
});

it('kills only its owned process when shutdown exceeds its deadline', async () => {
  const child = spawn(process.execPath, [
    '-e',
    "process.on('SIGTERM', () => {}); console.log('ready'); setInterval(() => {}, 1000)",
  ]);
  await once(child.stdout!, 'data');
  try {
    await stopOwnedProcess(child, 30);
    expect(child.signalCode).toBe('SIGKILL');
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
});

it('does not wait for an executable which failed to spawn', async () => {
  const child = spawn('/cossack-owned-nonexistent-executable');
  await once(child, 'error');
  await stopOwnedProcess(child, 30);
  expect(child.pid).toBeUndefined();
});

it.skipIf(process.platform !== 'linux')('terminates descendants in an exclusively owned process group', async () => {
  const { readFile } = await import('node:fs/promises');
  const child = spawn(
    process.execPath,
    [
      '-e',
      `
    const { spawn } = require('node:child_process');
    const nested = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); console.log('ready'); setInterval(() => {}, 1000)"]);
    nested.stdout.once('data', () => console.log(nested.pid));
    setInterval(() => {}, 1000);
  `,
    ],
    { detached: true },
  );
  const [output] = await once(child.stdout!, 'data');
  const descendant = Number(String(output).trim());
  try {
    await stopOwnedProcess(child, 30, { processGroup: true });
    let state: string | undefined;
    for (let attempt = 0; attempt < 50; attempt++) {
      try {
        state = (await readFile(`/proc/${descendant}/stat`, 'utf8')).split(') ')[1]?.[0];
      } catch (error) {
        if (!['ENOENT', 'ESRCH'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
        state = undefined;
      }
      if (state === undefined || state === 'Z') break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(state === undefined || state === 'Z').toBe(true);
  } finally {
    try {
      process.kill(-child.pid!, 'SIGKILL');
    } catch {}
  }
});
