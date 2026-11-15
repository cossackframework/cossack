import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SERVED_DASHBOARD_PATHS, isServedDashboardPath } from '../../scaffold/src/dashboard-recipe.js';

const root = path.resolve(import.meta.dirname, '..');
const app = path.join(root, 'app');
const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));

function sources(directory: string, prefix = 'src/'): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
        ? sources(path.join(directory, entry.name), `${prefix}${entry.name}/`)
        : [`${prefix}${entry.name}`]);
}
const served = sources(path.join(app, 'src')).filter(isServedDashboardPath);

describe('@cossackframework/dashboard', () => {
    it('serves the paths the scaffold leaves out of a project', () => {
        expect(served.length).toBeGreaterThan(40);
        for (const entry of SERVED_DASHBOARD_PATHS) expect(served.some(rel => entry.endsWith('/') ? rel.startsWith(entry) : rel === entry), entry).toBe(true);
        // Its pages and its configuration are mounted; the rest is reached by import.
        expect(manifest.cossack.pages).toEqual(['pages/auth/', 'pages/dashboard/']);
        expect(manifest.cossack.config).toEqual(['config/auth.ts']);
    });

    it('asks the project only for the modules it lists as its host contract', () => {
        const host = new Set<string>();
        for (const rel of served) {
            if (!rel.endsWith('.ts')) continue;
            const text = readFileSync(path.join(app, rel), 'utf8');
            for (const match of text.matchAll(/from '@\/([^']+)'/g)) host.add(`${match[1]}.ts`);
        }
        expect([...host].sort()).toEqual([...manifest.cossack.host].sort());
        // Each of them is a file the development application has, as a project would.
        for (const module of manifest.cossack.host) expect(existsSync(path.join(app, 'src', module)), module).toBe(true);
    });

    it('ships every served file, and no project file of its development application', () => {
        const packed = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: root, encoding: 'utf8' }))[0].files.map((file: { path: string }) => file.path);
        for (const rel of served) expect(packed, rel).toContain(`app/${rel}`);
        for (const rel of ['app/src/models/User.ts', 'app/src/migrations/0001_create_users.ts', 'app/src/dashboard.config.ts', 'app/src/index.ts', 'app/package.json', 'app/.env', 'app/src/App.ts'])
            expect(packed, rel).not.toContain(rel);
        expect(packed).toContain('src/index.ts');
    });
});
