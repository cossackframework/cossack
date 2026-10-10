// shared/runtime-capabilities.ts
//
// Explicit capability model for the supported runtimes (RT-25). Transports,
// realtime coordination, storage, and scheduled handlers differ per runtime;
// agents and build checks must see those differences instead of discovering
// them at deployment. Capability status distinguishes:
//
//   available        The runtime supports it and the required bindings exist.
//   missing-binding  The runtime supports it, but a required binding is absent.
//   adapter-required A separate integration is needed; the built-in adapter does not provide it.
//   unsupported      The current runtime profile does not support it.

export type RuntimeName = 'cloudflare' | 'node' | 'desktop' | 'unknown';

export type CapabilityStatus = 'available' | 'missing-binding' | 'adapter-required' | 'unsupported';

export interface CapabilityRequirement {
    /** Transport protocols pages may use. */
    transports?: readonly ('http' | 'sse' | 'durable-object')[];
    /** Durable, cross-instance realtime coordination (SSE coordinator). */
    realtimeCoordination?: boolean;
    /** Process-local realtime (single-instance WebSocket runtime). */
    processLocalRealtime?: boolean;
    /** Durable page state across runtime restarts (stateful WebSocket pages). */
    durableState?: boolean;
    /** Cron/scheduled handlers. */
    scheduledHandlers?: boolean;
    /** Serverless object storage (R2-style bindings). */
    serverlessStorage?: boolean;
    /** Named native Cloudflare bindings required by selected features. */
    cloudflareBindings?: readonly string[];
    /** Direct filesystem access. */
    filesystem?: boolean;
}

interface RuntimeProfile extends Omit<RequirementSet, 'cloudflareBindings'> {
    cloudflareBindings: boolean;
    /** Supported by the host, but not dispatched by the built-in runtime adapter. */
    adapterRequirements?: readonly (keyof RequirementSet)[];
    /** Bindings that upgrade a capability from missing-binding to available. */
    bindingRequirements: Partial<Record<keyof RequirementSet, readonly string[]>>;
}

type RequirementSet = Required<Pick<CapabilityRequirement,
    'transports' | 'realtimeCoordination' | 'processLocalRealtime' | 'scheduledHandlers'
    | 'serverlessStorage' | 'filesystem' | 'durableState' | 'cloudflareBindings'>>;

const HTTP_ONLY: readonly ('http' | 'sse' | 'durable-object')[] = ['http'];

