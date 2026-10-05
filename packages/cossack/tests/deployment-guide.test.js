import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { createApp } from '@cossackframework/scaffold';
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

describe('deployment guide public commands', () => {
  it('documents the minimal preset rather than the removed Durable Object entry', async () => {
    const guide = await fs.readFile(path.join(repository, 'docs/deployment.md'), 'utf8');
    const installation = await fs.readFile(path.join(repository, 'docs/installation.md'), 'utf8');
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-guide-contract-'));
    try {
      const { projectDir } = await createApp('guide-contract', { cwd: parent, adapter: 'cloudflare', preset: 'minimal', interactive: false });
      const generated = JSON.parse(await fs.readFile(path.join(projectDir, 'wrangler.jsonc'), 'utf8'));
      const excerpt = JSON.parse(/```jsonc\n([\s\S]*?)```/.exec(guide)[1]);
      for (const field of ['main', 'compatibility_date', 'compatibility_flags', 'durable_objects', 'migrations']) {
        expect(excerpt[field], `Documented ${field} must match the generated preset`).toEqual(generated[field]);
      }
      const entry = await fs.readFile(path.join(projectDir, 'src/index.ts'), 'utf8');
      for (const binding of excerpt.durable_objects.bindings) expect(entry).toContain(binding.class_name);
      expect(installation).toContain('--preset=minimal');
      expect(installation).toContain('pnpm install');
    } finally { await fs.rm(parent, { recursive: true, force: true }); }
    expect(guide).toContain('vars.APP_URL');
    expect(guide).toContain('https://example.com');
    expect(guide).toContain('pnpm exec cossack deploy --dry-run');
    expect(guide).toContain('pnpm exec cossack ssg --env staging');
    expect(guide).toContain('COSSACK_WRANGLER_API_UNSUPPORTED');
    expect(guide).toContain('without `.dev.vars`');
    expect(guide).toContain('custom_domain');
  });
});
