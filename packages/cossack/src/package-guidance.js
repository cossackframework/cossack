import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod/v4';

const id = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
const schema = z.object({
  schemaVersion: z.literal(1),
  guides: z.array(z.object({
    id, title: z.string().min(1).max(200), summary: z.string().min(1).max(2000),
    imports: z.array(z.string().min(1).max(200)).min(1).max(20),
    markdown: z.string().min(1).max(50_000),
    examples: z.array(z.object({
      id, language: z.literal('typescript'), source: z.string().min(1).max(30_000),
    }).strict()).max(10),
  }).strict()).max(50),
}).strict();
const limit = 256 * 1024;

/** Read package-owned prose as data. Never evaluate example source or manifest hooks. */
export async function readPackageGuidance(folder, name, version, exports) {
  let handle;
  try {
    const canonical = await fs.realpath(folder);
    const file = await fs.realpath(path.join(folder, 'agent-docs.json'));
    const relative = path.relative(canonical, file);
    if (relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('Invalid guide path');
    if (!(await fs.stat(file)).isFile()) throw new Error('Invalid guide file');
    handle = await fs.open(file, 'r');
    if (!(await handle.stat()).isFile()) throw new Error('Invalid guide file');
    // Bound the read itself, including files that grow after stat.
    const buffer = Buffer.alloc(limit + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > limit) throw new Error('Oversized guide');
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length));
    const parsed = schema.parse(JSON.parse(text));
    const ids = new Set();
    for (const guide of parsed.guides) {
      if (ids.has(guide.id) || new Set(guide.examples.map(example => example.id)).size !== guide.examples.length) throw new Error('Duplicate guide identity');
      ids.add(guide.id);
      if (guide.imports.some(specifier => specifier !== name && !specifier.startsWith(name + '/'))) throw new Error('Guide imports must belong to its package');
    }
    const available = new Set(exports.filter(entry => !entry.subpath.includes('*') && entry.targets.some(target => target.status === 'present')).map(entry => entry.import));
    const omitted = [], guides = [];
    for (const guide of parsed.guides) {
      const missingImports = guide.imports.filter(specifier => !available.has(specifier));
      if (missingImports.length) omitted.push({ id: guide.id, reason: 'imports-unavailable', imports: missingImports });
      else guides.push(guide);
    }
    return { status: omitted.length ? 'partial' : 'available', package: name, version,
      contentHash: createHash('sha256').update(text).digest('hex'), guides, omitted,
      runtimeSupport: 'not-verified', exampleExecution: 'not-performed' };
  } catch (error) {
    return { status: error.code === 'ENOENT' ? 'unavailable' : 'invalid', package: name, version, guides: [], omitted: [] };
  } finally { await handle?.close(); }
}
