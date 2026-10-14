// @vitest-environment node
import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { Context } from 'hono';
import { Cossack } from '../src/shared/cossack';

class Api extends Cossack {
    calls: string[] = [];
    async get() { this.calls.push('get'); }
    async init() { this.calls.push('init'); }
}

const context = () => new Context(new Request('http://localhost/api')) as any;

describe('bootstrap loaders on the server', () => {
    it('runs get() and init() by default', async () => {
        const api = new Api();
        await api.bootstrap({ context: context() });
        expect(api.calls).toEqual(['get', 'init']);
    });

    it('skipInit still runs get()', async () => {
        const api = new Api();
        await api.bootstrap({ context: context(), skipInit: true });
        expect(api.calls).toEqual(['get']);
    });

    it('skipGet leaves get() to the caller, for example an HTTP verb handler', async () => {
        const api = new Api();
        await api.bootstrap({ context: context(), skipInit: true, skipGet: true });
        expect(api.calls).toEqual([]);
        await api.get();
        expect(api.calls).toEqual(['get']);
    });
});
