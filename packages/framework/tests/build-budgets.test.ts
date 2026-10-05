// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { checkBuildBudgets } from '../src/build-budgets';
const roots: string[] = [];
afterEach(async () => { vi.unstubAllEnvs(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture(script: string) {
  const root = await mkdtemp(join(tmpdir(), 'cossack-private-budget-tool-')); roots.push(root);
  const tool = join(root, 'node_modules/wrangler'); await mkdir(tool, { recursive: true });
  await writeFile(join(root, 'package.json'), '{}');
  await writeFile(join(tool, 'package.json'), '{"name":"wrangler","bin":{"wrangler":"bin.cjs"}}');
  await writeFile(join(tool, 'bin.cjs'), script); return root;
}
it('captures measurement privately and clears ambient target selection for an already-built artifact', async () => {
  const root = await fixture(`console.error('PRIVATE_BINDING_SENTINEL');
    if (process.env.CLOUDFLARE_ENV) process.exit(2);
    console.log('Total Upload: 1.00 KiB / gzip: 0.50 KiB');`);
  vi.stubEnv('CLOUDFLARE_ENV', 'staging');
  const result = await checkBuildBudgets(root, join(root, 'verified.json'), { uploadKiB: { error: 2 } }, { env: { CLOUDFLARE_ENV: 'staging' } });
  expect(result.valid).toBe(true); expect(JSON.stringify(result)).not.toContain('PRIVATE_BINDING_SENTINEL');
  expect(result.measurements[0]).toMatchObject({ value: 1, source: 'wrangler-dry-run' });
});
it('fails closed on bounded combined stdout/stderr overflow', async () => {
  const root = await fixture(`process.stdout.write('PRIVATE_SENTINEL' + 'x'.repeat(600000));
    process.stderr.write('x'.repeat(600000));
    console.log('Total Upload: 1.00 KiB / gzip: 0.50 KiB');`);
  const result = await checkBuildBudgets(root, join(root, 'verified.json'), { uploadKiB: { error: 2 } });
  expect(result.valid).toBe(false); expect(result.diagnostics[0].code).toBe('COSSACK_BUILD_BUDGET_MEASUREMENT_FAILED');
  expect(JSON.stringify(result)).not.toContain('PRIVATE_SENTINEL');
});
