import { detectProjectRuntime } from '@cossackframework/scaffold';
import { describeRuntimeCapabilities, evaluateTransportCapability, checkCapabilityRequirements } from '@cossackframework/framework/runtime-capabilities';
import { inspectDeployment } from './deployment.js';

/** Binding presence from parsed configuration, never proof of remote readiness. */
export async function inspectRuntimeMetadata(root, pages, environment, requirements = []) {
  const name = await detectProjectRuntime(root);
  if (!name) return { name: 'unknown', status: 'unknown', diagnostics: [], transports: [] };
  let bindings = [];
  if (name === 'cloudflare') {
    try {
      const deployment = await inspectDeployment(root, environment);
      bindings = deployment.summary.bindings.map(binding => binding.name);
    } catch {
      return { name, status: 'unknown', diagnostics: [{ code: 'COSSACK_RUNTIME_BINDINGS_UNKNOWN', severity: 'error', message: 'Runtime bindings could not be read from deployment configuration.' }], transports: [] };
    }
  }
  const env = Object.fromEntries(bindings.map(binding => [binding, true]));
  const transports = pages.filter(page => page.extraction.method === 'ast').map(page => ({
    route: page.route, source: page.source, transport: page.transport ?? 'http',
    ...evaluateTransportCapability(name, page.transport ?? 'http', env),
  }));
  const diagnostics = transports.filter(result => result.status !== 'available').map(result => ({
    code: result.status === 'unsupported' ? 'COSSACK_TRANSPORT_UNSUPPORTED' : 'COSSACK_TRANSPORT_BINDING_MISSING',
    severity: 'error', source: result.source,
    message: result.status === 'unsupported' ? 'The selected runtime does not support this route transport.'
      : `Route transport requires binding(s): ${result.missingBindings.join(', ')}.`,
  }));
  diagnostics.push(...checkCapabilityRequirements(name, requirements, bindings)
    .map(result => ({ ...result, severity: 'error', source: result.source.file })));
  diagnostics.push(...checkCapabilityRequirements(name, pages
    .filter(page => page.extraction.method === 'ast' && page.transport === 'durable-object' && page.stateful === true)
    .map(page => ({ feature: 'stateful page', source: { file: page.source }, requires: { durableState: true } })), bindings)
    .map(result => ({ ...result, severity: 'error', source: result.source.file })));
  return { name, status: 'inspected', environment: environment ?? null, scope: 'Configuration presence only; remote resources and runtime setup are not verified.', bindings, capabilities: describeRuntimeCapabilities(name, env), transports, diagnostics };
}
