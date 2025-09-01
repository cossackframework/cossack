// src/router.ts
import 'reflect-metadata';
import { Hono, type Context } from 'hono';
import { renderRoot } from './root';
import { PageOptions } from './shared/decorators';
import { Cossack } from './shared/cossack';
// @ts-expect-error - this is a JSON import from the build output
import manifest from '~/.vite/manifest.json';

type AuthenticatedUser = {
    id: string;
    [key: string]: any;
};

const getAuthenticatedUser = async (c: Context): Promise<AuthenticatedUser> => {
    return { id: 'user-123', name: 'Alice' };
};

interface Env {
    COSSACK_OBJECT: DurableObjectNamespace;
}

const app = new Hono<{ Bindings: Env }>();

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
    const user = await getAuthenticatedUser(c);
    if (!user) {
        return new Response('Unauthorized', { status: 401 });
    }

    const { componentId, channel } = c.req.param();
    
    // The DO's name is based on the component and its route params to ensure unique instances per page.
    // This logic should mirror how the `doName` is created in the HTTP route.
    // For simplicity, we'll assume a convention here. A more robust solution might pass the exact
    // DO name to the client in the initial state.
    const doName = componentId; // Simplified for this example
    const id = c.env.COSSACK_OBJECT.idFromName(doName);
    const stub = c.env.COSSACK_OBJECT.get(id);

    // Forward the request to the Durable Object, including the channel in the URL.
    const request = new Request(c.req.raw);
    request.headers.set('X-User-ID', user.id);
    request.headers.set('X-Component-Name', componentId);
    request.headers.set('X-User-Data', JSON.stringify(user));

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
        componentInstance.setContext(c);
        await componentInstance.bootstrap({ params: c.req.param() });
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
