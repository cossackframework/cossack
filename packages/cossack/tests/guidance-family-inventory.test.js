import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readDocumentation } from '../src/documentation-service.js';
import { GUIDANCE_FAMILIES, describeGuidanceCoverage } from '../src/guidance-coverage.js';

const repository = fileURLToPath(new URL('../../../', import.meta.url)), roots = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, {recursive:true,force:true}))); });
async function catalog() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-guide-inventory-')); roots.push(root);
  const modules = path.join(root, 'node_modules/@cossackframework'); await fs.mkdir(modules, {recursive:true});
  await fs.writeFile(path.join(root, 'package.json'), '{"type":"module"}');
  for (const pkg of Object.keys(GUIDANCE_FAMILIES)) await fs.symlink(path.join(repository, 'packages', pkg), path.join(modules, pkg), 'junction');
  return (await readDocumentation(root)).data.packages.filter(pkg => pkg.installed);
}
it('all maintained non-Desktop API families have discoverable usage and executable examples', async () => {
  const packages = await catalog();
  expect(packages).toHaveLength(Object.keys(GUIDANCE_FAMILIES).length);
  for (const pkg of packages) {
    expect(pkg.guidance.status, pkg.name).toBe('available');
    expect(pkg.guidanceCoverage.status, pkg.name).toBe('available');
    expect(pkg.guidanceCoverage.behaviorVerification).toBe('not-performed');
    for (const guide of pkg.guidance.guides) {
      expect(guide.examples.length, pkg.name + ':' + guide.id).toBeGreaterThan(0);
      const content = guide.markdown + '\n' + guide.examples.map(example => example.source).join('\n');
      for (const match of content.matchAll(/(?:from\s*|import\s*\(\s*)['"](@cossackframework\/[^'"]+)['"]/g)) {
        const specifier = match[1], packageName = specifier.split('/').slice(0,2).join('/');
        const declared = packages.find(item => item.name === packageName);
        const entry = [...declared.exports, ...(declared.implicitEntry ? [declared.implicitEntry] : [])].find(item => item.import === specifier);
        expect(entry?.targets.some(target => target.status === 'present'), `${pkg.name}:${guide.id}: unpublished ${specifier}`).toBe(true);
        if (packageName === pkg.name) expect(guide.imports, `${guide.id}: markdown imports must participate in removal filtering`).toContain(specifier);
      }
    }
  }
}, 30000);
it('missing or removed guidance stays visibly partial rather than claiming runtime behavior', () => {
  const coverage = describeGuidanceCoverage('@cossackframework/node-adapter', {guides:[{id:'node-runtime-lifecycle'}]});
  expect(coverage.status).toBe('partial');
  expect(coverage.families[0].missing).toEqual(['notification-smtp-adapter','authorized-local-storage']);
  expect(coverage.behaviorVerification).toBe('not-performed');
  expect(describeGuidanceCoverage('@cossackframework/desktop', {guides:[]}).status).toBe('not-enumerated');
});
