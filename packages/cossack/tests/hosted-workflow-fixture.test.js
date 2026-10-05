import { it, expect } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript-api';
import { writeHostedWorkflowAcceptance } from './fixtures/hosted-workflow-acceptance.js';

it('writes guarded server acceptance modules without changing resource configuration', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-hosted-generator-'));
  try {
    const original = '{"name":"owned-by-runner"}\n';
    await fs.writeFile(path.join(root, 'wrangler.jsonc'), original);
    await writeHostedWorkflowAcceptance(root);
    expect(await fs.readFile(path.join(root, 'wrangler.jsonc'), 'utf8')).toBe(original);
    for (const name of ['src/workflows/approval.ts', 'src/pages/api/workflow.ts', 'src/pages/api/acceptance-exception.ts']) {
      const source = await fs.readFile(path.join(root, name), 'utf8');
      expect(ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true).parseDiagnostics).toEqual([]);
      expect(source).not.toMatch(/console\.|fetch\(|account_id|database_id/);
      if (name.includes('/api/')) {
        expect(source).toContain("c.req.header('X-Cossack-Acceptance-Key') !== c.env.ACCEPTANCE_KEY");
        expect(source).toContain("'ACCEPTANCE_UNAUTHORIZED'");
      }
    }
    const exception = await fs.readFile(path.join(root, 'src/pages/api/acceptance-exception.ts'), 'utf8');
    expect(exception).toContain("throw new Error('PRIVATE_HOSTED_API_EXCEPTION')");
    expect(exception).not.toContain('catch');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
