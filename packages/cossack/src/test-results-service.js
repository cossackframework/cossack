/** Local test evidence. Reads never execute tests or application modules. */
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import * as z from 'zod/v4';

export const TEST_RESULTS_DIRECTORY = '.vitest/cossack';
const MAX_REPORT_BYTES = 2 * 1024 * 1024;
const MAX_REPORTS = 128;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export const testRunIdSchema = z.string().regex(UUID);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.string().datetime();
const text = z.string().max(1024);
const count = z.number().int().min(0).max(1_000_000);
const relative = text.refine(value => !!value && !value.includes('\\') && !value.includes('\0') && !path.posix.isAbsolute(value) && !/^[A-Za-z]:/.test(value) && !value.split('/').some(part => part === '..' || part === '' || part === '.'));
const snapshot = z.object({ status: z.enum(['complete', 'unknown']), digest: digest.nullable(), files: count,
  reason: z.enum(['limit', 'symlink', 'unreadable']).nullable() }).strict().refine(value => value.status === 'complete' ? value.digest !== null && value.reason === null : value.digest === null && value.reason !== null);
const test = z.object({ id: text, name: text, file: relative, project: text,
  state: z.enum(['passed', 'failed', 'skipped', 'pending']), errors: count,
  line: z.number().int().positive().nullable(), column: z.number().int().positive().nullable() }).strict();
export const testReportSchema = z.object({ schemaVersion: z.literal(1), id: testRunIdSchema, projectId: digest,
  producer: z.object({ name: z.literal('vitest'), version: z.string().max(64).regex(/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/) }).strict(),
  startedAt: timestamp, finishedAt: timestamp.nullable(), state: z.enum(['running', 'passed', 'failed', 'interrupted']),
  scope: z.literal('selected-tests'), selectedModules: count, failedModules: count, unhandledErrors: count,
  before: snapshot, after: snapshot.nullable(), tests: z.array(test).max(10_000),
}).strict().superRefine((report, ctx) => {
  const invalid = report.state === 'running'
    ? report.finishedAt !== null || report.after !== null || report.tests.length !== 0
    : !report.finishedAt || !report.after || report.finishedAt < report.startedAt;
  if (invalid || report.state === 'passed' && (report.failedModules || report.unhandledErrors || report.tests.some(test => test.state === 'failed' || test.state === 'pending'))) {
    ctx.addIssue({ code: 'custom', message: 'Inconsistent report lifecycle.' });
  }
});
const fail = (code, message) => Object.assign(new Error(message), { code });
const invalidReport = () => fail('COSSACK_TEST_REPORT_INVALID', 'Stored test evidence is invalid or incomplete JSON. Run tests with the Cossack reporter again.');

