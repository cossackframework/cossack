import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { Server } from '../src/shared/decorators';
import { forwardServiceMethods, getForwardedServerMethodClass } from '../src/shared/service-bootstrap';
import { isRpcCallableAction } from '../src/shared/method-proxy';

class AccountService {
    @Server() bootstrap() {}
    @Server() save() { return 'saved'; }
}

describe('service RPC forwarding boundary', () => {
    it('does not authorize a component method when a service has the same method name', async () => {
        const component: any = { bootstrap: vi.fn(), hasMethod(name: string) { return typeof this[name] === 'function'; } };
        const original = component.bootstrap;
        forwardServiceMethods(component, new AccountService());
        expect(component.bootstrap).toBe(original);
        expect(getForwardedServerMethodClass(component, 'bootstrap')).toBeUndefined();
        expect(getForwardedServerMethodClass(component, 'save')).toBe(AccountService);
        expect(isRpcCallableAction(getForwardedServerMethodClass(component, 'save'), 'save')).toBe(true);
        expect(await component.save()).toBe('saved');
        expect(original).not.toHaveBeenCalled();
    });

    it('does not trust replaced functions or caller-supplied registration fields', () => {
        const component: any = { hasMethod: () => false };
        forwardServiceMethods(component, new AccountService());
        component.save = vi.fn();
        component.__cossack_forwardedServerMethods = { save: AccountService };
        expect(getForwardedServerMethodClass(component, 'save')).toBeUndefined();
        expect(getForwardedServerMethodClass(component, '__proto__')).toBeUndefined();
    });
});
