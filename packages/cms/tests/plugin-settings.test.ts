import { beforeAll, describe, expect, it } from 'vitest';
import { createCMS, parseSettingsDocument, systemPrincipal, userPrincipal, type CmsHost, type PluginContext, type PluginSettingsDeclaration } from '../src/server/index';
import { live, romedbService } from './helpers';

const admin = systemPrincipal('plugin settings tests');
const editor = userPrincipal('editor', ['editor'], ['cms:dashboard']);
const declaration: PluginSettingsDeclaration = { label: 'Delivery', fields: {
    enabled: { kind: 'boolean', default: false },
    sender: { kind: 'string', default: 'Original sender' },
} };

describe.skipIf(!live)('plugin settings lifecycle', () => {
    const service = romedbService();
    let cms: CmsHost;
    let context: PluginContext;
    const plugin = (settings: PluginSettingsDeclaration = declaration, name = 'delivery') => ({
        name, version: '1.0.0', manifest: { schemaVersion: 1, name, version: '1.0.0', settings },
        module: { register(value: PluginContext) { context = value; } },
    });

    beforeAll(async () => {
        cms = createCMS({ db: service.database(), plugins: [plugin()] });
        expect((await cms.migrate()).failed).toBeUndefined();
        await cms.ready();
    }, 30_000);

    it('lets administrators configure an inactive plugin without activating it', async () => {
        expect(await cms.pluginActive('delivery')).toBe(false);
        await expect(cms.settings.update('plugin:delivery', { sender: 'Not allowed' }, { principal: editor })).rejects.toMatchObject({ code: 'CMS_FORBIDDEN' });
        await cms.settings.update('plugin:delivery', { enabled: true, sender: 'Saved sender' }, { principal: admin });
        expect(await cms.settings.get('plugin:delivery.sender')).toBe('Saved sender');
        expect(await cms.pluginActive('delivery')).toBe(false);
        await expect(context.settings.all()).rejects.toMatchObject({ code: 'CMS_UNAVAILABLE' });
    });

    it('reads saved values after activation and refuses reads after revocation', async () => {
        await cms.grantPlugin('delivery', admin);
        expect(await context.settings.all()).toEqual({ enabled: true, sender: 'Saved sender' });
        expect(await context.settings.get('enabled')).toBe(true);
        await cms.revokePlugin('delivery', admin);
        await expect(context.settings.get('enabled')).rejects.toMatchObject({ code: 'CMS_UNAVAILABLE' });
        expect(await cms.settings.get('plugin:delivery.sender')).toBe('Saved sender');
    });

    it('ignores removed fields and retains rows across invalid upgrades and removal', async () => {
        const upgraded = createCMS({ db: service.database(), plugins: [plugin({ label: 'Delivery', fields: { enabled: { kind: 'boolean', default: false } } })] });
        expect(await upgraded.settings.all()).not.toHaveProperty('plugin:delivery.sender');
        const invalid = createCMS({ db: service.database(), plugins: [plugin({ label: 'Broken', fields: { enabled: { kind: 'json' as never } } })] });
        expect(invalid.settings.groups.some(group => group.plugin === 'delivery')).toBe(false);
        const removed = createCMS({ db: service.database() });
        expect(await removed.settings.all()).not.toHaveProperty('plugin:delivery.sender');
        const restored = createCMS({ db: service.database(), plugins: [plugin()] });
        expect(await restored.settings.get('plugin:delivery.sender')).toBe('Saved sender');
    });

    it('requires ordinary activation when a theme also contributes plugin settings', async () => {
        const theme = plugin(declaration, 'hybrid');
        const hybrid = createCMS({ db: service.database(), plugins: [{ ...theme,
            manifest: { ...theme.manifest, theme: { label: 'Hybrid', options: { accent: { kind: 'string', default: 'blue' } } } },
            ui: { theme: { layout: () => null, entry: () => null, archive: () => null } },
        }] });
        expect((await hybrid.status()).plugins.find(entry => entry.name === 'hybrid')).toMatchObject({ themeOnly: false, active: false });
        expect(hybrid.settings.group('hybrid').permission).toBe('cms:appearance');
        expect(hybrid.settings.group('hybrid').json).not.toBe(true);
        expect(hybrid.settings.group('plugin:hybrid').permission).toBe('cms:settings');
        await hybrid.grantPlugin('hybrid', admin);
        expect(await context.settings.get('sender')).toBe('Original sender');
    });

    it('round-trips color and file settings through forms and JSON as scalar values', async () => {
        const current = createCMS({ db: service.database(), plugins: [plugin({ label: 'Brand', fields: {
            accent: { kind: 'string', control: 'color', default: '#2563eb' },
            download: { kind: 'string', control: 'file', fileKinds: ['document'], nullable: true, default: null },
        } }, 'brand')] });
        expect((await current.settings.snapshot({ principal: admin }))['plugin:brand']).toEqual({ accent: '#2563eb', download: null });
        await current.settings.update('plugin:brand', { accent: '#1234', download: '/media/guide.pdf' }, { principal: admin });
        const exported = parseSettingsDocument(await current.settings.exportDocument({ principal: admin }));
        expect(exported['plugin:brand']).toEqual({ accent: '#1234', download: '/media/guide.pdf' });
        await expect(current.settings.applyDocument({ 'plugin:brand': { accent: 'blue', download: 'javascript:alert(1)' } }, { principal: admin })).rejects.toMatchObject({ code: 'CMS_VALIDATION' });
        expect((await current.settings.snapshot({ principal: admin }))['plugin:brand']).toEqual(exported['plugin:brand']);
        await current.settings.applyDocument({ 'plugin:brand': { accent: '#ABCDEF88', download: null } }, { principal: admin });
        expect((await current.settings.snapshot({ principal: admin }))['plugin:brand']).toEqual({ accent: '#ABCDEF88', download: null });
        await current.settings.applyDocument({ 'plugin:brand': exported['plugin:brand']! }, { principal: admin });
        await current.grantPlugin('brand', admin);
        expect(await context.settings.all()).toEqual({ accent: '#1234', download: '/media/guide.pdf' });
    });
});
