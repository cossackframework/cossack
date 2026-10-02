import type { Context } from 'hono';

export const RESPONSE_LIFETIME_KEY = 'cossack:response-lifetime';

/** Structural middleware contract: libraries need no dependency on framework. */
export class ResponseLifetime {
    private retained = false;
    private closed = false;
    private callbacks: Array<() => Promise<void>> = [];
    private completion?: Promise<void>;

    deferCleanup(cleanup: () => Promise<void>): boolean {
        if (!this.retained || this.closed) return false;
        this.callbacks.push(cleanup);
        return true;
    }

    retain(): () => Promise<void> {
        this.retained = true;
        return () => this.completion ??= this.dispose();
    }

    private async dispose(): Promise<void> {
        this.closed = true;
        const errors: unknown[] = [];
        for (const cleanup of this.callbacks.splice(0)) {
            try { await cleanup(); } catch (error) { errors.push(error); }
        }
        if (errors.length) throw new AggregateError(errors, 'Response resource cleanup failed.');
    }
}

export function retainResponseLifetime(context: Context): (() => Promise<void>) | undefined {
    return (context.get(RESPONSE_LIFETIME_KEY) as ResponseLifetime | undefined)?.retain();
}
