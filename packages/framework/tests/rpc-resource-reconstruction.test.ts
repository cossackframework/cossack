import 'reflect-metadata';
import { afterEach, expect, it, vi } from 'vitest';
import { Cossack, Page, Server, html } from '@cossackframework/core';
import { computeRouteIds } from '../src/route-ids';
const { registry } = vi.hoisted(() => ({ registry: { pages: {} as Record<string, any>, layouts: {}, loadings: {} } }));
vi.mock('virtual:cossack-pages', () => ({ default: registry }));
vi.mock('virtual:cossack-middlewares', () => ({ default: [] }));
vi.mock('virtual:cossack-config', () => ({ default: {} }));

let reads = 0;
@Page({ transport: 'http' })
class ResourcePage extends Cossack {
    static readonly __cossackResourceFields = ['record'];
    get record() { return this.__serverResource('record', () => this.readRecord(), { initial: 0 })!; }
    @Server() readRecord() { reads++; return 1; }
    render() { return html`<main>${this.resourceStatus$('record').value}</main>`; }
}

const path = '/src/pages/read/index.ts';
registry.pages[path] = { default: ResourcePage };
const id = computeRouteIds([path], []).routePathToIdMap.get(path)!;
const { createApp } = await import('../src/router');
afterEach(() => { reads = 0; });
it('dispatches one root resource read without starting another during RPC tree reconstruction', async () => {
    const app = createApp();
    const response = await app.request('/crpc', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost' },
        body: JSON.stringify({ componentRouteId: id, target: 'root', action: 'readRecord', payload: [], state: {} }) }, {} as any);
    expect(response.status).toBe(200);
    expect((await response.json() as {_cossack_return:number})._cossack_return).toBe(1);
    expect(reads).toBe(1);
});
