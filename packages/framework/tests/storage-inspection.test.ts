import { expect, it } from 'vitest';
import { inspectCacheConfigFromAst, inspectStorageOverridesFromAst } from '../src/page-inspection';

it('reads factory aliases, literals, public selections and requirements without execution', async () => {
    const code = `import type { CacheConfig } from '@cossackframework/framework/cache';
const store = { driver: 'kv', binding: 'CACHE', requires: { shared: true, operations: ['get'] } };
export default ({ env: setting }) => ({ default: setting('CACHE_DRIVER', 'memory'),
    stores: { memory: { driver: 'memory' }, edge: store } } satisfies CacheConfig);`;
    const result = await inspectCacheConfigFromAst(code, { CACHE_DRIVER: 'edge' });
    expect(result).toMatchObject({ status: 'resolved', selection: { status: 'resolved', value: 'edge' } });
    expect(result.stores[1]).toMatchObject({ name: 'edge', driver: { value: 'kv' }, binding: { value: 'CACHE' },
        requires: { value: { shared: true, operations: ['get'] } } });
    expect((await inspectCacheConfigFromAst(code, {})).selection).toMatchObject({ value: 'memory' });
});
it('matches missing/nullish env fallback and explicit undefined declarations', async () => {
    const result = await inspectCacheConfigFromAst(`export default ({env}) => ({default: env('CACHE_DRIVER'),
        stores: { main: { driver: 'memory', binding: undefined, requires: undefined } } });`, {});
    expect(result.selection).toEqual({ status: 'resolved', value: '' });
    expect(result.stores[0]).toMatchObject({ binding: { status: 'resolved' }, requires: { status: 'resolved' } });
});
it.each([
    `export default getCache();`,
    `export default { default: 'main', stores: {...settings} };`,
    `const config = { default: 'main', stores: { main: {driver:'memory'} } }; config.default='other'; export default config;`,
    `const config = { default: 'main', stores: { main: {driver:'memory'} } }; const changed = mutate(config); export default config;`,
    `export default ({env}) => { doSomething(); return { default:'main', stores:{} }; };`,
    `export default {default:'main', get stores(){ throw Error('PRIVATE'); }};`,
])('keeps dynamic configuration unknown (%#)', async code => {
    expect(await inspectCacheConfigFromAst(code, {})).toMatchObject({ status: 'unknown', stores: [] });
});
it('does not resolve arbitrary secret lookups or helper calls', async () => {
    const result = await inspectCacheConfigFromAst(`export default ({env}) => ({default: 'main', stores: {
        main: { driver: env('PRIVATE_SECRET'), requires: privateHelper() } } });`, { PRIVATE_SECRET: 'PRIVATE' });
    expect(result.stores[0]).toMatchObject({ driver: { status: 'unknown' }, requires: { status: 'unknown' } });
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
});
it('finds imported registration aliases, escaped functions and manual cache defaults', async () => {
    expect(await inspectStorageOverridesFromAst(`import { extendCacheDriver as register, cache } from '@cossackframework/framework/cache';
import { setRateLimitStore as override } from '@cossackframework/core';
register('kv', () => provider); override(provider); cache.setDefaultStore(provider);`))
        .toMatchObject({ cache: ['kv'], rateLimit: true, cacheDefault: true });
    expect(await inspectStorageOverridesFromAst(`import {extendCacheDriver as register} from '@cossackframework/framework'; helper(register);`)).toMatchObject({cache:['*']});
    expect(await inspectStorageOverridesFromAst(`import * as f from '@cossackframework/framework/cache'; f['extendCacheDriver']('kv', factory);`)).toMatchObject({cache:['kv']});
});
it('ordinary cache calls and text are not registration candidates', async () => {
    expect(await inspectStorageOverridesFromAst(`import {cache} from '@cossackframework/framework/cache';
cache.get('setDefaultStore'); const description='extendCacheDriver';`))
        .toEqual({ status:'resolved', cache:[], rateLimit:false, cacheDefault:false });
});
it('marks escaped facade/default aliases and malformed modules unknown', async () => {
    expect(await inspectStorageOverridesFromAst(`import * as f from '@cossackframework/framework/cache'; helper(f.cache);`)).toMatchObject({ cacheDefault:true });
    expect(await inspectStorageOverridesFromAst(`export default {`)).toMatchObject({ status:'unknown', cache:['*'], rateLimit:true, cacheDefault:true });
});
it('keeps escaped/dynamic namespace registrations unknown without tainting ordinary fixed properties', async () => {
    expect(await inspectStorageOverridesFromAst(`import * as f from '@cossackframework/framework/cache'; f[selection]('kv', provider);`))
        .toMatchObject({ cache:['*'], cacheDefault:true });
    expect(await inspectStorageOverridesFromAst(`import * as c from '@cossackframework/core'; helper(c);`)).toMatchObject({ rateLimit:true });
    expect(await inspectStorageOverridesFromAst(`import * as f from '@cossackframework/framework/cache'; f['cache'].get('key');`))
        .toMatchObject({ cache:[], cacheDefault:false });
});
