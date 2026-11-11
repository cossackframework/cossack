import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { cmsReconcilers } from '../src/server/reconcile';

const ROOT = path.resolve(import.meta.dirname, '..');

/** Every TypeScript file under these folders, tests aside. */
async function sources(dir: string): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    const files = await Promise.all(entries.map(async entry => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return entry.name === 'node_modules' || entry.name === 'tests' ? [] : sources(full);
        return /\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name) ? [full] : [];
    }));
    return files.flat();
}

describe('write reconcilers', () => {
    it('has a reconciler for every write kind the CMS sends', async () => {
        const kinds = new Set<string>();
        for (const file of [...await sources(path.join(ROOT, 'src')), ...await sources(path.join(ROOT, 'app/src'))]) {
            const text = await readFile(file, 'utf8');
            for (const match of text.matchAll(/kind(?:\s*:|\s*=)\s*'(cms\.[a-zA-Z.:_-]+)'/g)) kinds.add(match[1]!);
        }
        expect(kinds.size).toBeGreaterThan(20);
        const known = new Set(Object.keys(cmsReconcilers()));
        expect([...kinds].filter(kind => !known.has(kind)).sort()).toEqual([]);
    });
});
