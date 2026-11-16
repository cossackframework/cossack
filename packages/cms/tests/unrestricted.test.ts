import { beforeAll, describe, expect, it } from 'vitest';
import { beforeWrite, NETWORK_ADMIN, PERMISSIONS, UNRESTRICTED_GRANT, userPrincipal, type CmsPluginManifest } from '../src/index';
import { createCMS, defineResource, field, systemPrincipal, type CmsHost, type PluginContext } from '../src/server/index';
import { live, romedbService } from './helpers';

const owner = userPrincipal('owner', [NETWORK_ADMIN], [PERMISSIONS.managePlugins]);
const siteAdmin = userPrincipal('helper', ['admin'], [PERMISSIONS.managePlugins]);
const system = systemPrincipal('unrestricted tests');
const tickets = defineResource({ name: 'tickets', fields: { subject: field.string({ required: true, max: 120 }) } });

const raw: CmsPluginManifest = { schemaVersion: 1, name: 'raw', version: '1.0.0', permissions: { unrestricted: true } };
const plain: CmsPluginManifest = { schemaVersion: 1, name: 'plain', version: '1.0.0', permissions: { cache: true } };

describe.skipIf(!live)('unrestricted plugins', () => {
    const service = romedbService();
    const contexts = new Map<string, PluginContext>();
    const fetched: string[] = [];
    let writes = 0;
    let cms: CmsHost;
    const registration = (manifest: CmsPluginManifest) => ({
        name: manifest.name, version: manifest.version, manifest,
        module: {
            register(context: PluginContext) {
                if (!contexts.has(manifest.name)) contexts.set(manifest.name, context);
                // No `hooks` in the manifest: only an unrestricted plugin gets this far.
                if (manifest.permissions?.unrestricted) context.hooks.addFilter(beforeWrite, draft => { writes++; return draft; });
            },
        },
    });
    const host = (manifests: readonly CmsPluginManifest[]) => createCMS({
        db: service.database(), resources: [tickets], plugins: manifests.map(registration),
        secrets: name => ({ ROMEDB_TOKEN: 'top-secret' })[name], env: { ROMEDB_TOKEN: 'top-secret', BUCKET: 'a binding' },
        fetch: async input => { fetched.push(String(input)); return new Response('ok'); },
    });
    const status = async (name: string, on = cms) => (await on.status()).plugins.find(plugin => plugin.name === name)!;
    const context = (name: string) => contexts.get(name)!;

    beforeAll(async () => {
        cms = host([raw, plain]);
        expect((await cms.migrate()).failed).toBeUndefined();
        await cms.ready();
    }, 30_000);

    it('stays off until a network admin confirms it, and a bulk grant or a site admin cannot', async () => {
        expect(await status('raw')).toMatchObject({ unrestricted: true, active: false, themeOnly: false });
        expect((await status('raw')).missing).toContain(UNRESTRICTED_GRANT);
        await expect(context('raw').unrestricted()).rejects.toMatchObject({ code: 'CMS_UNAVAILABLE' });
        await expect(cms.grantPlugin('raw', owner)).rejects.toMatchObject({ code: 'CMS_CONFLICT' });
        await expect(cms.grantPlugin('raw', siteAdmin, { unrestricted: true })).rejects.toMatchObject({ code: 'CMS_FORBIDDEN' });
        await expect(cms.grantPlugin('raw', system, { unrestricted: true })).rejects.toMatchObject({ code: 'CMS_FORBIDDEN' });
        expect(await cms.pluginActive('raw')).toBe(false);
        expect(await cms.grantPlugin('raw', owner, { unrestricted: true })).toMatchObject({ active: true, missing: [] });
    });

    it('gives the database with no rules, the whole host and every binding', async () => {
        const { db, host: whole, env } = await context('raw').unrestricted();
        await db.write([{ rql: "INSERT INTO cms_settings (key, value, updated_at) VALUES ('raw.note', 'written directly', 1)" }], { kind: 'test' });
        const stored = await db.read([{ rql: "SELECT value FROM cms_settings WHERE key = 'raw.note'" }]);
        expect(stored.results[0]!.rows).toEqual([['written directly']]);
        expect(whole).toBe(cms);
        expect(env).toEqual({ ROMEDB_TOKEN: 'top-secret', BUCKET: 'a binding' });
    });

    it('lifts the limits of the other members without listing them', async () => {
        const plugin = context('raw');
        await plugin.cache.set('hello', 'world', 60_000);
        expect(await plugin.cache.get('hello')).toBe('world');
        expect(await plugin.secrets.get('ROMEDB_TOKEN')).toBe('top-secret');
        await plugin.fetch('https://anywhere.example/collect');
        expect(fetched).toEqual(['https://anywhere.example/collect']);
        await plugin.cms.resource('app/tickets').create({ subject: 'Any resource' }, { principal: system });
        expect(writes).toBe(1);
    });

    it('leaves a limited plugin limited', async () => {
        expect(await status('plain')).toMatchObject({ unrestricted: false });
        await cms.grantPlugin('plain', siteAdmin);
        expect(await cms.pluginActive('plain')).toBe(true);
        const plugin = context('plain');
        await expect(plugin.unrestricted()).rejects.toMatchObject({ code: 'CMS_FORBIDDEN' });
        await expect(plugin.secrets.get('ROMEDB_TOKEN')).rejects.toMatchObject({ code: 'CMS_FORBIDDEN' });
        await expect(plugin.fetch('https://anywhere.example/collect')).rejects.toMatchObject({ code: 'CMS_FORBIDDEN' });
        expect(() => plugin.cms.resource('app/tickets')).toThrow(/no grant/);
    });

    it('writes who approved it to the audit trail', async () => {
        const { items } = await cms.audit.list({ action: 'grant-unrestricted' });
        expect(items).toMatchObject([{ actor: 'owner', resource: 'cms/plugins', recordId: 'raw' }]);
    });

    it('waits for a new grant when an upgrade starts asking for it', async () => {
        const upgraded = host([raw, { ...plain, version: '2.0.0', permissions: { cache: true, unrestricted: true } }]);
        await upgraded.ready();
        expect(await status('plain', upgraded)).toMatchObject({ unrestricted: true, active: false });
        expect((await status('plain', upgraded)).missing).toEqual([UNRESTRICTED_GRANT]);
        await expect(upgraded.grantPlugin('plain', owner)).rejects.toMatchObject({ code: 'CMS_CONFLICT' });
    });

    it('asks a new grant of everything when an unrestricted plugin requests more', async () => {
        const more = host([{ ...raw, version: '2.0.0', permissions: { unrestricted: true, cache: true } }, plain]);
        await more.ready();
        expect((await status('raw', more)).missing).toEqual(['capability:cache']);
        await expect(more.grantPlugin('raw', owner)).rejects.toMatchObject({ code: 'CMS_CONFLICT' });
        expect(await more.grantPlugin('raw', owner, { unrestricted: true })).toMatchObject({ active: true });
    });

    it('stops when any plugin manager disables it', async () => {
        await cms.revokePlugin('raw', siteAdmin);
        await expect(context('raw').unrestricted()).rejects.toMatchObject({ code: 'CMS_UNAVAILABLE' });
    });

    it('treats a theme that asks for it as a plugin, not as a theme alone', async () => {
        const noop = () => null as never;
        const themed = createCMS({ db: service.database(), plugins: [{ name: 'bold', version: '1.0.0', templates: { layout: { default: noop }, entry: { default: noop }, archive: { default: noop } },
            manifest: { schemaVersion: 1, name: 'bold', version: '1.0.0', theme: { label: 'Bold' }, permissions: { unrestricted: true } } }] });
        await themed.ready();
        expect(await status('bold', themed)).toMatchObject({ themeOnly: false, unrestricted: true, active: false });
    });
});
