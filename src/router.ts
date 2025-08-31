// src/router.ts
import 'reflect-metadata';
import { Hono, type Context } from 'hono';
import { renderRoot } from './root';
import { PageOptions } from './shared/decorators';
import { Cossack } from './shared/cossack';
// @ts-expect-error - this is a raw import from the build output
import manifest from '~/.vite/manifest.json?raw';

// Define the binding interface
interface Env {
    COSSACK_OBJECT: DurableObjectNamespace;
}

const app = new Hono<{ Bindings: Env }>();

const eagerPages = import.meta.glob('./pages/**/index.ts', { eager: true });
const componentRegistry = new Map<string, new () => Cossack>();

// Initialize component registry from eager loaded pages
for (const path in eagerPages) {
    const module = eagerPages[path];
    const PageComponent = Object.values(module as object)[0] as new () => Cossack;
    if (PageComponent) {
        componentRegistry.set(PageComponent.name, PageComponent);
    }
}

app.get('/ws', async (c) => {
    const id = c.env.COSSACK_OBJECT.idFromName('singleton-dev-instance');
    const stub = c.env.COSSACK_OBJECT.get(id);
    return await stub.fetch(c.req.raw);
});

// Build routes using Hono's standard middleware pattern
for (const path in eagerPages) {
    const route = path
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
        
        return c.html(renderRoot({ 
            body: initialHtml, 
            initialState: { ...initialState, componentId: PageComponent.name },
            manifest: JSON.parse(manifest),
        }));
    };

    app.get(route, ...middlewares, finalHandler);
}

export default app;