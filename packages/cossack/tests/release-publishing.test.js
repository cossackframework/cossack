import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const workflow = parse(readFileSync(path.join(root, '.github/workflows/publish.yml'), 'utf8'));
const packages = readdirSync(path.join(root, 'packages'), { withFileTypes: true })
  .filter(entry => entry.isDirectory()).map(entry =>
  JSON.parse(readFileSync(path.join(root, 'packages', entry.name, 'package.json'), 'utf8')))
  .filter(pkg => !pkg.private);
const steps = workflow.jobs.publish.steps;

describe('release publishing coverage', () => {
  it('publishes every public workspace package exactly once and keeps external icons out', () => {
    const published = steps.flatMap(step => [...(step.run ?? '').matchAll(/pnpm publish --filter (\S+)/g)]
      .map(match => match[1]));
    expect(published.sort()).toEqual(packages.map(pkg => pkg.name).sort());
    expect(published).not.toContain('@cossackframework/solar-icons');
    for (const pkg of packages) {
      expect(pkg.repository?.url).toContain('github.com/cossackframework/cossack');
      expect(pkg.dependencies ?? {}).not.toHaveProperty('@cossackframework/test-utils');
    }
  });
  it('keeps test-utils internal and preserves the Desktop platform waiver', () => {
    const commands = steps.map(step => step.run ?? '').join('\n');
    const internal = JSON.parse(readFileSync(path.join(root, 'packages/test-utils/package.json'), 'utf8'));
    expect(internal.private).toBe(true);
    expect(commands).not.toContain('pnpm publish --filter @cossackframework/test-utils');
    expect(commands).not.toMatch(/--filter @cossackframework\/desktop (?:test|build:desktop)/);
    expect(workflow.jobs.publish.environment).toBe('Publish to npm');
    expect(workflow.jobs.publish.permissions['id-token']).toBe('write');
  });
});
