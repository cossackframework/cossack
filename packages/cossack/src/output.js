/** Stable envelope for machine-readable CLI results. Never include secret values. */
let resultSink;

/** The isolated CLI runner sends only framework results over IPC. */
export function setResultSink(sink) { resultSink = sink; }

export function writeResult(command, { data = null, diagnostics = [], ok = true } = {}) {
  const result = { schemaVersion: 1, command, ok, data, diagnostics };
  if (resultSink) resultSink(result);
  else console.log(JSON.stringify(result));
}

const FAILURE_MESSAGES = {
  COSSACK_CREATE_FAILED: 'Project creation failed. Check the destination and recipe; run without --json for diagnostics.',
  COSSACK_FEATURE_ADD_FAILED: 'Feature addition failed. Check the runtime and recipe; run without --json for diagnostics.',
  COSSACK_FEATURE_REMOVE_FAILED: 'Feature removal failed. Check the scaffold manifest; run without --json for diagnostics.',
  COSSACK_ADAPTER_FAILED: 'Adapter switching failed. Check the scaffold manifest and provider; run without --json for diagnostics.',
  COSSACK_DEPLOY_FAILED: 'Deployment failed. Check project dependencies and configuration; run without --json for diagnostics.',
  COSSACK_INSPECTION_FAILED: 'Inspection failed. Check the project configuration; run without --json for diagnostics.',
  COSSACK_ORM_UNAVAILABLE: 'Database tooling is unavailable. Run cossack add database and pnpm install; check package.json and ORM configuration.',
  COSSACK_COMMAND_FAILED: 'Command execution failed. Run without --json for diagnostics.',
  COSSACK_UPGRADE_MANIFEST_UNSUPPORTED: 'Unsupported scaffold manifest. Check its schema version; run without --json for diagnostics.',
};

export function diagnosticCode(error, fallback = 'COSSACK_COMMAND_FAILED') {
  return /^COSSACK_[A-Z0-9_]+$/.test(error?.code ?? '') ? error.code : fallback;
}

/** Generic execution/parser errors may contain arbitrary project values. */
export function diagnosticMessage(error, code = diagnosticCode(error)) {
  return FAILURE_MESSAGES[code] ?? (error?.name === 'SyntaxError' || error?.name === 'YAMLParseError'
    ? 'Cannot parse project configuration. Check its syntax; run without --json for diagnostics.'
    : error?.code === code && /^COSSACK_[A-Z0-9_]+$/.test(code) && typeof error?.message === 'string'
      ? error.message : FAILURE_MESSAGES.COSSACK_COMMAND_FAILED);
}

export function commandFailure(ctx, command, code, message, exitCode = 1) {
  if (ctx.flags.json === true) {
    writeResult(command, { ok: false, diagnostics: [{ code, severity: 'error', message }] });
  } else {
    console.error(message);
  }
  return exitCode;
}
