import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// requests.md C8: in development, Vite evaluates modules one import at a time, and a module in
// an import cycle can run before a module it imports has finished: the binding it reads is
// undefined then (Vite turns the "before initialization" error into undefined). The served app
// had such a cycle: cms/index.ts imported the pages registry, which imports every layout on the
// server, and the layouts reach back into the code that imports cms/index.ts. The dashboard
// registry read `authOptions.modules` while it evaluated, threw, and Vite kept that failure:
// every request answered 500 until the server restarted. The served code must have no cycle.

const app = fileURLToPath(new URL('../app/src', import.meta.url));
const library = fileURLToPath(new URL('../src', import.meta.url));
const PAGES = 'virtual:cossack-pages';

const walk = (directory: string): string[] => readdirSync(directory, { withFileTypes: true })
    .flatMap(entry => entry.isDirectory() ? walk(join(directory, entry.name)) : [join(directory, entry.name)]);
const file = (base: string): string | null => {
    for (const candidate of [base, `${base}.ts`, `${base}/index.ts`]) if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
    return null;
};
// The project's ORM models refer to each other for their relations, which they read when used.
const served = (path: string) => path.startsWith(app) && path.endsWith('.ts') && !path.includes('/plugins/') && !path.includes('/models/') && !path.endsWith('.test.ts');
// On the server the pages registry imports every layout up front (pages load on first use in development).
const layouts = walk(join(app, 'pages')).filter(path => path.endsWith('/layout.ts'));

function resolveImport(specifier: string, from: string): string | null {
    if (specifier === PAGES) return PAGES;
    if (specifier.startsWith('.')) return file(resolve(dirname(from), specifier));
    if (specifier.startsWith('#app/')) return file(join(app, specifier.slice('#app/'.length)));
    if (specifier.startsWith('@cossackframework/cms/app/')) return file(join(app, specifier.slice('@cossackframework/cms/app/'.length)));
    if (specifier === '@cossackframework/cms') return join(library, 'index.ts');
    return null;
}

/** The modules a module imports for its values: `import type` and type-only names are left out. */
function imports(path: string): string[] {
    if (path === PAGES) return layouts;
    const source = readFileSync(path, 'utf8');
    const found: string[] = [];
    for (const match of source.matchAll(/^\s*(?:import|export)\s+(?!type\b)(?:([^;]*?)\bfrom\s+)?['"]([^'"]+)['"]/gms)) {
        if (/^\s*\{\s*(?:type\s+[^,}]+,?\s*)+\}\s*$/s.test(match[1] ?? '')) continue;
        const target = resolveImport(match[2]!, path);
        if (target) found.push(target);
    }
    return found;
}

/** Import cycles (strongly connected components of more than one module) among served modules. */
function cycles(): string[][] {
    const graph = new Map<string, string[]>();
    const visit = (path: string) => {
        if (graph.has(path)) return;
        const next = imports(path).filter(target => target === PAGES || served(target));
        graph.set(path, next);
        next.forEach(visit);
    };
    walk(app).filter(served).forEach(visit);
    let counter = 0;
    const index = new Map<string, number>(), low = new Map<string, number>(), stack: string[] = [], onStack = new Set<string>(), found: string[][] = [];
    const connect = (node: string) => {
        index.set(node, counter); low.set(node, counter); counter++; stack.push(node); onStack.add(node);
        for (const next of graph.get(node) ?? []) {
            if (!index.has(next)) { connect(next); low.set(node, Math.min(low.get(node)!, low.get(next)!)); }
            else if (onStack.has(next)) low.set(node, Math.min(low.get(node)!, index.get(next)!));
        }
        if (low.get(node) !== index.get(node)) return;
        const component: string[] = [];
        let member: string;
        do { member = stack.pop()!; onStack.delete(member); component.push(member); } while (member !== node);
        if (component.length > 1) found.push(component.map(path => path === PAGES ? PAGES : path.slice(app.length + 1)).sort());
    };
    for (const node of graph.keys()) if (!index.has(node)) connect(node);
    return found;
}

describe('the served CMS code', () => {
    it('has no import cycle, through the pages registry or otherwise', () => {
        expect(layouts.length).toBeGreaterThan(0);
        expect(cycles()).toEqual([]);
    });

    it('reads the page files\' names without importing the pages registry', () => {
        const index = readFileSync(join(app, 'cms/index.ts'), 'utf8');
        expect(index).toContain("from 'virtual:cossack-page-files'");
        expect(index).not.toMatch(/from\s+['"]virtual:cossack-pages['"]/);
    });
});
