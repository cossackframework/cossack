import { describe, it, expect } from 'vitest';
import { ClientVisibleError, isClientVisibleError } from '../src/shared/errors';

describe('ClientVisibleError', () => {
    it('carries the provided message', () => {
        const e = new ClientVisibleError('An account with this email already exists.');
        expect(e.message).toBe('An account with this email already exists.');
    });

    it('sets name to "ClientVisibleError"', () => {
        const e = new ClientVisibleError('boom');
        expect(e.name).toBe('ClientVisibleError');
    });

    it('is an Error / instanceof ClientVisibleError', () => {
        const e = new ClientVisibleError('boom');
        expect(e).toBeInstanceOf(Error);
        expect(e).toBeInstanceOf(ClientVisibleError);
    });

    it('is throwable and catchable, preserving the message', () => {
        try {
            throw new ClientVisibleError('invalid input');
            throw new Error('unreachable');
        } catch (e) {
            expect(e).toBeInstanceOf(ClientVisibleError);
            expect((e as Error).message).toBe('invalid input');
        }
    });

    it('preserves the prototype chain (instanceof works across the class)', () => {
        // Object.setPrototypeOf is called in the ctor for cross-target safety;
        // verify it didn't break instanceof.
        const e = new ClientVisibleError('x');
        expect(Object.getPrototypeOf(e)).toBe(ClientVisibleError.prototype);
    });
});

describe('isClientVisibleError', () => {
    it('returns true for a ClientVisibleError instance', () => {
        expect(isClientVisibleError(new ClientVisibleError('boom'))).toBe(true);
    });

    it('returns false for a plain Error', () => {
        expect(isClientVisibleError(new Error('boom'))).toBe(false);
    });

    it('returns false for non-Error values', () => {
        expect(isClientVisibleError(null)).toBe(false);
        expect(isClientVisibleError(undefined)).toBe(false);
        expect(isClientVisibleError('boom')).toBe(false);
        expect(isClientVisibleError({ message: 'boom' })).toBe(false);
        expect(isClientVisibleError({ name: 'ClientVisibleError' })).toBe(false);
    });

    it('returns true for a cross-instance Error carrying the marker name', () => {
        // Simulates a ClientVisibleError thrown from a different module copy
        // (instanceof fails across the boundary, but the name marker survives).
        const foreignLike = new Error('invalid');
        (foreignLike as { name: string }).name = 'ClientVisibleError';
        expect(isClientVisibleError(foreignLike)).toBe(true);
    });

    it('returns false for an Error with a different name', () => {
        const e = new Error('x');
        e.name = 'TypeError';
        expect(isClientVisibleError(e)).toBe(false);
    });

    it('narrows the type so .message is accessible after the guard', () => {
        const e: unknown = new ClientVisibleError('visible');
        if (isClientVisibleError(e)) {
            // Type narrows to ClientVisibleError; .message is reachable.
            expect(e.message).toBe('visible');
        }
    });
});
