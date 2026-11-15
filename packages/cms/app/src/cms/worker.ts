// The Durable Object class and Worker entrypoints of the CMS, which a Workers project's
// `src/index.ts` exports by name and its wrangler.jsonc names.
import { cloudflarePluginRunner, createPluginBridge, PluginTail } from '@cossackframework/cms/cloudflare';
import { networkFor, setPluginRunner } from './index';

// Unconfirmed RomeDB writes (ROMEDB_PENDING) survive isolate restarts here.
export { RomeDBPendingWrites } from '@cossackframework/romedb/cloudflare';

// Isolated plugins run in Workers of their own through the Worker Loader binding (LOADER, which
// cossack add plugin adds with the first one), and call the CMS back through PluginBridge.
setPluginRunner(cloudflarePluginRunner());
export const PluginBridge = createPluginBridge<unknown>((env, site) => networkFor(env as never).hostById(site));
export { PluginTail };
