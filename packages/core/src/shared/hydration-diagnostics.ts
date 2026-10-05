import type { HydrationDiagnosticMetadata } from '@cossackframework/renderer';

/** Safe authored boundary identity. Never retain an absolute source directory. */
export function hydrationBoundaryMetadata(ctor: Function): HydrationDiagnosticMetadata {
    const source = Object.getOwnPropertyDescriptor(ctor, '__source')?.value;
    const rawFile = source && Object.getOwnPropertyDescriptor(source, 'file')?.value;
    const relative = typeof rawFile === 'string' ? rawFile.replace(/\\/g, '/').split('/src/').pop() : undefined;
    const file = relative && relative !== rawFile ? `src/${relative}` : relative;
    const safeFile = file && file.length <= 240 && !file.startsWith('/') && !file.split('/').includes('..') && !/^[a-zA-Z]+:/.test(file) ? file : undefined;
    const line = source && Object.getOwnPropertyDescriptor(source, 'line')?.value;
    const column = source && Object.getOwnPropertyDescriptor(source, 'column')?.value;
    return { component: /^[A-Za-z_$][\w$]{0,79}$/.test(ctor.name) ? ctor.name : 'anonymous',
        ...(safeFile ? { source: { file: safeFile,
            ...(Number.isSafeInteger(line) && line > 0 ? { line } : {}),
            ...(Number.isSafeInteger(column) && column > 0 ? { column } : {}) } } : {}) };
}

function shape(value: unknown): string | undefined {
    if (value === null || value === undefined) return undefined;
    if (Array.isArray(value)) return 'array';
    if (typeof value !== 'object') return ['string', 'number', 'boolean'].includes(typeof value) ? typeof value : undefined;
    return Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null ? 'object' : undefined;
}

/** Soft development hint comparing the public initializer shape, never values. */
export function diagnoseHydrationState(initializer: unknown, hydrated: unknown, field: string,
    metadata?: HydrationDiagnosticMetadata): void {
    if (metadata?.expectedClientOnly || !/^[A-Za-z_$][\w$]{0,127}$/.test(field)) return;
    let remaining = 32;
    const inspect = (before: unknown, after: unknown, path: string, depth: number) => {
        if (remaining-- <= 0 || depth > 4) return;
        const expected = shape(before), actual = shape(after);
        if (!expected || !actual) return;
        if (expected !== actual) {
            console.warn({ event: 'cossack.hydration.mismatch', boundary: 'component', category: 'state-type',
                component: metadata?.component, ...(metadata?.source ? { source: metadata.source } : {}),
                path, statePath: path, expected, actual, action: 'inspect-public-state-contract' });
            return;
        }
        if (expected !== 'object') return;
        for (const key of Object.keys(before as object).slice(0, 32)) {
            if (!/^[A-Za-z_$][\w$]{0,127}$/.test(key)) continue;
            const left = Object.getOwnPropertyDescriptor(before, key), right = Object.getOwnPropertyDescriptor(after, key);
            if (left && right && 'value' in left && 'value' in right) inspect(left.value, right.value, `${path}.${key}`, depth + 1);
        }
    };
    try { inspect(initializer, hydrated, `public.${field}`, 0); }
    catch { /* Diagnostics must never run authored accessors or break hydration. */ }
}
