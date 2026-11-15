import { diff3Merge, diffComm } from 'node-diff3';

/** Files larger than this are never merged. */
export const MERGE_SIZE_LIMIT = 1024 * 1024;

/** True when the text holds an opening and a closing conflict marker line, as `mergeText` writes them. */
export function hasConflictMarkers(text) {
  const normalized = String(text).replace(/\r\n/g, '\n');
  return /^<{7} /m.test(normalized) && /^>{7} /m.test(normalized);
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

/**
 * A line diff of two texts as lines that begin with a space (unchanged), `-` (only in `before`)
 * or `+` (only in `after`), with unchanged runs cut to `context` lines around each change.
 * An empty string means no difference. Binary content gives null.
 */
export function diffLines(before, after, context = 3) {
  const [a, b] = [before, after].map(decode);
  if (a === null || b === null) return null;
  const lines = [];
  for (const part of diffComm(a.replace(/\r\n/g, '\n').split('\n'), b.replace(/\r\n/g, '\n').split('\n'))) {
    if (part.common) lines.push(...part.common.map(line => ({ mark: ' ', line })));
    else lines.push(...part.buffer1.map(line => ({ mark: '-', line })), ...part.buffer2.map(line => ({ mark: '+', line })));
  }
  const keep = new Set();
  lines.forEach((entry, index) => { if (entry.mark !== ' ') for (let near = index - context; near <= index + context; near++) keep.add(near); });
  const output = [];
  let previous = -1;
  lines.forEach((entry, index) => {
    if (!keep.has(index)) return;
    if (previous >= 0 && index > previous + 1) output.push('...');
    output.push(entry.mark + entry.line);
    previous = index;
  });
  return output.join('\n');
}
