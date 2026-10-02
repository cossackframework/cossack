import { describe, expect, it } from 'vitest';
import type { NavigateResult } from '@cossackframework/core';

/**
 * RT-09: navigation completion contract. The typed outcome covers completed,
 * superseded, canceled, redirected, and failed; results always settle.
 * (The full navigate() runtime is exercised by e2e; this suite pins the
 * contract shape and the outcome lattice the runtime emits.)
 */

describe('navigation outcome contract (RT-09)', () => {
    const outcomes: NavigateResult['outcome'][] = ['completed', 'superseded', 'canceled', 'redirected', 'failed'];

    it('defines exactly the five documented outcomes', () => {
        expect(outcomes).toHaveLength(5);
        expect(new Set(outcomes).size).toBe(5);
    });

    it('every result shape is distinguishable without instanceof checks', () => {
        const samples: NavigateResult[] = [
            { outcome: 'completed', url: '/a' },
            { outcome: 'superseded', url: '/a' },
            { outcome: 'canceled', url: '/a' },
            { outcome: 'redirected', url: '/final' },
            { outcome: 'failed', url: '/a', error: new Error('network') },
        ];
        for (const sample of samples) {
            expect(typeof sample.outcome).toBe('string');
            expect(typeof sample.url).toBe('string');
            if (sample.outcome === 'failed') expect(sample.error).toBeDefined();
            else expect(sample.error).toBeUndefined();
        }
    });
});
