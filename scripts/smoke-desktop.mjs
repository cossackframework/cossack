import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(process.argv[2] ?? 'examples/desktop-counter/out');

async function findExecutable(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = await findExecutable(target);
      if (nested) return nested;
    } else if (
      (process.platform === 'win32' && entry.name === 'cossack-counter.exe') ||
      (process.platform !== 'win32' && entry.name === 'cossack-counter' &&
        !target.includes(`${path.sep}node_modules${path.sep}`))
    ) return target;
  }
}

const executable = await findExecutable(root);
if (!executable) throw new Error(`Could not find the packaged Desktop executable under ${root}`);

// Forge's unpacked Linux directory has not received the root-owned/setuid
// permissions assigned to chrome-sandbox when the DEB is installed.
const args = process.platform === 'linux' ? ['--no-sandbox'] : [];
const child = spawn(executable, args, {
  stdio: 'inherit',
  env: { ...process.env, COSSACK_DESKTOP_SMOKE: '1' },
});
const timeout = setTimeout(() => child.kill(), 30_000);
const code = await new Promise((resolve) => child.once('exit', resolve));
clearTimeout(timeout);
if (code !== 0) throw new Error(`Packaged Desktop smoke test exited with ${code}`);
