import 'reflect-metadata';
import { afterEach, expect, it, vi } from 'vitest';
import { Cossack, Page, Server, html } from '@cossackframework/core';
import { computeRouteIds } from '../src/route-ids';
const { registry } = vi.hoisted(() => ({ registry: { pages: {} as Record<string, any>, layouts: {}, loadings: {} } }));
vi.mock('virtual:cossack-pages', () => ({ default: registry }));
vi.mock('virtual:cossack-middlewares', () => ({ default: [] }));
vi.mock('virtual:cossack-config', () => ({ requirements: {}, environment: null, default: {} }));

let reads = 0;
let renders = 0;
@Page({ transport: 'http' })
class ResourcePage extends Cossack {
    static readonly __cossackResourceFields = ['record'];
    get record() { return this.__serverResource('record', () => this.readRecord(), { initial: 0 })!; }
    @Server() readRecord() { reads++; return 1; }
    render() { renders++; return html`<main>${this.resourceStatus$('record').value}</main>`; }
}

const path = '/src/pages/read/index.ts';
registry.pages[path] = { default: ResourcePage };
const id = computeRouteIds([path], []).routePathToIdMap.get(path)!;
const { createApp } = await import('../src/router');
afterEach(() => { reads = 0; renders = 0; });
it('dispatches one root resource read without starting another during RPC tree reconstruction', async () => {
    const app = createApp();
    const response = await app.request('/crpc', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost' },
        body: JSON.stringify({ componentRouteId: id, target: 'root', action: 'readRecord', payload: [], state: {} }) }, {} as any);
    expect(response.status).toBe(200);
    expect((await response.json() as {_cossack_return:number})._cossack_return).toBe(1);
    expect(reads).toBe(1);
});

it('refuses a method that is not a server method before rendering the page or reading a resource', async () => {
    const app = createApp();
    for (const action of ['render', 'getPublicState', 'missing']) {
        const response = await app.request('/crpc', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost' },
            body: JSON.stringify({ componentRouteId: id, target: 'root', action, payload: [], state: {} }) }, {} as any);
        expect(response.status).toBe(403);
        expect(((await response.json()) as { code: string }).code).toBe('COSSACK_RPC_FORBIDDEN');
    }
    await new Promise(resolve => setTimeout(resolve, 0));
    expect({ reads, renders }).toEqual({ reads: 0, renders: 0 });
});