const PROFILES: Record<Exclude<RuntimeName, 'unknown'>, RuntimeProfile> = {
    cloudflare: {
        cloudflareBindings: true,
        transports: ['http', 'sse', 'durable-object'],
        realtimeCoordination: true,
        processLocalRealtime: false,
        durableState: true,
        scheduledHandlers: true,
        serverlessStorage: true,
        filesystem: false,
        bindingRequirements: {
            realtimeCoordination: ['COSSACK_SSE'],
            durableState: ['COSSACK_OBJECT'],
            serverlessStorage: [],
        },
    },
    node: {
        cloudflareBindings: false,
        adapterRequirements: ['scheduledHandlers'],
        transports: ['http', 'sse', 'durable-object'],
        realtimeCoordination: false,
        processLocalRealtime: true,
        durableState: false,
        scheduledHandlers: true,
        serverlessStorage: false,
        filesystem: true,
        bindingRequirements: {},
    },
    desktop: {
        cloudflareBindings: false,
        // Desktop keeps an HTTP-only native boundary by design.
        transports: HTTP_ONLY,
        realtimeCoordination: false,
        processLocalRealtime: false,
        durableState: false,
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

/** A selected feature's requirements and the declaration that selected it. */
export interface CapabilityUse {
    feature: string;
    source: { file: string; line?: number; column?: number };
    requires: CapabilityRequirement;
}

export interface CapabilityDiagnostic {
    code: 'COSSACK_CAPABILITY_UNSUPPORTED' | 'COSSACK_CAPABILITY_BINDING_MISSING' | 'COSSACK_CAPABILITY_ADAPTER_REQUIRED';
    feature: string;
    source: CapabilityUse['source'];
    capability: keyof CapabilityRequirement;
    message: string;
    missingBindings: string[];
}

/** Shared by build/recipe consumers; binding names alone are sufficient. */
export function checkCapabilityRequirements(
    runtime: RuntimeName,
    uses: readonly CapabilityUse[],
    bindingNames: readonly string[] = [],
): CapabilityDiagnostic[] {
    const env = Object.fromEntries(bindingNames.map(name => [name, true]));
    return uses.flatMap(use => Object.entries(use.requires).flatMap(([key, requirement]) => {
        if (requirement === false || requirement === undefined) return [];
        const capability = key as keyof CapabilityRequirement;
        const result = evaluateCapability(runtime, capability, env, requirement);
        if (result.status === 'available') return [];
        return [{
            code: result.status === 'unsupported' ? 'COSSACK_CAPABILITY_UNSUPPORTED' as const
                : result.status === 'adapter-required' ? 'COSSACK_CAPABILITY_ADAPTER_REQUIRED' as const
                : 'COSSACK_CAPABILITY_BINDING_MISSING' as const,
            feature: use.feature,
            source: use.source,
            capability,
            missingBindings: result.missingBindings,
            message: `${use.feature} requires ${capability} on ${runtime}: ${formatCapabilityResult(result)}.`,
        }];
    }));
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
        const requested = Array.isArray(requirement) ? requirement : profile.transports;
        const results = requested.map(transport => evaluateTransportCapability(runtime, transport, env));
        if (results.some(result => result.status === 'unsupported')) return { capability, status: 'unsupported', missingBindings: [] };
        const missingBindings = [...new Set(results.flatMap(result => result.missingBindings))];
        return { capability, status: missingBindings.length ? 'missing-binding' : 'available', missingBindings };
    }
    const supported = profile[capability] === true;
    if (!supported) return { capability, status: 'unsupported', missingBindings: [] };
    if (requirement === false) return { capability, status: 'unsupported', missingBindings: [] };
    if (profile.adapterRequirements?.includes(capability)) return { capability, status: 'adapter-required', missingBindings: [] };
    const required: readonly string[] = capability === 'cloudflareBindings' && Array.isArray(requirement)
        ? [...new Set(requirement)] : profile.bindingRequirements[capability] ?? [];
    const present = env ?? {};
    const missingBindings = required.filter(name => present[name] === undefined || present[name] === null);
    return missingBindings.length
        ? { capability, status: 'missing-binding', missingBindings }
        : { capability, status: 'available', missingBindings: [] };
}

/** Whether a page transport can run on the runtime at all. */
export function supportsTransport(runtime: RuntimeName, transport: string): boolean {
    const profile = profileFor(runtime);
    return profile ? profile.transports.some(candidate => candidate === transport) : false;
}

/** Check a specific page transport; support does not imply durable state. */
export function evaluateTransportCapability(
    runtime: RuntimeName,
    transport: string,
    env: Record<string, unknown> | undefined,
): CapabilityResult {
    const capability = 'transports';
    if (!supportsTransport(runtime, transport)) return { capability, status: 'unsupported', missingBindings: [] };
    const binding = runtime === 'cloudflare'
        ? transport === 'sse' ? 'COSSACK_SSE' : transport === 'durable-object' ? 'COSSACK_OBJECT' : undefined
        : undefined;
    const missingBindings = binding && (env?.[binding] === undefined || env?.[binding] === null) ? [binding] : [];
    return { capability, status: missingBindings.length ? 'missing-binding' : 'available', missingBindings };
}

/** All capability results for a runtime, for inspection and CLI output. */
export function describeRuntimeCapabilities(
    runtime: RuntimeName,
    env: Record<string, unknown> | undefined,
): Record<keyof RequirementSet, CapabilityResult> {
    const profile = profileFor(runtime);
    const capabilities: Array<keyof RequirementSet> = [
        'transports', 'realtimeCoordination', 'processLocalRealtime',
        'scheduledHandlers', 'serverlessStorage', 'filesystem', 'durableState', 'cloudflareBindings',
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
    if (result.status === 'adapter-required') return `${result.capability}: requires an adapter integration; not provided by the built-in runtime adapter`;
    if (result.status === 'missing-binding') {
        return `${result.capability}: missing binding(s) ${result.missingBindings.join(', ')}`;
    }
    return `${result.capability}: unsupported on this runtime`;
}
