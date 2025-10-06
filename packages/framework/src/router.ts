// src/router.ts
import 'reflect-metadata';
import { Hono, type Context } from 'hono';
import { renderRoot } from './root';
import { PageOptions, Cossack, AuthenticatedUser } from '@cossackframework/core';
// @ts-expect-error - this is a JSON import from the build output
import manifest from '~/.vite/manifest.json';

export type PageModule = {
    [key: string]: new () => Cossack;
}

export function createApp(pages: Record<string, PageModule>) {
    const app = new Hono<{ Bindings: CloudflareBindings, Variables: { user?: AuthenticatedUser } }>();

    // TODO: Replace this with a real authentication middleware
    app.use('*', (c, next) => {
        c.set('user', { id: 'user-123', name: 'Alice' });
        return next();
    });

    // A single, generic route for all WebSocket connections
    app.get('/ws/:componentId/:channel', async (c) => {
        const user = c.get('user');
        if (!user) {
            return new Response('Unauthorized', { status: 401 });
        }

        const { componentId } = c.req.param();
        const params = c.req.query();
        
        const doName = c.req.query('pathname') || componentId;
        const id = c.env.COSSACK_OBJECT.idFromName(doName);
        const stub = c.env.COSSACK_OBJECT.get(id);

        const request = new Request(c.req.raw);
        request.headers.set('X-User-ID', user.id);
        request.headers.set('X-Component-Name', componentId);
        request.headers.set('X-User-Data', JSON.stringify(user));
        request.headers.set('X-Component-Params', JSON.stringify(params));

        return await stub.fetch(request);
    });

    // Build HTTP routes from the provided pages
    for (const path in pages) {
        const httpRoute = path
            .replace('./pages', '')
            .replace('/index.ts', '')
            .replace(/\[(\w+)\]/g, ':$1') || '/';

        const module = pages[path];
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
                    pathname: c.req.path,
                    channels: channels,
                },
                manifest: manifest,
            }));
        };

        app.get(httpRoute, ...middlewares, finalHandler);
    }

    return app;
}