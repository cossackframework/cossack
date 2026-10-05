import 'reflect-metadata';
import { expect, it } from 'vitest';
import { Server } from '../src/shared/decorators';
import {
    collectServerMethodMetadata,
    MAX_SERVER_METHOD_TIMEOUT_MS,
    validateServerMethodTimeout,
} from '../src/shared/server-method-metadata';

it('accepts omitted deadlines and the supported integer boundary values', () => {
    expect(validateServerMethodTimeout(undefined)).toBeUndefined();
    expect(validateServerMethodTimeout(1)).toBe(1);
    expect(validateServerMethodTimeout(MAX_SERVER_METHOD_TIMEOUT_MS)).toBe(MAX_SERVER_METHOD_TIMEOUT_MS);

    class Page { run() {} }
    Server({ timeout: 1 })(Page.prototype, 'run');
    expect(collectServerMethodMetadata(Page).run.timeout).toBe(1);
});

it.each([0, -1, 1.5, NaN, Infinity, MAX_SERVER_METHOD_TIMEOUT_MS + 1, '10', null])(
    'rejects invalid server method deadline %s instead of silently changing its behavior', timeout => {
        expect(() => validateServerMethodTimeout(timeout)).toThrow(RangeError);

        class Page { run() {} }
        expect(() => Server({ timeout: timeout as number })).toThrow(RangeError);
    },
);

it('rejects malformed inherited metadata before creating a timer', () => {
    class Page { run() {} }
    Reflect.defineMetadata('cossack:server-methods', { run: { timeout: 2_147_483_648 } }, Page);
    expect(() => validateServerMethodTimeout(collectServerMethodMetadata(Page).run.timeout)).toThrow(RangeError);
});
