import './metadata';
import type { Context } from 'hono';
import { findServerMethodRegistration } from './action-input';
import { RpcError } from './rpc-stream';

export interface ServerActionAuthorizationContext {
    readonly context: Context;
    readonly signal: AbortSignal;
    readonly action: string;
}
export type ServerActionAuthorizer<Input = unknown> = (input: Input, options: ServerActionAuthorizationContext) => boolean | Promise<boolean>;
export type AuthorizationFailure = {
    code: 'COSSACK_AUTH_UNAUTHENTICATED' | 'COSSACK_AUTH_FORBIDDEN';
    message: string;
    status: 401 | 403;
};

/** Structural marker shared with auth without a package dependency; messages are fixed. */
export function getAuthorizationFailure(error: unknown): AuthorizationFailure | undefined {
    if (!error || typeof error !== 'object') return;
    try {
        // Application failures can be arbitrary objects. Do not evaluate an
        // accessor while trying to redact the original exception.
        const code = Object.getOwnPropertyDescriptor(error, 'authorizationCode')?.value
            ?? (error instanceof RpcError ? Object.getOwnPropertyDescriptor(error, 'code')?.value : undefined);
        if (code === 'COSSACK_AUTH_UNAUTHENTICATED') return { code, message: 'Authentication required', status: 401 };
        if (code === 'COSSACK_AUTH_FORBIDDEN') return { code, message: 'Forbidden', status: 403 };
    } catch { /* An uninspectable failure remains an internal error. */ }
}

/** Run trusted metadata on parsed input before invoking an inbound action. */
export async function enforceActionAuthorization(constructor: unknown, action: string, payload: unknown[], context: Context | undefined, signal: AbortSignal): Promise<void> {
    const cancelled = () => { if (signal.aborted) throw new RpcError('COSSACK_RPC_CANCELLED', 'RPC call was cancelled.'); };
    cancelled();
    const registration = findServerMethodRegistration(constructor, action);
    if (!registration || !Object.hasOwn(registration, 'authorize')) return;
    if (typeof registration.authorize !== 'function' || !context || typeof context.get !== 'function') {
        throw new Error('[Cossack] Invalid server action authorization contract or missing request context.');
    }
    let onAbort!: () => void;
    const interrupted = new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(new RpcError('COSSACK_RPC_CANCELLED', 'RPC call was cancelled.'));
        signal.addEventListener('abort', onAbort, { once: true });
        if (signal.aborted) onAbort();
    });
    let accepted:unknown;
    try {
        accepted = await Promise.race([Promise.resolve().then(() => {
            cancelled();
            return (registration.authorize as ServerActionAuthorizer)(payload[0], { context, signal, action });
        }), interrupted]);
        cancelled();
    } catch (error) {
        cancelled();
        const denial = getAuthorizationFailure(error);
        if (denial) throw new RpcError(denial.code, denial.message, { status: denial.status });
        throw new Error('[Cossack] Server action authorization failed.', {cause:error});
    } finally { signal.removeEventListener('abort', onAbort); }
    if (accepted === false) throw new RpcError('COSSACK_AUTH_FORBIDDEN', 'Forbidden', { status: 403 });
    if (accepted !== true) throw new Error('[Cossack] Server action authorization must return a boolean.');
}
