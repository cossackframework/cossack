import type { Context } from 'hono';
import type { RedirectStatusCode } from 'hono/utils/http-status';
import type { User } from './user';
import type { ServiceScope } from './service-scope';
import type { CossackContext } from './context';

/**
 * Base class for request-aware services. The owning layout scope binds these
 * facilities per SSR/RPC request, so user/context/env data is never global.
 */
export abstract class CossackService<Env = any> {
    private __cossackServiceScope?: ServiceScope;

    public __cossackBindServiceScope(scope: ServiceScope): void {
        this.__cossackServiceScope = scope;
    }

    protected get c(): Context & CossackContext {
        const context = this.__cossackServiceScope?.getRequestContext().context;
        if (!context) throw new Error('[Cossack] Service request context is unavailable outside SSR/RPC.');
        // On the browser this is createCossackContext's hydrated request shim,
        // typed as Context for API parity. Server-only facilities such as
        // getFormData still reject client access at runtime.
        return context as Context & CossackContext;
    }

    protected get user(): User | undefined {
        return this.__cossackServiceScope?.getRequestContext().user;
    }

    protected get env(): Env {
        return this.__cossackServiceScope?.getRequestContext().env as Env;
    }

    protected redirect(url: string, status: RedirectStatusCode = 302): Response {
        return this.c.redirect(url, status);
    }
}
