import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
const fail = suffix => Object.assign(new Error('Preview staging secrets are missing or invalid. Supply a private JSON file containing exactly the declared secret names.'), { code: `COSSACK_PREVIEW_SECRETS_${suffix}` });
const namePattern = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
/** Internal-only: never include the returned bindings in a journal or CLI result. */
export async function readPreviewSecrets(root, filename, requiredNames) {
  if (!Array.isArray(requiredNames) || requiredNames.length > 64 || requiredNames.some(name => typeof name !== 'string' || (!namePattern.test(name) || ['__proto__', 'prototype', 'constructor'].includes(name))) || new Set(requiredNames).size !== requiredNames.length) throw fail('DECLARATION_INVALID');
  if (!filename) { if (requiredNames.length) throw fail('REQUIRED'); return []; }
  if (typeof filename !== 'string' || filename.length > 4096) throw fail('FILE_INVALID');
  const selected = path.resolve(root, filename);
  let handle;
  try {
    // Explicit files may live outside the app (CI secret mounts). Reject every symlink segment.
    let current = path.parse(selected).root;
    for (const segment of selected.slice(current.length).split(path.sep)) {
      current = path.join(current, segment);
      if ((await fs.lstat(current)).isSymbolicLink()) throw fail('FILE_INVALID');
    }
    handle = await fs.open(selected, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const stat = await handle.stat();
    if (await fs.realpath(selected) !== selected) throw fail('FILE_INVALID');
    const currentStat = await fs.lstat(selected);
    if (currentStat.dev !== stat.dev || currentStat.ino !== stat.ino || currentStat.isSymbolicLink()) throw fail('FILE_INVALID');
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > 64 * 1024 || stat.size < 2 || process.platform !== 'win32' && ((stat.mode & 0o077) !== 0 || typeof process.getuid === 'function' && stat.uid !== process.getuid())) throw fail('FILE_INVALID');
    const buffer = Buffer.alloc(64 * 1024 + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > 64 * 1024) throw fail('FILE_INVALID');
    let value;
    try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytesRead))); }
    catch { throw fail('FILE_INVALID'); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail('FILE_INVALID');
    // JSON allows duplicate keys; a secret file must have one unambiguous value per name.
    const source = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytesRead));
    let offset = 0;
    const whitespace = () => { while (/\s/.test(source[offset] ?? '') && offset < source.length) offset++; };
    const string = () => {
      const start = offset;
      if (source[offset++] !== '"') throw fail('VALUE_INVALID');
      while (offset < source.length) {
        const char = source[offset++];
        if (char === '\\') offset++;
        else if (char === '"') return JSON.parse(source.slice(start, offset));
      }
      throw fail('FILE_INVALID');
    };
    whitespace(); offset++; whitespace();
    const seen = new Set();
    while (source[offset] !== '}') {
      const name = string();
      if (seen.has(name)) throw fail('NAMES_MISMATCH');
      seen.add(name); whitespace(); offset++; whitespace(); string(); whitespace();
      if (source[offset] !== ',') break;
      offset++; whitespace();
    }
    const keys = Object.keys(value);
    if (keys.length !== requiredNames.length || requiredNames.some(name => !Object.hasOwn(value, name))) throw fail('NAMES_MISMATCH');
    return requiredNames.map(name => {
      const text = value[name];
      if (typeof text !== 'string' || Buffer.byteLength(text) < 1 || Buffer.byteLength(text) > 16 * 1024 || text.includes('\0')) throw fail('VALUE_INVALID');
      return { name, type: 'secret_text', text };
    });
  } catch (caught) { if (/^COSSACK_PREVIEW_SECRETS_[A-Z_]+$/.test(caught?.code ?? '')) throw caught; throw fail('FILE_INVALID'); }
  finally { await handle?.close(); }
}
