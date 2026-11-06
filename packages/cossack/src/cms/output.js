/** Human output for `cossack cms`: aligned columns for lists, pretty JSON for everything else. */

export function formatTable(rows, columns) {
  if (!rows.length) return '(none)';
  const specs = columns.map(column => typeof column === 'string' ? { name: column, value: row => row[column] } : column);
  const cells = rows.map(row => specs.map(spec => cell(spec.value(row))));
  const widths = specs.map((spec, index) => Math.min(60, Math.max(spec.name.length, ...cells.map(line => line[index].length))));
  const line = values => values.map((value, index) => index === values.length - 1 ? value : value.slice(0, widths[index]).padEnd(widths[index])).join('  ').trimEnd();
  return [line(specs.map(spec => spec.name.toUpperCase())), ...cells.map(line)].join('\n');
}

function cell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value).replaceAll(/\s+/g, ' ');
}

export function formatJson(value) {
  return JSON.stringify(value, null, 2);
}
