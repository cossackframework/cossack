import type { StudioQueryResult, TransportQueryResult, TransportValue } from './types.js';

export function normalizeValue(value: unknown): TransportValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return value;
    return { $type: 'number', value: String(value) };
  }
  if (typeof value === 'bigint') return { $type: 'bigint', value: value.toString() };
  if (value instanceof Date) return { $type: 'date', value: value.toISOString() };
  if (value instanceof ArrayBuffer) {
    return { $type: 'blob', value: Buffer.from(value).toString('base64') };
  }
  if (ArrayBuffer.isView(value)) {
    return {
      $type: 'blob',
      value: Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('base64'),
    };
  }
  return {
    $type: 'unsupported',
    value: (() => {
      try {
        return JSON.stringify(value) ?? String(value);
      } catch {
        return String(value);
      }
    })(),
  };
}

export function normalizeQueryResult(
  result: StudioQueryResult,
  maximumRows = 1_000,
): TransportQueryResult {
  const rows = result.rows.slice(0, maximumRows);
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return {
    columns,
    rows: rows.map((row) => Object.fromEntries(
      Object.entries(row).map(([name, value]) => [name, normalizeValue(value)]),
    )),
    affectedRows: result.affectedRows,
    durationMs: result.durationMs,
    truncated: result.rows.length > maximumRows,
  };
}
