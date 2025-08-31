// src/router.ts
import 'reflect-metadata';
import { Hono, type Context } from 'hono';
import { renderRoot } from './root';
import { PageOptions } from './shared/decorators';
import { Cossack } from './shared/cossack';
// @ts-expect-error - this is a JSON import from the build output
import manifest from '~/.vite/manifest.json';

// Define a user type for clarity. In a real app, this would be more complex.
type AuthenticatedUser = {
    id: string;
    [key: string]: any;
};

// In a real app, this would involve validating a session cookie or JWT.
// For this example, we'll just create a mock user.
const getAuthenticatedUser = async (c: Context): Promise<AuthenticatedUser> => {
    return { id: 'user-123', name: 'Alice', friends: ['user-456'] };
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

// Dynamically create WebSocket routes based on @Page decorators
for (const [name, PageComponent] of componentRegistry.entries()) {
    const pageOptions: PageOptions | undefined = Reflect.getMetadata('page:options', PageComponent);
    if (!pageOptions?.channel) continue;

    // This loop runs once per component that has a `channel` defined.
    // It creates a generic route that will handle all instances of that channel.
    const channelPattern = typeof pageOptions.channel === 'string' ? pageOptions.channel : '*';
    const routePath = `/ws/${channelPattern}`;

    app.get(routePath, async (c) => {
        const user = await getAuthenticatedUser(c);
        if (!user) {
            return new Response('Unauthorized', { status: 401 });
        }

        let channelId: string;
        if (typeof pageOptions.channel === 'string') {
            // Configured channel: Replace params like :userId and :currentUser.id
            channelId = pageOptions.channel;
            for (const [key, value] of Object.entries(c.req.param())) {
                channelId = channelId.replace(`:${key}`, String(value));
            }
            channelId = channelId.replace(':currentUser.id', user.id);
        } else {
            // Convention-based channel: Use the request path and query string
            const url = new URL(c.req.url);
            channelId = `${url.pathname.substring(4)}${url.search}`; // remove /ws/
        }
        
        const id = c.env.COSSACK_OBJECT.idFromName(channelId);
        const stub = c.env.COSSACK_OBJECT.get(id);

        const request = new Request(c.req.raw);
        request.headers.set('X-User-ID', user.id);
        request.headers.set('X-Component-Name', name);
        request.headers.set('X-User-Data', JSON.stringify(user));

        return await stub.fetch(request);
    });
}

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

        let webSocketUrl: string | undefined;
        if (pageOptions?.channel) {
            const user = await getAuthenticatedUser(c);
            if (typeof pageOptions.channel === 'string') {
                webSocketUrl = `/ws/${pageOptions.channel}`;
                for (const [key, value] of Object.entries(c.req.param())) {
                    webSocketUrl = webSocketUrl.replace(`:${key}`, value);
                }
                webSocketUrl = webSocketUrl.replace(':currentUser.id', user.id);
            } else {
                const url = new URL(c.req.url);
                webSocketUrl = `/ws${url.pathname}${url.search}`;
            }
        }
        
        return c.html(renderRoot({ 
            body: initialHtml, 
            initialState: { 
                ...initialState, 
                componentId: PageComponent.name,
                webSocketUrl: webSocketUrl,
            },
            manifest: manifest,
        }));
    };

    app.get(httpRoute, ...middlewares, finalHandler);
}

export default app;