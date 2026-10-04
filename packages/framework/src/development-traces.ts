/** Node-only shared storage for Vite, CLI and MCP. Never imports application code. */
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { DEVELOPMENT_TRACE_DIRECTORY, DEVELOPMENT_TRACE_MAX_BYTES, DEVELOPMENT_TRACE_SESSION, parseDevelopmentTrace, traceFailure } from './development-trace-record.js';
import type { DevelopmentTraceSnapshot } from '@cossackframework/core/devtools';
export { DEVELOPMENT_TRACE_SESSION, parseDevelopmentTrace } from './development-trace-record.js';
const MAX_RECORDS = 16;
const MAX_BYTES = DEVELOPMENT_TRACE_MAX_BYTES + 1024;
export interface DevelopmentTraceRecord {
    schemaVersion: 1; projectId: string; serverId: string; receivedAt: number; snapshot: DevelopmentTraceSnapshot;
}
const invalid = () => traceFailure('COSSACK_TRACE_INVALID', 'Stored development trace evidence is invalid. Record a new capture.');
const projectId = (root: string) => createHash('sha256').update(root).digest('hex');
async function directory(root: string, create = false) {
    let current = await fs.realpath(root);
    for (const part of DEVELOPMENT_TRACE_DIRECTORY.split('/')) {
        current = path.join(current, part);
        if (create) await fs.mkdir(current, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
        let stat;
        try { stat = await fs.lstat(current); } catch (error: any) { if (!create && error.code === 'ENOENT') return null; throw error; }
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw traceFailure('COSSACK_TRACE_PATH', 'Trace records require real project-local directories, not links.');
    }
    return current;
}
async function names(folder: string) {
    const result: string[] = []; let count = 0;
    const dir = await fs.opendir(folder);
    for await (const entry of dir) {
        if (++count > 128) throw traceFailure('COSSACK_TRACE_LIMIT', 'Trace directory exceeds its entry limit.');
        if (entry.name.endsWith('.json') && DEVELOPMENT_TRACE_SESSION.test(entry.name.slice(0, -5))) result.push(entry.name);
    }
    return result.sort();
}
async function readFile(file: string) {
    const before = await fs.lstat(file);
    if (!before.isFile() || before.isSymbolicLink() || before.size > MAX_BYTES) throw invalid();
    const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.ino !== before.ino || stat.dev !== before.dev || stat.size > MAX_BYTES) throw invalid();
        const buffer = Buffer.alloc(Math.min(MAX_BYTES + 1, stat.size + 1)); let length = 0;
        while (length < buffer.length) {
            const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
            if (!bytesRead) break; length += bytesRead;
        }
        if (length > stat.size || length > MAX_BYTES) throw invalid();
        return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length));
    } finally { await handle.close(); }
}
function parseRecord(json: string): DevelopmentTraceRecord {
    let r: any;
    try { r = JSON.parse(json); } catch { throw invalid(); }
    if (!r || Array.isArray(r) || Object.keys(r).sort().join(',') !== 'projectId,receivedAt,schemaVersion,serverId,snapshot' || r.schemaVersion !== 1 ||
        typeof r.projectId !== 'string' || !/^[a-f0-9]{64}$/.test(r.projectId) || typeof r.serverId !== 'string' || !DEVELOPMENT_TRACE_SESSION.test(r.serverId) ||
        !Number.isSafeInteger(r.receivedAt) || r.receivedAt < 0) throw invalid();
    return { ...r, snapshot: parseDevelopmentTrace(JSON.stringify(r.snapshot)) };
}
/** Caller serializes writes. One server owns one writer, with a bounded pending request policy. */
export async function writeDevelopmentTrace(root: string, serverId: string, json: string): Promise<DevelopmentTraceRecord> {
    if (!DEVELOPMENT_TRACE_SESSION.test(serverId)) throw invalid();
    const snapshot = parseDevelopmentTrace(json), canonicalRoot = await fs.realpath(root);
    const folder = (await directory(canonicalRoot, true))!;
    const existing = await names(folder);
    if (existing.length > MAX_RECORDS) throw traceFailure('COSSACK_TRACE_LIMIT', 'Trace directory exceeds its record limit.');
    const name = snapshot.sessionId + '.json';
    const records = await Promise.all(existing.map(async name => {
        const record = parseRecord(await readFile(path.join(folder, name)));
        if (record.projectId !== projectId(canonicalRoot) || record.snapshot.sessionId + '.json' !== name) throw invalid();
        return { name, receivedAt: record.receivedAt };
    }));
    if (!existing.includes(name) && records.length >= MAX_RECORDS) {
        records.sort((a, b) => a.receivedAt - b.receivedAt || a.name.localeCompare(b.name));
        await fs.unlink(path.join(folder, records[0].name));
    }
    const record: DevelopmentTraceRecord = { schemaVersion: 1, projectId: projectId(canonicalRoot), serverId, receivedAt: Date.now(), snapshot };
    const temporary = path.join(folder, randomUUID() + '.tmp');
    try {
        await fs.writeFile(temporary, JSON.stringify(record), { flag: 'wx', mode: 0o600 });
        await fs.rename(temporary, path.join(folder, name));
    } finally { await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
    return record;
}
export async function readDevelopmentTraces(root: string, options: { session?: string } = {}) {
    if (options.session !== undefined && !DEVELOPMENT_TRACE_SESSION.test(options.session)) throw traceFailure('COSSACK_TRACE_SESSION_INVALID', 'Use a capture session UUID, not a path.');
    const canonicalRoot = await fs.realpath(root), folder = await directory(canonicalRoot);
    const missing = { ok: true as const, data: { status: 'missing' as const, record: null, freshness: null }, diagnostics: [] };
    if (!folder) return missing;
    const files = options.session ? [options.session + '.json'] : await names(folder);
    if (files.length > MAX_RECORDS) throw traceFailure('COSSACK_TRACE_LIMIT', 'Trace directory exceeds its record limit.');
    let record: DevelopmentTraceRecord | undefined;
    for (const file of files) {
        let json: string;
        try { json = await readFile(path.join(folder, file)); } catch (error: any) { if (error.code === 'ENOENT') continue; throw error; }
        const candidate = parseRecord(json);
        if (candidate.snapshot.sessionId + '.json' !== file) throw invalid();
        if (candidate.projectId !== projectId(canonicalRoot)) throw traceFailure('COSSACK_TRACE_PROJECT', 'Trace evidence belongs to another project location. Record it here again.');
        if (!record || candidate.receivedAt > record.receivedAt || candidate.receivedAt === record.receivedAt && candidate.snapshot.sessionId > record.snapshot.sessionId) record = candidate;
    }
    if (!record) return missing;
    return { ok: true as const, data: { status: 'recorded' as const, record,
        freshness: { status: 'recorded-snapshot' as const, ageMs: Math.max(0, Date.now() - record.receivedAt), live: false as const },
        provenance: 'Local browser observation received by Vite; not authenticated server execution or proof of current application state.' }, diagnostics: [] };
}
