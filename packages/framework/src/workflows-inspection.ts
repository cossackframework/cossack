/** Read-only Node tooling; declarations never execute a workflow or application. */
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { findCloudflareConfig, readCloudflareDeclarationConfig, resolveConfigRuntime } from './config-preflight.js';
export interface WorkflowDeclaration { name: string; version: number; binding: string; className: string; }
export class WorkflowPreflightError extends Error {
    constructor(readonly code: string) { super('Check src/workflows.json and the selected Cloudflare Workflow bindings.'); }
}
export function validateWorkflowDeclarations(value: unknown): WorkflowDeclaration[] {
    if (!Array.isArray(value) || value.length > 100) throw new WorkflowPreflightError('COSSACK_WORKFLOWS_INVALID');
    const names = new Set<string>(), bindings = new Set<string>();
    return value.map(item => {
        if (!item || typeof item !== 'object' || Object.keys(item).some(key => !['name', 'version', 'binding', 'className'].includes(key))
            || typeof item.name !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(item.name)
            || !Number.isSafeInteger(item.version) || item.version < 1
            || typeof item.binding !== 'string' || !/^[A-Za-z_$][A-Za-z0-9_$]{0,127}$/.test(item.binding)
            || typeof item.className !== 'string' || !/^[A-Za-z_$][A-Za-z0-9_$]{0,127}$/.test(item.className)
            || names.has(item.name) || bindings.has(item.binding)) throw new WorkflowPreflightError('COSSACK_WORKFLOWS_INVALID');
        names.add(item.name); bindings.add(item.binding); return { name: item.name, version: item.version, binding: item.binding, className: item.className };
    });
}
export async function inspectWorkflows(root: string, environment?: string) {
    const diagnostics: { code: string; severity: 'error'; message: string; source: string }[] = [];
    const add = (code: string) => diagnostics.push({ code, severity: 'error', message: 'Check workflow declarations and the selected native provider bindings.', source: 'src/workflows.json' });
    let declarations: WorkflowDeclaration[] = [];
    try { const file = join(root, 'src/workflows.json'); if ((await stat(file)).size > 128 * 1024) throw new Error(); declarations = validateWorkflowDeclarations(JSON.parse(await readFile(file, 'utf8'))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') add('COSSACK_WORKFLOWS_INVALID'); }
    const runtime = await resolveConfigRuntime(root);
    if (declarations.length) {
        if (runtime !== 'cloudflare') add('COSSACK_WORKFLOW_PROVIDER_REQUIRED');
        else try {
            const file = await findCloudflareConfig(root); if (!file) throw new Error();
            const config = await readCloudflareDeclarationConfig(root, file, environment);
            const bindings = config.workflows;
            if (!Array.isArray(bindings) || declarations.some(item => bindings.filter(binding => binding?.binding === item.binding && binding?.class_name === item.className && typeof binding.name === 'string' && binding.name.length > 0).length !== 1)) add('COSSACK_WORKFLOW_BINDINGS_MISMATCH');
        } catch { add('COSSACK_WORKFLOW_CONFIGURATION_UNKNOWN'); }
    }
    return { scope: 'workflows' as const, runtime, environment: environment ?? null, workflows: declarations,
        policy: { execution: 'native-cloudflare', persistence: 'provider-owned', retries: 'step-owned', sideEffects: 'application-idempotency-required' },
        readiness: { declarations: diagnostics.length ? 'invalid' : 'valid', entry: 'not-checked', remote: 'not-checked' }, diagnostics };
}
