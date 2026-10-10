import type { Plugin } from 'vite';
import { inspectSchedules, SchedulePreflightError } from './schedules-inspection.js';
/** Validate static metadata before application compilation; never invokes a handler. */
export function cossackSchedules(options: { environment?: string } = {}): Plugin {
    return { name: 'cossack-schedules', enforce: 'pre', async configResolved(config) {
        const result = await inspectSchedules(config.root, options.environment ?? process.env.CLOUDFLARE_ENV);
        if (result.diagnostics.length) throw new SchedulePreflightError(result.diagnostics[0]!.code);
    } };
}
