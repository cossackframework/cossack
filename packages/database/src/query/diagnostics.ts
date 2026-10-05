/** Preserve SQL operators/identifiers while excluding literal data and comments. */
export function redactSqlStructure(sql: string): string {
  let result = '', index = 0;
  while (index < sql.length) {
    const rest = sql.slice(index);
    if (rest.startsWith('--') || rest.startsWith('#')) {
      const end = sql.indexOf('\n', index); index = end < 0 ? sql.length : end; result += ' '; continue;
    }
    if (rest.startsWith('/*')) {
      const end = sql.indexOf('*/', index + 2); index = end < 0 ? sql.length : end + 2; result += ' '; continue;
    }
    const dollar = /^\$(?:[a-zA-Z_][a-zA-Z0-9_]*)?\$/.exec(rest)?.[0];
    if (dollar) {
      const end = sql.indexOf(dollar, index + dollar.length); index = end < 0 ? sql.length : end + dollar.length;
      result += '?'; continue;
    }
    if (sql[index] === "'") {
      index++;
      while (index < sql.length) {
        if (sql[index] === '\\') { index += 2; continue; }
        if (sql[index] === "'") { if (sql[index + 1] === "'") { index += 2; continue; } index++; break; }
        index++;
      }
      result += '?'; continue;
    }
    if (sql[index] === '"' || sql[index] === '`') {
      const quote = sql[index++]!; let identifier = '';
      while (index < sql.length) {
        if (sql[index] === quote) { if (sql[index + 1] === quote) { identifier += quote; index += 2; continue; } index++; break; }
        identifier += sql[index++];
      }
      // Quoted tokens can be string literals in SQLite/MySQL. Keep only an
      // anonymous quoted-identifier marker, rather than guessing their meaning.
      result += quote + '<identifier>' + quote; continue;
    }
    const numeric = /^(?:0[xX][a-fA-F0-9]+|\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/.exec(rest)?.[0];
    if (numeric && !/[a-zA-Z0-9_$]/.test(sql[index - 1] ?? '')) { result += '?'; index += numeric.length; continue; }
    result += sql[index++];
  }
  return result.trim().replace(/\s+/g, ' ').slice(0, 8192);
}
