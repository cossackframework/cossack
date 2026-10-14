/** Largest serialized result the MCP server returns (bytes of UTF-8 JSON). */
export const MAX_INSPECTION_RESULT_BYTES = 4 * 1024 * 1024;

/**
 * Serialize a result inside the worker. Oversized results are rejected before
 * they are structured-cloned into the server thread.
 */
export function encodeInspectionResult(value, limit = MAX_INSPECTION_RESULT_BYTES) {
  const json = JSON.stringify(value);
  if (typeof json !== 'string') return { kind: 'invalid' };
  if (Buffer.byteLength(json) > limit) return { kind: 'too-large' };
  return { kind: 'result', json };
}

/** Decode a worker message into `{ value }` or `{ error }` (a diagnostic code). */
export function decodeInspectionResult(message, limit = MAX_INSPECTION_RESULT_BYTES) {
  if (message?.kind === 'too-large') return { error: 'COSSACK_MCP_RESULT_TOO_LARGE' };
  if (message?.kind !== 'result' || typeof message.json !== 'string') return { error: 'COSSACK_INSPECTION_FAILED' };
  // Defence in depth for workers that skip the encoder; UTF-8 needs at most
  // three bytes per UTF-16 unit, so short strings need no measurement.
  if (message.json.length * 3 > limit && Buffer.byteLength(message.json) > limit) return { error: 'COSSACK_MCP_RESULT_TOO_LARGE' };
  try {
    return { value: JSON.parse(message.json) };
  } catch {
    return { error: 'COSSACK_INSPECTION_FAILED' };
  }
}
