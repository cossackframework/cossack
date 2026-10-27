import { createRomeDB } from '@cossackframework/romedb';
import { getRequestContext } from '@cossackframework/core';
import { cmsReconcilers, createCMS, type CmsHost } from '@cossackframework/cms/server';
import type { Principal } from '@cossackframework/cms';
import { plugins } from '@cossackframework/framework/plugins';
import { modules, resources } from './resources';
import { pendingWrites, type PendingBindings } from './pending';
import { imageTransformer, mediaStorage, type MediaBindings } from './media';

export interface CmsBindings extends PendingBindings, MediaBindings {
    /** RomeDB database URL: a Cloud database URL, or `http://127.0.0.1:4321` for `romedb serve`. */
    ROMEDB_URL?: string;
    /** Database grant (Cloud `query` scope) or the local service token. Server-only. */
    ROMEDB_TOKEN?: string;
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

/** One CMS host per isolate or process, keyed by its database credential. */
export function cmsFor(env: CmsBindings): CmsHost {
    const url = env.ROMEDB_URL;
    const token = env.ROMEDB_TOKEN;
    if (!url || !token) throw new Error('The CMS needs ROMEDB_URL and ROMEDB_TOKEN. Start `romedb serve` locally, or use a RomeDB Cloud database.');
    const key = `${url}\n${token}`;
    if (current?.key !== key) {
        const db = createRomeDB({ url, token, pending: pendingWrites(env), reconcilers: cmsReconcilers() });
        const storage = mediaStorage(env);
        const images = imageTransformer(env);
        const mail = env.EMAIL;
        current = { key, cms: createCMS({
            db, modules, resources, plugins, ...(storage ? { storage } : {}), ...(images ? { images } : {}),
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
