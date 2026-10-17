import { createFastDB } from '@cossackframework/fastdb';
import { getRequestContext } from '@cossackframework/core';
import { cmsReconcilers, createCMS, type CmsHost } from '@cossackframework/cms/server';
import type { Principal } from '@cossackframework/cms';
import { plugins } from '@cossackframework/framework/plugins';
import { modules, resources } from './resources';
import { pendingWrites, type PendingBindings } from './pending';
import { imageTransformer, mediaStorage, type MediaBindings } from './media';

export interface CmsBindings extends PendingBindings, MediaBindings {
    /** FastDB database URL: a Cloud database URL, or `http://127.0.0.1:4321` for `fastdb serve`. */
    FASTDB_URL?: string;
    /** Database grant (Cloud `query` scope) or the local service token. Server-only. */
    FASTDB_TOKEN?: string;
    APP_URL?: string;
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
    const url = env.FASTDB_URL;
    const token = env.FASTDB_TOKEN;
    if (!url || !token) throw new Error('The CMS needs FASTDB_URL and FASTDB_TOKEN. Start `fastdb serve` locally, or use a FastDB Cloud database.');
    const key = `${url}\n${token}`;
    if (current?.key !== key) {
        const db = createFastDB({ url, token, pending: pendingWrites(env), reconcilers: cmsReconcilers() });
        const storage = mediaStorage(env);
        const images = imageTransformer(env);
        current = { key, cms: createCMS({ db, modules, resources, plugins, ...(storage ? { storage } : {}), ...(images ? { images } : {}) }) };
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
