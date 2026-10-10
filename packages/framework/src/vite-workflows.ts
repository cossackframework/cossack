import type { Plugin } from 'vite';
import { inspectWorkflows, WorkflowPreflightError } from './workflows-inspection.js';
export function cossackWorkflows(options: { environment?: string } = {}): Plugin {
    return { name: 'cossack-workflows', enforce: 'pre', async configResolved(config) {
        const result = await inspectWorkflows(config.root, options.environment ?? process.env.CLOUDFLARE_ENV);
        if (result.diagnostics.length) throw new WorkflowPreflightError(result.diagnostics[0]!.code);
    } };
}
