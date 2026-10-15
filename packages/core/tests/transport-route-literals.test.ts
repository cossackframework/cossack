// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { RESERVED_TRANSPORT_PATHS, TRANSPORT_ROUTES, isTransportPath, transportPath } from '../src/shared/transport-routes';

/**
 * The transport endpoints live in one module. Package code that spells a
 * transport path itself can drift from the router (a renamed endpoint would
 * leave a proxy, middleware or the Node upgrade listener behind), so source
 * code imports `TRANSPORT_ROUTES`, `isTransportPath` or `transportPath`.
 * Docs, tests and comments may still name the paths.
 */
const packagesRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const SHARED_MODULE = path.join('core', 'src', 'shared', 'transport-routes.ts');
const SOURCE_ROOTS = ['src', 'bin', path.join('template', 'src')];
const SOURCE_FILE = /\.(?:[cm]?[jt]sx?)$/;
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', 'tests', 'test', '__tests__', 'e2e', 'fixtures', '.cossack', '.wrangler']);

/** A quoted transport path: `/crpc` or `/upload` exactly, or anything below `/sse/` or `/ws/`. */
const LITERAL = /(['"`])\/(?:(?:crpc|upload)(?=['"`?#/]|\$\{)|(?:sse|ws)(?=[/'"`]))/;

function stripComments(source: string): string {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, match => match.replace(/[^\n]/g, ' '))
        .replace(/(^|[\s;{}(),])\/\/.*$/gm, '$1');
}

function* sourceFiles(directory: string): Generator<string> {
    let entries: string[];
    try { entries = readdirSync(directory); } catch { return; }
    for (const entry of entries) {
        const full = path.join(directory, entry);
        const stats = statSync(full);
        if (stats.isDirectory()) {
            if (!SKIPPED_DIRECTORIES.has(entry)) yield* sourceFiles(full);
        } else if (SOURCE_FILE.test(entry) && !/\.(?:test|spec)\.|\.d\.ts$/.test(entry)) {
            yield full;
        }
    }
}

describe('transport route literals', () => {
    it('keeps every transport path in the shared module', () => {
        const offenders: string[] = [];
        let scanned = 0;
        for (const pkg of readdirSync(packagesRoot)) {
            for (const root of SOURCE_ROOTS) {
                for (const file of sourceFiles(path.join(packagesRoot, pkg, root))) {
                    const relative = path.relative(packagesRoot, file);
                    if (relative === SHARED_MODULE) continue;
                    scanned++;
                    stripComments(readFileSync(file, 'utf8')).split('\n').forEach((line, index) => {
                        if (LITERAL.test(line)) offenders.push(`${relative}:${index + 1}: ${line.trim()}`);
                    });
                }
            }
        }
        expect(scanned).toBeGreaterThan(100);
        expect(offenders).toEqual([]);
    });

    it('detects quoted transport paths but not similar routes or prose', () => {
        for (const line of [`fetch('/crpc', init)`, 'fetch(`/crpc${search}`)', `url.startsWith("/ws/")`, 'new EventSource(`/sse/${id}`)',
            `path === '/upload'`, `'/crpc?x=1'`]) expect(LITERAL.test(line), line).toBe(true);
        for (const line of [`'/crpcx'`, `'/uploads'`, `'/upload-demo'`, `'/wsx/chat'`, `'/sse-info'`, 'sends /crpc requests'])
            expect(LITERAL.test(line), line).toBe(false);
        expect(stripComments('a(); // fetch(\'/crpc\')\n/* \'/ws/\' */ b("http://x/ws/")')).not.toMatch(/crpc|'\/ws\//);
    });

    it('builds and recognizes the paths the router registers', () => {
        expect(transportPath('rpc')).toBe(TRANSPORT_ROUTES.rpc);
        expect(transportPath('upload')).toBe(TRANSPORT_ROUTES.upload);
        expect(transportPath('websocket', 'team:a/b')).toBe('/ws/team%3Aa%2Fb');
        expect(transportPath('sse', 'cmp_1')).toBe('/sse/cmp_1');
        expect(() => transportPath('websocket')).toThrow(TypeError);
        for (const reserved of RESERVED_TRANSPORT_PATHS) {
            const inside = reserved.match === 'exact' ? reserved.path : `${reserved.path}/x`;
            expect(isTransportPath(inside)).toBe(true);
        }
        expect(isTransportPath('/ws/abc', 'websocket')).toBe(true);
        expect(isTransportPath('/ws/abc', 'rpc', 'upload')).toBe(false);
        expect(isTransportPath('/sse/cmp_1', 'sse')).toBe(true);
        for (const path of ['/ws', '/sse', '/crpc/x', '/upload/files', '/crpcx', '/wsx/a', '/'])
            expect(isTransportPath(path), path).toBe(false);
    });
});
