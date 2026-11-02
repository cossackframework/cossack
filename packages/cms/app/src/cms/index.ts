import { createRomeDB } from '@cossackframework/romedb';
import { getRequestContext } from '@cossackframework/core';
import { cmsReconcilers, createCMS, type CmsHost } from '@cossackframework/cms/server';
import type { Principal } from '@cossackframework/cms';
import { plugins } from '@cossackframework/framework/plugins';
import { modules, resources } from './resources';
import { databaseConnection, type DatabaseBindings } from './database';
import { pendingWrites, type PendingBindings } from './pending';
import { imageTransformer, mediaStorage, type MediaBindings } from './media';

export interface CmsBindings extends DatabaseBindings, PendingBindings, MediaBindings {
    APP_URL?: string;
    /** Sends form notifications: Cloudflare's Email Service binding, or any `{ send(message) }`. */
    EMAIL?: { send(message: { to: string; from: string; subject: string; text: string; replyTo?: string }): Promise<unknown> };
    /** The sender of form notifications. */
    MAIL_FROM?: string;
}

declare module 'hono' {
    interface ContextVariableMap {
        cms: CmsHost;
        principal: Principal;
    }
}

let current: { key: string; cms: CmsHost } | undefined;

/** One CMS host per isolate or process, keyed by its database address and credential. */
export function cmsFor(env: CmsBindings): CmsHost {
    const connection = databaseConnection(env);
    const key = `${connection.url}\n${connection.token ?? ''}`;
    if (current?.key !== key) {
        const db = createRomeDB({ ...connection, pending: pendingWrites(env), reconcilers: cmsReconcilers() });
        const storage = mediaStorage(env);
        const images = imageTransformer(env);
        const mail = env.EMAIL;
        current = { key, cms: createCMS({
            db, modules, resources, plugins, ...(storage ? { storage } : {}), ...(images ? { images } : {}), siteUrl: () => env.APP_URL,
            ...(mail ? { mail: { send: message => mail.send(message) }, mailFrom: env.MAIL_FROM || 'no-reply@example.com' } : {}),
        }) };
    }
    return current.cms;
}

/** The CMS host of the current request, for server code without a context argument. */
export function currentCms(): CmsHost {
    const c = getRequestContext();
    const cms = c?.get('cms');
    if (!cms) throw new Error('No CMS on this request. Register cmsMiddleware in src/bootstrap/middlewares.ts.');
    return cms;
}
