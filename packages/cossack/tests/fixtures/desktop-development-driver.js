import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';

/** Exercise the package's declared CLI, including its Electron child supervision. */
export async function launchDesktopDevelopmentCli(root, profile, { crash = false } = {}) {
  const packageRoot = path.join(root, 'node_modules/@cossackframework/desktop');
  const manifest = JSON.parse(await fs.readFile(path.join(packageRoot, 'package.json'), 'utf8'));
  const entry = path.resolve(packageRoot, manifest.bin['cossack-desktop']);
  const child = spawn(
    process.execPath,
    [
      entry,
      '--remote-debugging-port=0',
      '--remote-debugging-address=127.0.0.1',
      `--user-data-dir=${profile}`,
      ...(process.platform === 'linux' ? ['--ozone-platform=x11'] : []),
    ],
    {
      cwd: root,
      env: { ...process.env, NODE_ENV: 'development', ELECTRON_RUN_AS_NODE: '', COSSACK_DESKTOP_DEBUG: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let output = '';
  child.stdout.on('data', (data) => {
    output += data;
  });
  child.stderr.on('data', (data) => {
    output += data;
  });
  const exited = once(child, 'exit');
  let browser, endpoint;
  const latestEndpoint = () =>
    [...output.matchAll(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/\S+)/g)].at(-1)?.[1];
  try {
    await expect
      .poll(
        () => {
          if (child.exitCode !== null) throw new Error(output);
          return /DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/\S+)/.exec(output)?.[1];
        },
        { timeout: 30000 },
      )
      .toBeTruthy();
    endpoint = /DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/\S+)/.exec(output)[1];
    browser = await chromium.connectOverCDP(endpoint);
  } catch (error) {
    child.kill('SIGTERM');
    const force = setTimeout(() => child.kill('SIGKILL'), 10000);
    await exited;
    clearTimeout(force);
    throw new Error(`${error.stack}\nDesktop CLI:\n${output}`);
  }
  return {
    initialOutput: output,
    process: () => child,
    async restartAfter(change) {
      const previous = endpoint;
      await change();
      await expect.poll(latestEndpoint, { timeout: 30000 }).not.toBe(previous);
      endpoint = latestEndpoint();
      await browser.close();
      browser = await chromium.connectOverCDP(endpoint);
      const url = new URL(previous);
      url.protocol = 'http:';
      url.pathname = '/json/version';
      await expect
        .poll(
          () =>
            fetch(url).then(
              () => true,
              () => false,
            ),
          { timeout: 10000 },
        )
        .toBe(false);
    },
    async firstWindow({ timeout = 30000 } = {}) {
      let page;
      await expect
        .poll(
          () => {
            page = browser
              .contexts()
              .flatMap((context) => context.pages())
              .find((candidate) => candidate.url().startsWith('cossack://app'));
            return !!page;
          },
          { timeout },
        )
        .toBe(true);
      return page;
    },
    async close() {
      child.kill(crash ? 'SIGKILL' : 'SIGTERM');
      const force = setTimeout(() => child.kill('SIGKILL'), 10000);
      try {
        const [code, signal] = await exited;
        expect({ code, signal }, output).toEqual(crash ? { code: null, signal: 'SIGKILL' } : { code: 0, signal: null });
        const url = new URL(endpoint);
        url.protocol = 'http:';
        url.pathname = '/json/version';
        await expect
          .poll(
            () =>
              fetch(url).then(
                () => true,
                () => false,
              ),
            { timeout: 10000 },
          )
          .toBe(false);
      } finally {
        clearTimeout(force);
        await browser.close();
      }
    },
  };
}
