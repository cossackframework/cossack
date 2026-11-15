import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The CMS app is served from this package (specs/cms-served-app.md). A served file reaches the
 * project that mounts it only through `@/` imports, and the package lists those modules in
 * `package.json#cossack.host`. Every other import stays inside the served set.
 */
const packageRoot = path.resolve(import.meta.dirname, '..');
const app = path.join(packageRoot, 'app');
const recipe = JSON.parse(readFileSync(path.join(app, 'cossack-recipe.json'), 'utf8')) as { files: string[]; replaces: string[]; rendered: string[] };
const manifest = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8')) as {
    exports: Record<string, unknown>;
    cossack: { root: string; pages: string[]; plugins: string[]; config: string[]; host: string[] };
};

const walk = (directory: string): string[] => readdirSync(directory, { withFileTypes: true })
    .flatMap(entry => entry.isDirectory() ? walk(path.join(directory, entry.name)) : [path.join(directory, entry.name)]);

/** Served files, as paths from the app folder. */
const served = new Set<string>();
for (const entry of [...recipe.files, ...recipe.replaces]) {
    const absolute = path.join(app, entry);
    for (const file of entry.endsWith('/') ? walk(absolute) : [absolute]) {
        const relative = path.relative(app, file).split(path.sep).join('/');
        if (!recipe.rendered.includes(relative)) served.add(relative);
    }
}
const sources = [...served].filter(file => file.endsWith('.ts'));
const importsOf = (file: string) => [...readFileSync(path.join(app, file), 'utf8')
    .matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)'([^']+)'/g)].map(match => match[1]!);

describe('the host contract of the served CMS app', () => {
    it('has served files to check', () => {
        expect(sources.length).toBeGreaterThan(200);
        expect(manifest.cossack.root).toBe('app/src');
    });

    it('imports application modules only through @/, and only the ones the package lists', () => {
        const host = new Set(manifest.cossack.host.map(file => file.replace(/\.ts$/, '')));
        const used = new Set<string>();
        const unlisted: string[] = [];
        for (const file of sources) for (const specifier of importsOf(file)) {
            if (!specifier.startsWith('@/')) continue;
            used.add(specifier.slice(2));
            if (!host.has(specifier.slice(2))) unlisted.push(`${file}: ${specifier}`);
        }
        expect(unlisted).toEqual([]);
        // The list holds nothing the served code stopped using.
        expect([...host].filter(module => !used.has(module))).toEqual([]);
    });

    it('keeps every relative import inside the served set', () => {
        const leaving: string[] = [];
        for (const file of sources) for (const specifier of importsOf(file)) {
            if (!specifier.startsWith('.')) continue;
            const stem = path.posix.join(path.posix.dirname(file), specifier);
            const candidates = [stem, `${stem}.ts`, `${stem}/index.ts`];
            // A file of the served set, or an asset beside it (a stylesheet, a JSON catalog).
            if (!candidates.some(candidate => served.has(candidate))) leaving.push(`${file}: ${specifier}`);
        }
        // A copy of an application module in the project would never be used by such an import,
        // and the glue (database, media, pending) differs per runtime.
        expect(leaving).toEqual([]);
    });

    it('never imports the package source by a path: the core is a package import', () => {
        const escaping = sources.flatMap(file => importsOf(file).filter(specifier => specifier.startsWith('.') &&
            !path.posix.join(path.posix.dirname(file), specifier).startsWith('src/')).map(specifier => `${file}: ${specifier}`));
        expect(escaping).toEqual([]);
    });

    it('serves exactly the recipe\'s routable paths, plugins and configuration', () => {
        const under = (prefix: string) => [...recipe.files, ...recipe.replaces].filter(entry => entry.startsWith(prefix)).map(entry => entry.slice('src/'.length)).sort();
        expect([...manifest.cossack.pages].sort()).toEqual(under('src/pages/'));
        expect([...manifest.cossack.plugins].sort()).toEqual(under('src/plugins/'));
        expect([...manifest.cossack.config].sort()).toEqual(under('src/config/'));
        for (const entry of [...manifest.cossack.pages, ...manifest.cossack.plugins, ...manifest.cossack.config]) {
            expect(existsSync(path.join(app, 'src', entry)), entry).toBe(true);
            expect(statSync(path.join(app, 'src', entry)).isDirectory(), entry).toBe(entry.endsWith('/'));
        }
    });

    it('exports the served root, so a project imports a served module by name', () => {
        expect(manifest.exports['./app/*']).toBe('./app/src/*.ts');
    });

    it('gives the replaced shell modules no default export: a project re-exports each with export *', () => {
        // `export * from '@cossackframework/cms/app/auth'` does not carry a default export.
        const withDefault = recipe.replaces.filter(file => !file.startsWith('src/pages/'))
            .filter(file => /^export default\b|^export \{[^}]*\bdefault\b/m.test(readFileSync(path.join(app, file), 'utf8')));
        expect(withDefault).toEqual([]);
    });
});
