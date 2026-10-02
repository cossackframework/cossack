/** Stable envelope for machine-readable CLI results. Never include secret values. */
export function writeResult(command, { data = null, diagnostics = [], ok = true } = {}) {
  console.log(JSON.stringify({ schemaVersion: 1, command, ok, data, diagnostics }));
}

export function commandFailure(ctx, command, code, message, exitCode = 1) {
  if (ctx.flags.json === true) {
    writeResult(command, { ok: false, diagnostics: [{ code, severity: 'error', message }] });
  } else {
    console.error(message);
  }
  return exitCode;
}
