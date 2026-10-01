import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

// `tsc --noEmit` at a solution-style root does not check its references.
// Check each package config explicitly, without requiring composite builds.
const root = fileURLToPath(new URL('../', import.meta.url));
const packages = path.join(root, 'packages');
const compiler = path.join(path.dirname(createRequire(import.meta.url).resolve('typescript/package.json')), 'bin/tsc');
for (const entry of readdirSync(packages, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const config = path.join(packages, entry.name, 'tsconfig.json');
    if (!existsSync(config)) continue; // JavaScript-only CLI/scaffold packages.
    console.log(`Type checking ${entry.name}`);
    const result = spawnSync(process.execPath, [compiler, '--noEmit', '-p', config], {
        cwd: root,
        stdio: 'inherit',
    });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
}
