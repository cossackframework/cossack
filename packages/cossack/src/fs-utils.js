import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

/** Check if a path exists. */
export async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** Ensure a directory exists (recursive). */
export async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

/**
 * Write a file unless it exists, honoring ctx.force / ctx.dryRun.
 * Returns one of: 'wrote' | 'skipped' | 'overwrote' | 'dry-run'.
 */
export async function writeFile(target, content, ctx = {}) {
  if (ctx.dryRun) {
    return 'dry-run';
  }
  const alreadyExists = await exists(target);
  if (alreadyExists && !ctx.force) {
    return 'skipped';
  }
  await ensureDir(path.dirname(target));
  await fs.writeFile(target, content, 'utf8');
  return alreadyExists ? 'overwrote' : 'wrote';
}

/** Recursively remove a directory if it is empty of source files. */
export async function removeIfEmptyDir(dir) {
  if (!(await exists(dir))) return false;
  let entries;
  try {
    entries = await fs.readdir(dir);
  } catch {
    return false;
  }
  if (entries.length === 0) {
    await fs.rmdir(dir);
    return true;
  }
  return false;
}

/** Read JSON if it exists, else null. */
export async function readJsonIfExists(p) {
  if (!(await exists(p))) return null;
  try {
    const txt = await fs.readFile(p, 'utf8');
    return JSON.parse(txt);
  } catch {
    return null;
  }
}

/** sha256 hex digest of a string. */
export function hashContent(content) {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/** sha256 hex digest of a file's contents, or null if missing. */
export async function hashFile(p) {
  try {
    const buf = await fs.readFile(p);
    return createHash('sha256').update(buf).digest('hex');
  } catch {
    return null;
  }
}

/** Resolve the project root by walking up from cwd looking for package.json. */
export async function findProjectRoot(start = process.cwd()) {
  let dir = path.resolve(start);
  for (;;) {
    if (await exists(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(start);
    dir = parent;
  }
}

/** List all files under a directory (relative paths, forward slashes). */
export async function listFiles(root) {
  const out = [];
  if (!(await exists(root))) return out;
  async function walk(dir, prefix) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) {
        await fs.realpath(path.join(dir, e.name)).then((d) => {
          // skip symlinked dirs (e.g. node_modules)
        }).catch(() => {});
        if (e.isSymbolicLink()) continue;
        await walk(path.join(dir, e.name), rel);
      } else if (e.isFile()) {
        out.push(rel);
      }
    }
  }
  await walk(root, '');
  return out;
}
