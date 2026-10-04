import { it, expect } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readTestResults } from '../src/test-results-service.js';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
const exec = promisify(execFile);

it('records real Vitest outcomes and exposes them through the executable CLI', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-reporter-runtime-'));
  try {
    await fs.mkdir(path.join(root, 'node_modules'));
    for (const name of ['vitest', 'vite']) {
      await fs.symlink(path.join(repository, 'node_modules', name), path.join(root, 'node_modules', name), 'dir');
    }
    await fs.symlink(path.join(repository, 'packages/cossack'), path.join(root, 'node_modules/cossack'), 'dir');
    await fs.writeFile(path.join(root, 'package.json'), '{"type":"module"}');
    await fs.writeFile(path.join(root, 'vitest.config.mjs'), `
import { defineConfig } from 'vitest/config';
import Reporter from 'cossack/vitest-reporter';
export default defineConfig({ test: {
  include: ['case.test.js'], env: { APP_SECRET: 'fixture-private-value' },
  reporters: ['default', new Reporter()]
} });
`);
    const cases = [
      { source: `import {it,expect} from 'vitest';it('passes',()=>expect(1).toBe(1));it('fails '+process.env.APP_SECRET,()=>{throw new Error('raw-error-must-not-be-stored')});it.skip('not run',()=>{});`,
        exit: 1, state: 'failed', states: ['passed', 'failed', 'skipped'] },
      { source: `import {it} from 'vitest';throw new Error('collection-secret');it('never reached',()=>{});`,
        exit: 1, state: 'failed', states: [] },
      { source: `import {it,expect} from 'vitest';it('passes',()=>expect(2).toBe(2));`,
        exit: 0, state: 'passed', states: ['passed'] },
    ];
    const ids = new Set();
    for (const fixture of cases) {
      await fs.writeFile(path.join(root, 'case.test.js'), fixture.source);
      let exit = 0;
      try {
        await exec(process.execPath, [path.join(repository, 'node_modules/vitest/vitest.mjs'), 'run'], {
          cwd: root, timeout: 30000, maxBuffer: 1024 * 1024,
        });
      } catch (error) {
        exit = error.code;
        expect(error.stdout + error.stderr).not.toContain('Reporter Error');
      }
      expect(exit).toBe(fixture.exit);
      const result = await readTestResults(root);
      expect(result.data.report.state).toBe(fixture.state);
      expect(result.data.freshness.status).toBe('matches');
      expect(result.data.report.tests.map(test => test.state)).toEqual(fixture.states);
      ids.add(result.data.report.id);
      if (fixture.states.includes('failed')) {
        expect(result.data.report.tests[1].name).toBe('fails [REDACTED]');
        expect(result.data.report.tests[1].errors).toBe(1);
      }
      if (!fixture.states.length) expect(result.data.report.failedModules).toBe(1);
      const stored = await fs.readFile(path.join(root, '.vitest/cossack', result.data.report.id + '.json'), 'utf8');
      for (const privateText of ['fixture-private-value', 'raw-error-must-not-be-stored', 'collection-secret', root]) {
        expect(stored).not.toContain(privateText);
      }
      const { stdout, stderr } = await exec(process.execPath, [path.join(repository, 'packages/cossack/bin/cossack.js'), 'test-results', '--json'], {
        cwd: root, timeout: 30000, env: { ...process.env, COSSACK_DISABLE_UPDATE_CHECK: '1' },
      });
      expect(stderr).toBe('');
      const cli = JSON.parse(stdout);
      expect(cli.ok).toBe(true); // Reading a recorded failure succeeds.
      expect(cli.data).toEqual(result.data);
    }
    expect(ids.size).toBe(cases.length);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
}, 120000);