/** Free-form failures/stdout/expected/actual values are deliberately never stored. */
export function testTextRedactor(...environments) {
  if (!environments.length) environments = [process.env];
  const secrets = environments.flatMap(environment => Object.entries(environment ?? {})).filter(([key, value]) => /secret|token|password|credential|private.?key|access.?key|database.?url/i.test(key) && typeof value === 'string' && value.length)
    .map(([, value]) => value).sort((a, b) => b.length - a.length);
  const unique = [...new Set(secrets)];
  const oversized = unique.length > 256 || unique.reduce((sum, value) => sum + value.length, 0) > 64 * 1024;
  const matcher = !oversized && unique.length ? new RegExp(unique.map(value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g') : null;
  return value => {
    let output = String(value ?? '');
    if (oversized || output.length > 1024 * 1024) return '[OMITTED]';
    if (matcher) output = output.replace(matcher, '[REDACTED]');
    return output.replace(/\b(Bearer\s+)\S+/gi, '$1[REDACTED]')
      .replace(/\b((?:password|secret|token|api[_-]?key)\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]')
      .replace(/([a-z]+:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[REDACTED]@')
      .replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 1024);
  };
}

async function regularFile(file, maxBytes) {
  const before = await fs.lstat(file);
  if (!before.isFile() || before.isSymbolicLink()) throw invalidReport();
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.dev !== before.dev || stat.ino !== before.ino || stat.size > maxBytes) throw invalidReport();
    // Bound reads even if another process grows the opened file after stat().
    const buffer = Buffer.alloc(Math.min(maxBytes + 1, stat.size + 1));
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > maxBytes || length > stat.size) throw invalidReport();
    return buffer.subarray(0, length);
  } finally { await handle.close(); }
}

async function directory(root, create = false) {
  let current = await fs.realpath(root);
  for (const part of TEST_RESULTS_DIRECTORY.split('/')) {
    current = path.join(current, part);
    if (create) await fs.mkdir(current, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
    let stat;
    try { stat = await fs.lstat(current); } catch (error) { if (!create && error.code === 'ENOENT') return null; throw error; }
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw fail('COSSACK_TEST_REPORT_PATH', 'Test evidence must use real project-local directories, not links.');
  }
  return current;
}

const excludedDirectories = new Set(['node_modules', '.git', '.vitest', '.cossack', '.wrangler', '.cache', '.turbo', '.next', '.output', 'dist', 'build', 'coverage', 'test-results', 'playwright-report']);
export const TEST_SNAPSHOT_SCOPE = 'Project files excluding dependencies, generated/build/test artifacts and .env/.dev.vars/key files; no environment or external-service verification.';
/** Conservative bounded endpoint snapshot, not proof that all inputs stayed constant during a run. */
export async function testSourceSnapshot(root) {
  const hash = createHash('sha256'); let files = 0, bytes = 0, entries = 0;
  const unknown = reason => ({ status: 'unknown', digest: null, files, reason });
  let issue;
  async function walk(folder, prefix, depth) {
    if (depth > 24) { issue = 'limit'; return; }
    const names = [];
    const dir = await fs.opendir(folder);
    for await (const entry of dir) {
      if (++entries > 8192) { issue = 'limit'; return; }
      names.push(entry.name);
    }
    for (const name of names.sort()) {
      if (excludedDirectories.has(name) || /^\.env(?:\.|$)|^\.dev\.vars(?:\.|$)|\.(?:pem|key|p12|pfx)$/.test(name)) continue;
      const file = path.join(folder, name), relative = prefix + name;
      const stat = await fs.lstat(file);
      if (stat.isSymbolicLink()) { issue = 'symlink'; return; }
      if (stat.isDirectory()) await walk(file, relative + '/', depth + 1);
      else if (stat.isFile()) {
        if (++files > 4096 || stat.size > 8 * 1024 * 1024 || bytes + stat.size > 64 * 1024 * 1024) { issue = 'limit'; return; }
        const data = await regularFile(file, Math.min(8 * 1024 * 1024, 64 * 1024 * 1024 - bytes)); bytes += data.length;
        hash.update(JSON.stringify([relative, data.length])); hash.update(data);
      } else { issue = 'unreadable'; return; }
      if (issue) return;
    }
  }
  try { await walk(await fs.realpath(root), '', 0); }
  catch { return unknown('unreadable'); }
  return issue ? unknown(issue) : { status: 'complete', digest: hash.digest('hex'), files, reason: null };
}

async function reportNames(folder) {
  const names = []; let entries = 0;
  const dir = await fs.opendir(folder);
  for await (const entry of dir) {
    if (++entries > MAX_REPORTS * 2) throw fail('COSSACK_TEST_REPORT_LIMIT', 'Too many test evidence files. Remove old reports from .vitest/cossack.');
    if (entry.name.endsWith('.json') && UUID.test(entry.name.slice(0, -5))) {
      if (!entry.isFile() || entry.isSymbolicLink()) throw fail('COSSACK_TEST_REPORT_PATH', 'Test reports must be regular project-local files.');
      names.push(entry.name);
      if (names.length > MAX_REPORTS) throw fail('COSSACK_TEST_REPORT_LIMIT', 'Too many stored test runs. Remove old reports from .vitest/cossack.');
    }
  }
  return names;
}
export async function writeTestReport(root, report) {
  if (!testReportSchema.safeParse(report).success) throw invalidReport();
  const json = JSON.stringify(report);
  if (Buffer.byteLength(json) > MAX_REPORT_BYTES) throw fail('COSSACK_TEST_REPORT_LIMIT', 'Test report exceeds the storage limit. Select a smaller test scope.');
  const folder = await directory(root, true);
  const names = await reportNames(folder);
  if (!names.includes(`${report.id}.json`) && names.length >= MAX_REPORTS) throw fail('COSSACK_TEST_REPORT_LIMIT', 'Too many stored test runs. Remove old reports from .vitest/cossack.');
  const temporary = path.join(folder, `${report.id}.${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporary, json, { flag: 'wx', mode: 0o600 });
    await fs.rename(temporary, path.join(folder, `${report.id}.json`));
  } finally { await fs.rm(temporary, { force: true }); }
}
export async function beginTestReport(root, producer, selectedModules) {
  const report = { schemaVersion: 1, id: randomUUID(), projectId: createHash('sha256').update(await fs.realpath(root)).digest('hex'), producer, startedAt: new Date().toISOString(), finishedAt: null,
    state: 'running', scope: 'selected-tests', selectedModules, failedModules: 0, unhandledErrors: 0,
    before: await testSourceSnapshot(root), after: null, tests: [] };
  await writeTestReport(root, report); return report;
}

/** Read the most recently started run (including unfinished runs), or one explicit UUID. */
export async function readTestResults(root, { run } = {}) {
  if (run !== undefined && !UUID.test(run)) throw fail('COSSACK_TEST_RUN_INVALID', 'Use a test run UUID, not a file path.');
  const folder = await directory(root);
  if (!folder) return { ok: true, data: { status: 'missing', report: null, freshness: null }, diagnostics: [] };
  const names = run ? [`${run}.json`] : await reportNames(folder);
  let report;
  for (const name of names) {
    let value;
    try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await regularFile(path.join(folder, name), MAX_REPORT_BYTES))); }
    catch (error) {
      if (run && error.code === 'ENOENT') return { ok: true, data: { status: 'missing', report: null, freshness: null }, diagnostics: [] };
      throw invalidReport();
    }
    const parsed = testReportSchema.safeParse(value);
    if (!parsed.success || parsed.data.id + '.json' !== name) throw invalidReport();
    const candidate = parsed.data;
    if (!report || candidate.startedAt > report.startedAt || candidate.startedAt === report.startedAt && candidate.id > report.id) report = candidate;
  }
  if (!report) return { ok: true, data: { status: 'missing', report: null, freshness: null }, diagnostics: [] };
  if (report.projectId !== createHash('sha256').update(await fs.realpath(root)).digest('hex')) throw fail('COSSACK_TEST_REPORT_PROJECT', 'Stored test evidence belongs to another project location. Run tests here again.');
  const current = await testSourceSnapshot(root);
  const status = report.state === 'running' ? 'unfinished'
    : report.before.status !== 'complete' || report.after?.status !== 'complete' || current.status !== 'complete' ? 'unknown'
    : report.before.digest !== report.after.digest ? 'changed-during-run'
    : report.after.digest !== current.digest ? 'changed' : 'matches';
  const redact = testTextRedactor();
  report.tests = report.tests.map(test => ({ ...test, name: redact(test.name), file: redact(test.file), project: redact(test.project), id: redact(test.id) }));
  return { ok: true, data: { status: 'recorded', report,
    freshness: { status, scope: TEST_SNAPSHOT_SCOPE, current }, provenance: 'local-reporter-record; not independently authenticated' }, diagnostics: [] };
}
