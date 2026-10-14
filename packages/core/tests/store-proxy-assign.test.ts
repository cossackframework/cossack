import 'reflect-metadata';
import { types } from 'node:util';
import { describe, expect, it, vi } from 'vitest';
import { Cossack } from '../src/shared/cossack';
import { ClientStore, Store } from '../src/shared/decorators';
import { createStoreProxy } from '../src/shared/store';

describe('@Store assignment of its own proxy', () => {
    it('stores the raw object when the store proxy is assigned back', () => {
        class Page extends Cossack {
            protected override isServer = false;
            @Store() form = { name: 'a', address: { zip: '1' } };
            @ClientStore() draft = { rows: [1] };
        }
        const page = new Page();
        page.connectedCallback();
        const update = vi.spyOn(page, 'requestUpdate').mockImplementation(() => Promise.resolve(true));

        page.form = Object.assign(page.form, { name: 'b' });
        page.draft = page.draft;
        const container = (page as any)._stateContainer;
        expect(types.isProxy(container.getPublic('form'))).toBe(false);
        expect(types.isProxy(container.getInternal('draft'))).toBe(false);
        expect(container.getPublic('form')).toEqual({ name: 'b', address: { zip: '1' } });

        // Reads stay single-wrapped: nested writes still reach the raw object
        // and identity is stable.
        expect(page.form).toBe(page.form);
        (page.form.address as any).zip = '2';
        expect(container.getPublic('form').address.zip).toBe('2');
        expect(types.isProxy(container.getPublic('form').address)).toBe(false);
        expect(update).toHaveBeenCalled();
    });

    it('unwraps nested store proxies assigned through the proxy', () => {
        const trigger = vi.fn();
        const raw = { a: { v: 1 }, b: null as unknown };
        const store = createStoreProxy(raw as any, 'store', trigger);
        store.b = store.a;
        expect(types.isProxy(raw.b)).toBe(false);
        expect(raw.b).toBe(raw.a);
    });
});
