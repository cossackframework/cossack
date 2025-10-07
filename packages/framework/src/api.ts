// src/api.ts
import 'reflect-metadata';
import type { Hono } from 'hono';
import { PageOptions, Cossack } from '@cossackframework/core';
import { createApiHandler } from './api-handler';

export class CossackApi {
    public static register(app: Hono<any>, components: (new () => Cossack)[]) {
        for (const ComponentClass of components) {
            const pageOptions: PageOptions | undefined = Reflect.getMetadata('page:options', ComponentClass);

            // Ensure this is a manually registered HTTP transport with a defined route
            if (pageOptions?.transport !== 'http' || !pageOptions.route) {
                console.warn(`Skipping manual registration for ${ComponentClass.name}: it must have transport: 'http' and a 'route' option defined.`);
                continue;
            }

            const httpRoute = pageOptions.route;
            const middlewares = pageOptions.middlewares ?? [];

            const httpMethods = ['get', 'post', 'put', 'patch', 'delete'];
            for (const method of httpMethods) {
                if (method in ComponentClass.prototype) {
                    const handler = createApiHandler(ComponentClass, method);
                    (app as any)[method](httpRoute, ...middlewares, handler);
                }
            }
        }
    }
}
