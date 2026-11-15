import { diff3Merge } from 'node-diff3';

/** Files larger than this are never merged. */
export const MERGE_SIZE_LIMIT = 1024 * 1024;

const MARKER = /^(<{7} |\|{7} |={7}$|>{7} )/m;

/** True when the text holds a conflict marker line that `mergeText` writes. */
export function hasConflictMarkers(text) {
  return MARKER.test(String(text).replace(/\r\n/g, '\n'));
}

function decode(content) {
  if (typeof content === 'string') return content.includes('\0') ? null : content;
  if (content.includes(0)) return null;
  try { return new TextDecoder('utf-8', { fatal: true }).decode(content); }
  catch { return null; }
}

/**
 * Three-way line merge of an owned file: `base` is the upstream text the file descends from,
 * `ours` is the file on disk, `theirs` is the new upstream text.
 *
 * Returns `{ status: 'clean', text }`, or `{ status: 'conflict', text, conflicts }` where `text`
 * carries git-style markers, or `{ status: 'unmergeable', reason }` for binary, non-UTF-8 and
 * oversized content. Lines are compared on LF and written back with the line endings of `ours`.
 */
export function mergeText(base, ours, theirs, options = {}) {
  const labels = { ours: 'yours', base: 'base', theirs: 'cossack', ...options.labels };
  const sizes = [base, ours, theirs].map(content => typeof content === 'string' ? Buffer.byteLength(content) : content.length);
  if (sizes.some(size => size > MERGE_SIZE_LIMIT)) return { status: 'unmergeable', reason: 'too-large' };
  const texts = [base, ours, theirs].map(decode);
  if (texts.some(text => text === null)) return { status: 'unmergeable', reason: 'binary' };
  const crlf = (texts[1].match(/\r\n/g) ?? []).length * 2 > (texts[1].match(/\n/g) ?? []).length;
  const [o, a, b] = texts.map(text => text.replace(/\r\n/g, '\n').split('\n'));
  const lines = [];
  let conflicts = 0;
  for (const region of diff3Merge(a, o, b, { excludeFalseConflicts: true })) {
    if (region.ok) { lines.push(...region.ok); continue; }
    conflicts++;
    lines.push(`<<<<<<< ${labels.ours}`, ...region.conflict.a, `||||||| ${labels.base}`, ...region.conflict.o,
      '=======', ...region.conflict.b, `>>>>>>> ${labels.theirs}`);
  }
  // A conflict in the last region would otherwise lose the final line break the sides share.
  if (conflicts && lines.at(-1) !== '' && a.at(-1) === '' && b.at(-1) === '') lines.push('');
  const text = lines.join(crlf ? '\r\n' : '\n');
  return conflicts ? { status: 'conflict', text, conflicts } : { status: 'clean', text };
}
