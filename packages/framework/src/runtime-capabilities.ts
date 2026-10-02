// src/runtime-capabilities.ts
//
// Explicit capability model for the supported runtimes (RT-25). Transports,
// realtime coordination, storage, and scheduled handlers differ per runtime;
// agents and build checks must see those differences instead of discovering
// them at deployment. Capability status distinguishes:
//
//   available        The runtime supports it and the required bindings exist.
//   missing-binding  The runtime supports it, but a required binding is absent.
//   unsupported      The runtime cannot provide it (an adapter cannot help).

export type RuntimeName = 'cloudflare' | 'node' | 'deno' | 'desktop' | 'unknown';

export type CapabilityStatus = 'available' | 'missing-binding' | 'unsupported';

export interface CapabilityRequirement {
    /** Transport protocols pages may use. */
    transports?: readonly ('http' | 'sse' | 'durable-object')[];
    /** Durable, cross-instance realtime coordination (SSE coordinator). */
    realtimeCoordination?: boolean;
    /** Process-local realtime (single-instance WebSocket runtime). */
    processLocalRealtime?: boolean;
    /** Cron/scheduled handlers. */
    scheduledHandlers?: boolean;
    /** Serverless object storage (R2-style bindings). */
    serverlessStorage?: boolean;
    /** Direct filesystem access. */
    filesystem?: boolean;
}

interface RuntimeProfile extends RequirementSet {
    /** Bindings that upgrade a capability from missing-binding to available. */
    bindingRequirements: Partial<Record<keyof RequirementSet, readonly string[]>>;
}

type RequirementSet = Required<Pick<CapabilityRequirement,
    'transports' | 'realtimeCoordination' | 'processLocalRealtime' | 'scheduledHandlers'
    | 'serverlessStorage' | 'filesystem'>>;

const HTTP_ONLY: readonly ('http' | 'sse' | 'durable-object')[] = ['http'];

const PROFILES: Record<Exclude<RuntimeName, 'unknown'>, RuntimeProfile> = {
    cloudflare: {
        transports: ['http', 'sse', 'durable-object'],
        realtimeCoordination: true,
        processLocalRealtime: false,
        scheduledHandlers: true,
        serverlessStorage: true,
        filesystem: false,
        bindingRequirements: {
            transports: ['ASSETS'],
            realtimeCoordination: ['COSSACK_SSE'],
            serverlessStorage: [],
        },
    },
    node: {
        transports: ['http', 'sse'],
        realtimeCoordination: false,
        processLocalRealtime: true,
        scheduledHandlers: true,
        serverlessStorage: false,
        filesystem: true,
        bindingRequirements: {},
    },
    deno: {
        transports: ['http', 'sse'],
        realtimeCoordination: false,
        processLocalRealtime: true,
        scheduledHandlers: true,
        serverlessStorage: false,
        filesystem: true,
        bindingRequirements: {},
    },
    desktop: {
        // Desktop keeps an HTTP-only native boundary by design.
        transports: HTTP_ONLY,
        realtimeCoordination: false,
        processLocalRealtime: false,
        scheduledHandlers: false,
        serverlessStorage: false,
        filesystem: true,
        bindingRequirements: {},
    },
};

export interface CapabilityResult {
    capability: keyof RequirementSet;
    status: CapabilityStatus;
    /** Missing binding names (never values) when status is missing-binding. */
    missingBindings: string[];
}

function profileFor(runtime: RuntimeName): RuntimeProfile | undefined {
    return runtime === 'unknown' ? undefined : PROFILES[runtime];
}

/**
 * Evaluate one capability for a runtime against the actual environment
 * bindings. `env` is the request/build environment binding map; only key
 * presence is inspected, never values.
 */
export function evaluateCapability(
    runtime: RuntimeName,
    capability: keyof RequirementSet,
    env: Record<string, unknown> | undefined,
    requirement?: unknown,
): CapabilityResult {
    const profile = profileFor(runtime);
    if (!profile) {
        return { capability, status: 'unsupported', missingBindings: [] };
    }
    if (capability === 'transports') {
        // Transport support is a set question, answered by the caller with the
        // page's transport; see supportsTransport.
        return { capability, status: 'available', missingBindings: [] };
    }
    const supported = profile[capability] === true;
    if (!supported) return { capability, status: 'unsupported', missingBindings: [] };
    if (requirement === false) return { capability, status: 'unsupported', missingBindings: [] };
    const required = profile.bindingRequirements[capability] ?? [];
    const present = env ?? {};
    const missingBindings = required.filter(name => present[name] === undefined || present[name] === null);
    return missingBindings.length
        ? { capability, status: 'missing-binding', missingBindings }
        : { capability, status: 'available', missingBindings: [] };
}

/** Whether a page transport can run on the runtime at all. */
export function supportsTransport(runtime: RuntimeName, transport: 'http' | 'sse' | 'durable-object'): boolean {
    const profile = profileFor(runtime);
    return profile ? profile.transports.includes(transport) : false;
}

/** All capability results for a runtime, for inspection and CLI output. */
export function describeRuntimeCapabilities(
    runtime: RuntimeName,
    env: Record<string, unknown> | undefined,
): Record<keyof RequirementSet, CapabilityResult> {
    const profile = profileFor(runtime);
    const capabilities: Array<keyof RequirementSet> = [
        'transports', 'realtimeCoordination', 'processLocalRealtime',
        'scheduledHandlers', 'serverlessStorage', 'filesystem',
    ];
    const results = {} as Record<keyof RequirementSet, CapabilityResult>;
    for (const capability of capabilities) {
        results[capability] = profile
            ? evaluateCapability(runtime, capability, env)
            : { capability, status: 'unsupported', missingBindings: [] };
    }
    return results;
}

/** Human/agent-readable summary line for diagnostics (names only). */
export function formatCapabilityResult(result: CapabilityResult): string {
    if (result.status === 'available') return `${result.capability}: available`;
    if (result.status === 'missing-binding') {
        return `${result.capability}: missing binding(s) ${result.missingBindings.join(', ')}`;
    }
    return `${result.capability}: unsupported on this runtime`;
}
