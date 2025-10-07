// src/router.ts
import 'reflect-metadata';
import { Hono, type Context } from 'hono';
import { renderRoot } from './root';
import { PageOptions, Cossack, AuthenticatedUser } from '@cossackframework/core';
// @ts-expect-error - this is a virtual module created by the vite plugin
import pages from 'virtual:cossack-pages';
import manifest from '~/.vite/manifest.json';

export type PageModule = {
    [key: string]: new () => Cossack;
}

export function createApp() {
    const app = new Hono<{ Bindings: CloudflareBindings, Variables: { user?: AuthenticatedUser } }>();

    // TODO: Replace this with a real authentication middleware
    app.use('*', (c, next) => {
        c.set('user', { id: 'user-123', name: 'Alice' });
        return next();
    });

    // A generic route for all provider-based WebSocket connections
    app.get('/ws/:provider/:id', async (c) => {
        const user = c.get('user');
        if (!user) {
            return new Response('Unauthorized', { status: 401 });
        }

        const { provider, id: durableObjectId } = c.req.param();
        const componentId = c.req.query('componentId');

        if (!componentId) {
            return new Response('componentId query parameter is required', { status: 400 });
        }

        const doBinding = c.env.COSSACK_OBJECT;
        const id = doBinding.idFromString(durableObjectId);
        const stub = doBinding.get(id);

        const request = new Request(c.req.raw);
        request.headers.set('X-User-ID', user.id);
        request.headers.set('X-Component-Name', componentId);
        request.headers.set('X-Provider-Name', provider);
        request.headers.set('X-User-Data', JSON.stringify(user));

        return await stub.fetch(request);
    });

    // Build HTTP routes from the provided pages
    for (const path in pages) {
        const httpRoute = path
            .replace('/src/pages', '')
            .replace('/index.ts', '')
            .replace(/\[(\w+)\]/g, ':$1') || '/';

        const module = pages[path];
        const PageComponent = Object.values(module as object)[0] as new () => Cossack;
        if (!PageComponent) continue;

        // Tag the component with the name of the DO binding it uses for page state.
        // This is crucial for the PageStateProvider to work correctly during SSR.
        Reflect.defineMetadata('cossack:durable-object-name', 'COSSACK_OBJECT', PageComponent);

        const pageOptions: PageOptions | undefined = Reflect.getMetadata('page:options', PageComponent);
        const middlewares = pageOptions?.middlewares ?? [];

        const finalHandler = async (c: Context) => {
            const componentInstance = new PageComponent();
            const user = c.get('user');
            await componentInstance.bootstrap({ context: c, user, env: c.env, page: c.req.path });
            const initialHtml = componentInstance.getInitialHtml();
            const initialState = componentInstance.getInitialState();
            
            const channels = pageOptions?.channels || ['global'];

            const finalInitialState = { 
                ...initialState, 
                componentPath: path,
                pathname: c.req.path,
                channels: channels,
            };

            c.header('Content-Type', 'text/html');
            return c.body(renderRoot({ 
                body: initialHtml, 
                initialState: finalInitialState,
                manifest: manifest,
            }));
        };

        app.get(httpRoute, ...middlewares, finalHandler);
    }

    return app;
}