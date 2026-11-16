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
const recipe = JSON.parse(readFileSync(path.join(app, 'cossack-recipe.json'), 'utf8')) as { served: string[]; shell: string[]; rendered: string[] };
const manifest = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8')) as {
    exports: Record<string, unknown>;
    cossack: { root: string; pages: string[]; plugins: string[]; config: string[]; host: string[] };
};

const walk = (directory: string): string[] => readdirSync(directory, { withFileTypes: true })
    .flatMap(entry => entry.isDirectory() ? walk(path.join(directory, entry.name)) : [path.join(directory, entry.name)]);

/** Served files, as paths from the app folder: the tracked sources and the shell `pnpm sync` writes (the test script runs it first). */
const served = new Set<string>();
for (const entry of [...recipe.served, ...recipe.shell]) {
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

    it('keeps every relative and #app/ import inside the served set', () => {
        const leaving: string[] = [];
        for (const file of sources) for (const specifier of importsOf(file)) {
            // `#app/` is the served root (`imports` in package.json): `#app/cms/site` is `src/cms/site.ts`.
            if (!specifier.startsWith('.') && !specifier.startsWith('#app/')) continue;
            const stem = specifier.startsWith('#app/') ? `src/${specifier.slice(5)}` : path.posix.join(path.posix.dirname(file), specifier);
            const candidates = [stem, `${stem}.ts`, `${stem}/index.ts`];
            // A file of the served set, or an asset beside it (a stylesheet, a JSON catalog).
            if (!candidates.some(candidate => served.has(candidate))) leaving.push(`${file}: ${specifier}`);
        }
        // A copy of an application module in the project would never be used by such an import.
        expect(leaving).toEqual([]);
    });

    it('names the served root #app/ in the package and in its development application', () => {
        const own = JSON.parse(readFileSync(path.join(app, 'package.json'), 'utf8')) as { imports: Record<string, string> };
        expect((manifest as { imports?: Record<string, string> }).imports).toEqual({ '#app/*': './app/src/*.ts' });
        expect(own.imports).toEqual({ '#app/*': './src/*.ts' });
        // Two directories up or more is written #app/, so a moved file keeps its imports.
        const climbing = sources.flatMap(file => importsOf(file).filter(specifier => specifier.startsWith('../../')).map(specifier => `${file}: ${specifier}`));
        expect(climbing).toEqual([]);
    });

    it('never imports the package source by a path: the core is a package import', () => {
        const escaping = sources.flatMap(file => importsOf(file).filter(specifier => specifier.startsWith('.') &&
            !path.posix.join(path.posix.dirname(file), specifier).startsWith('src/')).map(specifier => `${file}: ${specifier}`));
        expect(escaping).toEqual([]);
    });

    it('serves every page, plugin and configuration file of the recipe', () => {
        const mounted = [...manifest.cossack.pages, ...manifest.cossack.plugins, ...manifest.cossack.config];
        const covered = (file: string) => mounted.some(entry => entry.endsWith('/') ? file.startsWith(`src/${entry}`) : file === `src/${entry}`);
        const routable = [...served].filter(file => /^src\/(?:pages|plugins|config)\//.test(file));
        expect(routable.filter(file => !covered(file))).toEqual([]);
        for (const entry of mounted) {
            expect(existsSync(path.join(app, 'src', entry)), entry).toBe(true);
            expect(statSync(path.join(app, 'src', entry)).isDirectory(), entry).toBe(entry.endsWith('/'));
        }
        // Nothing but served files under a mounted directory: a project file there would be mounted too.
        const mountedFiles = manifest.cossack.pages.filter(entry => entry.endsWith('/')).flatMap(entry => walk(path.join(app, 'src', entry)))
            .map(file => path.relative(app, file).split(path.sep).join('/'));
        expect(mountedFiles.filter(file => !served.has(file))).toEqual([]);
    });

    it('ships the shell: the pack list names every served path', () => {
        const rules = readFileSync(path.join(app, '.npmignore'), 'utf8').split('\n').filter(line => line.startsWith('!/')).map(line => line.slice(2));
        const shipped = (file: string) => rules.some(rule => rule.endsWith('/') ? file.startsWith(rule) : file === rule);
        expect([...served].filter(file => !shipped(file))).toEqual([]);
    });

    it('exports the served root, so a project imports a served module by name', () => {
        expect(manifest.exports['./app/*']).toBe('./app/src/*.ts');
    });
});
