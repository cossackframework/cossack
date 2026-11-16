import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

/** Upstream text of owned files, named by its sha256. Committed, so a fresh clone can merge. */
export const BASE_DIRECTORY = '.cossack/base';

const SHA256 = /^[0-9a-f]{64}$/;
const sha256 = content => createHash('sha256').update(content).digest('hex');

/** Store one upstream text and return its name. */
export async function putBase(projectDir, content) {
  const name = sha256(content);
  const file = path.join(projectDir, BASE_DIRECTORY, name);
  try { await fs.access(file); }
  catch {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content);
  }
  return name;
}

/** The stored text, or null when the manifest names none or the blob is gone. */
export async function readBase(projectDir, name) {
  if (typeof name !== 'string' || !SHA256.test(name)) return null;
  try {
    const content = await fs.readFile(path.join(projectDir, BASE_DIRECTORY, name));
    return sha256(content) === name ? content : null;
  } catch { return null; }
}

function collect(value, into) {
  if (!value || typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'base' && typeof entry === 'string') into.add(entry);
    else collect(entry, into);
  }
}

/** Delete every blob that neither the scaffold manifest nor the plugin manifest names. */
export async function pruneBases(projectDir) {
  const referenced = new Set();
  for (const manifest of ['.cossack/scaffold.json', '.cossack/plugins.json']) {
    let source;
    try { source = await fs.readFile(path.join(projectDir, manifest), 'utf8'); }
    catch { continue; }
    // An unreadable manifest must not empty the store.
    try { collect(JSON.parse(source), referenced); } catch { return []; }
  }
  const directory = path.join(projectDir, BASE_DIRECTORY);
  let names;
  try { names = await fs.readdir(directory); } catch { return []; }
  const removed = [];
  for (const name of names) {
    if (!SHA256.test(name) || referenced.has(name)) continue;
    await fs.rm(path.join(directory, name), { force: true });
    removed.push(name);
  }
  return removed;
}
