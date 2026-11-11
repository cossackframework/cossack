import { describe, expect, it } from 'vitest';
import { snapAspect } from '../src/server/files';

describe('variant shapes', () => {
    it('snap to a bounded set, so any height cannot make a new kept crop', () => {
        expect(snapAspect(1)).toBe(1);
        for (const shape of [16 / 9, 4 / 3, 3 / 2, 21 / 9, 9 / 16, 2 / 3]) expect(snapAspect(shape)).toBe(shape);
        expect(Math.abs(snapAspect(1.618) - 1.618) / 1.618).toBeLessThan(0.01);
        const shapes = new Set<number>();
        for (let height = 1; height <= 10_000; height++) shapes.add(snapAspect(800 / height));
        expect(shapes.size).toBeLessThanOrEqual(400);
        expect(snapAspect(800)).toBe(8);
        expect(snapAspect(1 / 800)).toBe(1 / 8);
    });
});
