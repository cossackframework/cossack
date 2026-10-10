import fs from 'node:fs/promises';
import path from 'node:path';

export function exportTargets(value, conditions = []) {
  function visit(value, conditions) {
    if (typeof value === 'string' || value === null) return {
      rows: [{ conditions, target: value }], terminal: true, error: value !== null && targetKind(value) === 'invalid',
    };
    const rows = [];
    if (Array.isArray(value)) {
      if (!value.length) return { rows: [{ conditions, target: null }], terminal: true };
      let error = false;
      for (const [index, entry] of value.entries()) {
        const next = visit(entry, [...conditions, `fallback:${index}`]); rows.push(...next.rows);
        if (next.terminal && !next.error) return { rows, terminal: true };
        error = !!next.error;
      }
      return { rows, terminal: true, error };
    } else if (value && typeof value === 'object') {
      for (const [key, entry] of Object.entries(value)) {
        const next = visit(entry, [...conditions, key]); rows.push(...next.rows);
        if (key === 'default' && next.terminal) return { rows, terminal: true, error: next.error };
      }
    }
    return { rows, terminal: false };
  }
  return visit(value, conditions).rows;
}
export function targetKind(target) {
  if (!target.startsWith('./')) return 'invalid';
  try {
    const decoded = decodeURIComponent(target.slice(2));
    if (decoded.split(/[\\/]/).some(segment => ['', '.', '..', 'node_modules'].includes(segment.toLowerCase()))) return 'invalid';
    if (/%2f|%5c/i.test(target) || target.includes('\\')) return 'invalid';
  } catch { return 'invalid'; }
  // URL-encoded literal stars and URL suffixes need URL-aware matching, not filesystem globbing.
  if (/[?#%]/.test(target)) return 'unsupported-url-target';
  return 'valid';
}
export async function describeExport(folder, subpath, value) {
  const entries = await Promise.all(exportTargets(value).map(async entry => {
    if (entry.target === null) return { ...entry, status: 'blocked' };
    const kind = targetKind(entry.target);
    if (kind !== 'valid') return { conditions: entry.conditions, target: kind === 'invalid' ? null : entry.target, status: kind };
    if (subpath.includes('*') || entry.target.includes('*')) return { ...entry, status: 'pattern' };
    try { return { ...entry, status: (await fs.stat(path.join(folder, entry.target))).isFile() ? 'present' : 'missing' }; }
    catch { return { ...entry, status: 'missing' }; }
  }));
  return { subpath, targets: entries, runtime: 'not-verified' };
}
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function matcher(target) {
  const [first, ...rest] = target.split('*');
  return new RegExp('^' + escape(first) + rest.map((part, index) => (index ? '\\k<subpath>' : '(?<subpath>.+)') + escape(part)).join('') + '$');
}
function replacement(key, subpath) {
  const [prefix, suffix] = key.split('*');
  return subpath.startsWith(prefix) && subpath.endsWith(suffix) && subpath.length >= key.length
    ? subpath.slice(prefix.length, subpath.length - suffix.length) : null;
}
function substitute(value, captured) {
  if (typeof value === 'string') return value.replaceAll('*', captured);
  if (Array.isArray(value)) return value.map(entry => substitute(entry, captured));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, substitute(entry, captured)]));
  return value;
}

/** Enumerate concrete subpaths while honoring exact overrides and pattern specificity. */
export async function discoverExports(folder, name, map) {
  const entries = await Promise.all(Object.entries(map).map(async ([subpath, value]) => ({
    import: subpath === '.' ? name : name + subpath.slice(1), ...await describeExport(folder, subpath, value),
  })));
  const patterns = Object.keys(map).filter(key => key.split('*').length === 2 && key.startsWith('./'))
    .sort((a,b) => b.indexOf('*') - a.indexOf('*') || b.length - a.length);
  const reasons = new Set(), candidates = new Set(), scanned = new Map();
  let remaining = 20_000;
  async function filesUnder(prefix) {
    if (scanned.has(prefix)) return scanned.get(prefix);
    const files = [];
    async function walk(relative) {
      let children;
      try { children = await fs.readdir(path.join(folder, relative), { withFileTypes: true }); }
      catch (error) { if (error.code !== 'ENOENT') reasons.add('directory-unreadable'); return; }
      for (const child of children.sort((a,b) => a.name.localeCompare(b.name))) {
        if (--remaining < 0) { reasons.add('file-limit'); break; }
        if (child.name.toLowerCase() === 'node_modules') continue;
        const next = path.posix.join(relative, child.name);
        if (child.isSymbolicLink()) { reasons.add('symlink-skipped'); continue; }
        if (child.isDirectory()) await walk(next);
        else if (child.isFile()) files.push('./' + next.replace(/^\.\//,''));
      }
    }
    // Do not traverse a symlink in the static prefix either.
    let current = '';
    for (const segment of prefix.split('/').filter(segment => segment && segment !== '.')) {
      current = path.join(current, segment);
      try { if ((await fs.lstat(path.join(folder,current))).isSymbolicLink()) { reasons.add('symlink-skipped'); scanned.set(prefix, files); return files; } }
      catch (error) { if (error.code !== 'ENOENT') reasons.add('directory-unreadable'); scanned.set(prefix, files); return files; }
    }
    await walk(prefix); scanned.set(prefix, files); return files;
  }
  for (const key of Object.keys(map).filter(key => key.includes('*'))) {
    if (!patterns.includes(key)) { reasons.add('unsupported-pattern-key'); continue; }
    for (const {target} of exportTargets(map[key])) {
      if (target === null) continue;
      if (targetKind(target) !== 'valid') { reasons.add('unsupported-pattern-target'); continue; }
      if (!target.includes('*')) { reasons.add('constant-pattern-target'); continue; }
      const prefix = target.slice(0,target.lastIndexOf('/',target.indexOf('*'))) || '.';
      const match = matcher(target);
      const declarationTarget = target.replace(/\.(mjs|cjs|js)$/, (_, ext) => ext === 'mjs' ? '.d.mts' : ext === 'cjs' ? '.d.cts' : '.d.ts');
      const declarationMatch = declarationTarget !== target ? matcher(declarationTarget) : null;
      for (const file of await filesUnder(prefix)) {
        const captured = match.exec(file)?.[1] ?? declarationMatch?.exec(file)?.[1];
        if (!captured) continue;
        if (targetKind('./' + captured) === 'valid' && !captured.includes('*')) candidates.add(key.replace('*',captured));
        else reasons.add('unsupported-file-name');
      }
    }
  }
  for (const subpath of [...candidates].sort()) {
    if (Object.hasOwn(map,subpath)) continue; // The exact row already describes the effective mapping, including null.
    const key = patterns.find(key => replacement(key,subpath) !== null);
    if (!key) continue;
    const described = await describeExport(folder,subpath,substitute(map[key],replacement(key,subpath)));
    // Do not advertise paths that a more-specific private exclusion blocks.
    if (described.targets.length && described.targets.every(target => target.status === 'blocked')) continue;
    entries.push({ import: name + subpath.slice(1), pattern: key, ...described });
  }
  return { entries, discovery: { status: reasons.size ? 'partial' : 'complete', reasons: [...reasons].sort() } };
}
