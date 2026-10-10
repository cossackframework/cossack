// src/shared/action-identity-scope.ts
//
// Per-call identity for @Server actions invoked over a socket. A shared
// component (e.g. one Durable Object instance) serves many callers, and a
// streaming action keeps running after it releases the action queue, so the
// instance-level identity slot cannot say who is reading `this.user` after an
// `await`. Core declares the injectable slot; the framework wires an
// AsyncLocalStorage-backed scope (mirrors `setRequestContextGetter`).

import type { Context } from 'hono';
import type { User } from './user';

/** @internal Identity of one action invocation, owned by one component. */
export interface ActionIdentity {
    owner: object;
    user: User | undefined;
    context?: Context;
    socket?: unknown;
}

/** @internal Async-context runner. `run` must propagate the identity across awaits. */
export interface ActionIdentityScope {
    run<T>(identity: ActionIdentity, fn: () => T): T;
    get(): ActionIdentity | undefined;
}

let actionIdentityScope: ActionIdentityScope | null = null;

/** @internal Framework wires the async action-identity scope here (once). */
export function setActionIdentityScope(scope: ActionIdentityScope | null): ActionIdentityScope | null {
    const previous = actionIdentityScope;
    actionIdentityScope = scope;
    return previous;
}

/** @internal */
export function getActionIdentityScope(): ActionIdentityScope | null {
    return actionIdentityScope;
}
