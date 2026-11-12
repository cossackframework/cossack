import { describe, expect, it } from 'vitest';
import { MAX_FILE_VARIANTS, snapAspect, VARIANT_ASPECTS } from '../src/server/files';

describe('variant shapes', () => {
    it('snap every requested shape to a short fixed list, so any height maps to a kept variant', () => {
        for (const shape of VARIANT_ASPECTS) expect(snapAspect(shape)).toBe(shape);
        expect(snapAspect(1)).toBe(1);
        expect(snapAspect(1.618)).toBe(3 / 2);
        expect(snapAspect(800)).toBe(21 / 9);
        expect(snapAspect(1 / 800)).toBe(9 / 21);
        expect(snapAspect(0)).toBe(1);
        expect(snapAspect(Number.NaN)).toBe(1);
        const shapes = new Set<number>();
        for (let height = 1; height <= 10_000; height++) shapes.add(snapAspect(800 / height));
        expect(shapes.size).toBeLessThanOrEqual(VARIANT_ASPECTS.length);
        // 12 widths × (whole image + each shape) × 3 formats.
        expect(MAX_FILE_VARIANTS).toBe(12 * (1 + VARIANT_ASPECTS.length) * 3);
    });
});
