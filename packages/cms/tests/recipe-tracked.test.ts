import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const app = path.resolve(import.meta.dirname, '../app');
const manifest = JSON.parse(readFileSync(path.join(app, 'cossack-recipe.json'), 'utf8')) as { files: string[]; replaces: string[]; rendered: string[] };

/** Git's view of the app folder; null outside a checkout (a packed tarball), where the test has nothing to check. */
function tracked(): string[] | null {
    try { return execFileSync('git', ['ls-files', '--cached', '.'], { cwd: app, encoding: 'utf8' }).split('\n').filter(Boolean); }
    catch { return null; }
}

describe('cms recipe sources', () => {
    // A path the recipe reads but git ignores works in a developer's folder and fails a clean checkout.
    it.skipIf(!existsSync(path.join(app, '../../../.git')))('tracks every path the recipe reads from this folder', () => {
        const files = tracked();
        if (!files) return;
        const missing = [...manifest.files, ...manifest.replaces]
            .filter(entry => !manifest.rendered.includes(entry))
            .filter(entry => !files.some(file => entry.endsWith('/') ? file.startsWith(entry) : file === entry));
        expect(missing).toEqual([]);
    });
});
