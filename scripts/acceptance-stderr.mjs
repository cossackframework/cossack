/** Node 22 emits this built-in warning when an example imports node:sqlite. */
export function withoutNodeSqliteWarning(stderr) {
  return stderr.replace(/\(node:\d+\) ExperimentalWarning: SQLite is an experimental feature and might change at any time\r?\n\(Use `node --trace-warnings \.\.\.` to show where the warning was created\)\r?\n/g, '');
}
