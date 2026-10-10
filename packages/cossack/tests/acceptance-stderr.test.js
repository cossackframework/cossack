import { expect, it } from 'vitest';
import { withoutNodeSqliteWarning } from '../../../scripts/acceptance-stderr.mjs';

const warning = '(node:14277) ExperimentalWarning: SQLite is an experimental feature and might change at any time\n'
  + '(Use `node --trace-warnings ...` to show where the warning was created)\n';

it('accepts the known Node SQLite warning with LF or CRLF lines', () => {
  expect(withoutNodeSqliteWarning(warning)).toBe('');
  expect(withoutNodeSqliteWarning(warning.replaceAll('\n', '\r\n'))).toBe('');
});
it('preserves unexpected application output and other experimental warnings', () => {
  expect(withoutNodeSqliteWarning(warning + 'Application failed\n')).toBe('Application failed\n');
  expect(withoutNodeSqliteWarning('(node:1) ExperimentalWarning: other feature\n')).not.toBe('');
});
it('preserves incomplete or changed SQLite warnings for investigation', () => {
  expect(withoutNodeSqliteWarning(warning.split('\n')[0])).not.toBe('');
  expect(withoutNodeSqliteWarning(warning.replace('might change', 'has changed'))).not.toBe('');
});
