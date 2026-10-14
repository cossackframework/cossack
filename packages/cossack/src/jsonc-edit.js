import ts from 'typescript-api';

/**
 * Comment-preserving JSON/JSONC editing. Values are located with the
 * TypeScript JSON parser and edits replace or insert only the affected byte
 * ranges, so unrelated formatting and comments stay untouched.
 */

/** Parse JSON/JSONC text that must contain an object. Returns null when invalid. */
export function parseJsoncObject(text, file = 'config.jsonc') {
  const source = ts.parseJsonText(file, text);
  const errors = [...source.parseDiagnostics];
  const value = ts.convertToObject(source, (_node, message) => errors.push(message));
  if (errors.length || !value || typeof value !== 'object' || Array.isArray(value)) return null;
  return { source, value, root: source.statements[0]?.expression };
}

/** The initializer of an authored property, if any. */
export function jsoncProperty(node, key) {
  return node?.properties?.find(item => item.name?.text === key)?.initializer;
}

/** Leading whitespace of the line containing `offset`. */
function indentation(text, offset) {
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
  return /^[ \t]*/.exec(text.slice(lineStart, offset))[0];
}

/**
 * Collect `set(node, key, value)` edits against `text` and apply them at once.
 * `apply()` throws `{ code: 'COSSACK_JSONC_EDIT_AMBIGUOUS' }` when two edits
 * target the same position in incompatible ways.
 */
export function createJsoncEditor(text, source) {
  const edits = [];
  const set = (node, key, value) => {
    const existing = jsoncProperty(node, key);
    if (existing) {
      if (text.slice(existing.getStart(source), existing.end) !== JSON.stringify(value)) {
        edits.push({ start: existing.getStart(source), end: existing.end, text: JSON.stringify(value) });
      }
      return;
    }
    const last = node.properties.at(-1);
    const comma = last && !node.properties.hasTrailingComma ? ',' : '';
    // Insert next to the last authored property rather than replacing its comments.
    const position = last ? last.end + (node.properties.hasTrailingComma ? 1 : 0) : node.getStart(source) + 1;
    const indent = last ? indentation(text, last.getStart(source)) : indentation(text, node.getStart(source)) + '  ';
    const entry = `\n${indent}${JSON.stringify(key)}: ${JSON.stringify(value)},`;
    const prior = edits.find(edit => edit.start === position && edit.end === position);
    if (prior) prior.text += entry;
    else edits.push({ start: position, end: position, text: `${comma}${entry}` });
  };
  const apply = () => {
    const positions = new Set();
    for (const edit of edits) {
      if (positions.has(edit.start)) {
        throw Object.assign(new Error('Ambiguous configuration edits require manual changes.'), { code: 'COSSACK_JSONC_EDIT_AMBIGUOUS' });
      }
      positions.add(edit.start);
    }
    let next = text;
    for (const edit of [...edits].sort((a, b) => b.start - a.start)) next = next.slice(0, edit.start) + edit.text + next.slice(edit.end);
    return next;
  };
  return { set, apply };
}
