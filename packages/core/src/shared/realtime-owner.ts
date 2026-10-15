import { createContext } from '@cossackframework/renderer';
import './metadata';
import type { PageOptions } from './decorators';

/**
 * Static property that carries a realtime component's build-time registry id.
 * The framework's Vite plugin attaches it in every environment.
 */
export const REALTIME_COMPONENT_ID_PROPERTY = '__cossackRealtimeId';

/**
 * Registry id of a realtime child component class. Only an own property
 * counts: a subclass is a different component and needs its own registration.
 */
export function realtimeComponentId(constructor: unknown): string | undefined {
    if (typeof constructor !== 'function' || !Object.hasOwn(constructor, REALTIME_COMPONENT_ID_PROPERTY)) return undefined;
    const id = (constructor as unknown as Record<string, unknown>)[REALTIME_COMPONENT_ID_PROPERTY];
    return typeof id === 'string' && id ? id : undefined;
}

function transportOf(constructor: unknown): PageOptions['transport'] {
    return typeof constructor === 'function'
        ? (Reflect.getMetadata('page:options', constructor) as PageOptions | undefined)?.transport
        : undefined;
}

/**
 * A child component with its own realtime connection and live instance:
 * `@Component({ transport: 'durable-object', scope })`, registered at build time.
 */
export function isRealtimeComponent(component: unknown): boolean {
    const constructor = (component as { constructor?: unknown } | null)?.constructor;
    return transportOf(constructor) === 'durable-object' && realtimeComponentId(constructor) !== undefined;
}

/** Whether `host` runs its server methods over a realtime connection. */
export function isRealtimeHost(host: unknown): boolean {
    const transport = transportOf((host as { constructor?: unknown } | null)?.constructor);
    return transport === 'durable-object' || transport === 'websocket';
}

/**
 * Provided by a realtime component to its subtree: a descendant without its
 * own transport runs in the realtime component's instance and uses its
 * connection, as a page's children use the page's.
 */
export const RealtimeHostContext = createContext<object | null>(null);

/** Server-computed realtime connection of a bootstrapped page or layout (from its SSR state). */
export interface RealtimeDescriptor {
    owner: 'page' | 'layout';
    target: string;
}

/**
 * Read the realtime descriptor from a bootstrapped owner's serialized state.
 * `null`: the state says the owner has no target for this request (it stays
 * offline and reports a closed connection). `undefined`: the state carries no
 * realtime information. A bare page `realtimeTarget` keeps working.
 */
export function readRealtimeDescriptor(state: unknown): RealtimeDescriptor | null | undefined {
    if (!state || typeof state !== 'object') return undefined;
    if (Object.hasOwn(state, 'realtime')) {
        const value = (state as { realtime?: unknown }).realtime;
        if (!value || typeof value !== 'object') return null;
        const { owner, target } = value as Record<string, unknown>;
        return (owner === 'page' || owner === 'layout') && typeof target === 'string' && target ? { owner, target } : null;
    }
    const target = (state as { realtimeTarget?: unknown }).realtimeTarget;
    return typeof target === 'string' && target ? { owner: 'page', target } : undefined;
}
