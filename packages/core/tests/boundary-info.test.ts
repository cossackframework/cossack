// @vitest-environment jsdom
import 'reflect-metadata';
import { afterEach, describe, expect, it } from 'vitest';
import { Cossack } from '../src/shared/cossack';
import { Page } from '../src/shared/decorators';
import { readBoundaryInfo } from '../src/shared/component-types';

@Page({ transport: 'http' })
class ErrorPage extends Cossack {
    get told() { return this.boundary; }
}
const metadata = { componentId: 'ErrorPage', pathname: '/reports', url: '/reports', params: {} };
const failed = { type: 'error' as const, status: 500, requestId: '3f0c1d0e-6f0a-4c56-9d55-0c1b6a0a2a11' };
const bootstrapped: Cossack[] = [];
async function bootstrap(options: Parameters<Cossack['bootstrap']>[0]) {
    const component = new ErrorPage();
    bootstrapped.push(component);
    await component.bootstrap({ skipInit: true, deferMount: true, ...options });
    return component;
}
afterEach(() => {
    for (const component of bootstrapped.splice(0)) component.destroy();
    delete (window as any).__INITIAL_STATE__;
});

describe('this.boundary in the browser', () => {
    it('is what the server rendered the boundary page with', async () => {
        const page = await bootstrap({ initialState: { public: {}, metadata: { ...metadata, boundary: failed } } });
        expect(page.told).toEqual(failed);
    });

    it('is undefined on a page that is not a boundary', async () => {
        const page = await bootstrap({ initialState: { public: {}, metadata } });
        expect(page.told).toBeUndefined();
    });

    it('follows a retained layout into and out of a boundary page', async () => {
        const layout = await bootstrap({ initialState: { public: {}, metadata } });
        layout._frameworkHydrateNavigationResources({ public: {}, metadata: { ...metadata, boundary: { type: '404', status: 404 } } }, '/gone', '/gone', undefined);
        expect(layout.told).toEqual({ type: '404', status: 404 });
        const restore = layout._frameworkCaptureNavigationContext();
        layout._frameworkHydrateNavigationResources({ public: {}, metadata }, '/reports', '/reports', undefined);
        expect(layout.told).toBeUndefined();
        // An abandoned navigation gives the layout back what it showed.
        restore();
        expect(layout.told).toEqual({ type: '404', status: 404 });
    });

    it('keeps only the known fields of a record', () => {
        expect(readBoundaryInfo({ type: 'error', status: 403, requestId: 'abc', message: 'private' })).toEqual({ type: 'error', status: 403, requestId: 'abc' });
        expect(readBoundaryInfo({ type: 'other', status: 500 })).toBeUndefined();
        expect(readBoundaryInfo({ type: 'error', status: '500' })).toBeUndefined();
        expect(readBoundaryInfo(undefined)).toBeUndefined();
    });
});
