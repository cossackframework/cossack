// src/router.ts
import 'reflect-metadata';
import { Hono, type Context } from 'hono';
import { renderRoot } from './root';
import { PageOptions } from './shared/decorators';
import { Cossack } from './shared/cossack';
// @ts-expect-error - this is a JSON import from the build output
import manifest from '~/.vite/manifest.json';

import { type AuthenticatedUser } from './shared/user';

const app = new Hono<{ Bindings: Env, Variables: { user?: AuthenticatedUser } }>();

// TODO: Replace this with a real authentication middleware
app.use('*', (c, next) => {
  c.set('user', { id: 'user-123', name: 'Alice' });
  return next();
});

const eagerPages = import.meta.glob('./pages/**/index.ts', { eager: true });
const componentRegistry = new Map<string, new () => Cossack>();

for (const path in eagerPages) {
    const module = eagerPages[path];
    const PageComponent = Object.values(module as object)[0] as new () => Cossack;
    if (PageComponent) {
        componentRegistry.set(PageComponent.name, PageComponent);
    }
}

// A single, generic route for all WebSocket connections
app.get('/ws/:componentId/:channel', async (c) => {
    const user = c.get('user');
    if (!user) {
        return new Response('Unauthorized', { status: 401 });
    }

    const { componentId } = c.req.param();
    const params = c.req.query();
    
    // This logic should be improved to be more robust, but for now,
    // the componentId is sufficient to get a unique DO instance per page.
    const doName = componentId;
    const id = c.env.COSSACK_OBJECT.idFromName(doName);
    const stub = c.env.COSSACK_OBJECT.get(id);

    const request = new Request(c.req.raw);
    request.headers.set('X-User-ID', user.id);
    request.headers.set('X-Component-Name', componentId);
    request.headers.set('X-User-Data', JSON.stringify(user));
    request.headers.set('X-Component-Params', JSON.stringify(params)); // Forward params

    return await stub.fetch(request);
});


// Build HTTP routes
for (const path in eagerPages) {
    const httpRoute = path
        .replace('./pages', '')
        .replace('/index.ts', '')
        .replace(/\[(\w+)\]/g, ':$1') || '/';

    const module = eagerPages[path];
    const PageComponent = Object.values(module as object)[0] as new () => Cossack;
    if (!PageComponent) continue;

    const pageOptions: PageOptions | undefined = Reflect.getMetadata('page:options', PageComponent);
    const middlewares = pageOptions?.middlewares ?? [];

    const finalHandler = async (c: Context) => {
        const componentInstance = new PageComponent();
        const user = c.get('user');
        await componentInstance.bootstrap({ context: c, user });
        const initialHtml = componentInstance.getInitialHtml();
        const initialState = componentInstance.getInitialState();
        
        const channels = pageOptions?.channels || ['global'];

        return c.html(renderRoot({ 
            body: initialHtml, 
            initialState: { 
                ...initialState, 
                componentId: PageComponent.name,
                channels: channels,
            },
            manifest: manifest,
        }));
    };

    app.get(httpRoute, ...middlewares, finalHandler);
}

export default app;