import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { iconNames, iconRegistry } from '@cossackframework/solar-icons/registry';
import { catalog, render } from '../scripts/icon-catalog.mjs';
import { interfaceGroup, DEFAULT_ICON_STYLE, field, HOT_ICON_NAMES, ICON_CATEGORIES, ICON_NAME_SET, ICON_SET_VERSION, ICON_SPRITE_GROUPS, ICON_SPRITE_VERSION, ICON_STYLES, iconCategoryOf, iconHref, iconSpriteGroup, iconSpriteUrl, isIconName, validateValue } from '../src/index';
import { cossackCmsIcons, iconSprite, xmlSafe } from '../src/vite';

describe('the icon catalog', () => {
    it('is current: the generated file is what the script writes from the installed package and the vendored categories', async () => {
        const fresh = render(await catalog());
        const written = await readFile(new URL('../src/icon-catalog.ts', import.meta.url), 'utf8');
        expect(written, 'run pnpm --filter @cossackframework/cms icons').toBe(fresh);
    });

    it('places every installed icon once, in a category Solar names or Other', () => {
        const names = ICON_CATEGORIES.flatMap(category => category.names);
        expect(names.length).toBe(iconNames.length);
        expect(new Set(names).size).toBe(names.length);
        expect([...names].sort()).toEqual([...iconNames].sort());
        expect(ICON_CATEGORIES.map(category => category.id)).toContain('arrows');
        expect(ICON_CATEGORIES.at(-1)?.id).toBe('other');
        expect(iconCategoryOf('eye')).toBe('security');
        expect(iconCategoryOf('nope')).toBeUndefined();
        expect(isIconName('asteroid')).toBe(true);
        expect(ICON_NAME_SET.has('check-circle')).toBe(true);
    });

    it('knows the six styles the package ships', () => {
        expect([...ICON_STYLES].sort()).toEqual(Object.keys(iconRegistry.eye!).sort());
        expect(ICON_SET_VERSION).toMatch(/^\d+\.\d+\.\d+/);
        expect(interfaceGroup.fields.iconStyle).toMatchObject({ kind: 'enum', default: DEFAULT_ICON_STYLE, values: [...ICON_STYLES] });
    });

    it('checks icon fields against the whole catalog', () => {
        const declaration = field.icon({ label: 'Icon' });
        expect(validateValue('icon', declaration, 'asteroid')).toBeUndefined();
        expect(validateValue('icon', declaration, 'check-circle')).toBeUndefined();
        expect(validateValue('icon', declaration, 'not-an-icon')).toBe('is not a known icon.');
    });
});

describe('the icon sprites', () => {
    it('name a file per style and group, versioned by the package and the hot set', () => {
        expect(ICON_SPRITE_VERSION).toMatch(/^[a-z0-9]{8,}$/);
        // The adapters cache /assets/<name>.<eight or more>.<ext> for a year.
        expect(iconSpriteUrl('line', 'hot')).toMatch(/^\/assets\/icons\/line\/hot\.[a-zA-Z0-9_-]{8,}\.svg$/);
        expect(ICON_SPRITE_GROUPS[0]).toBe('hot');
        expect(ICON_SPRITE_GROUPS.length).toBe(ICON_CATEGORIES.length + 1);
        expect(HOT_ICON_NAMES).toContain('document-text');
        expect(iconSpriteGroup('document-text')).toBe('hot');
        expect(iconSpriteGroup('asteroid')).toBe('astronomy');
        expect(iconHref('asteroid', 'bold')).toBe(`${iconSpriteUrl('bold', 'astronomy')}#asteroid`);
        expect(iconHref('document-text')).toBe(`${iconSpriteUrl('line', 'hot')}#document-text`);
        expect(iconHref('nope')).toBeUndefined();
    });

    it('are well-formed XML with a symbol per icon, in the style asked for', async () => {
        const hot = (await iconSprite('line', 'hot'))!;
        expect(hot.startsWith('<svg xmlns="http://www.w3.org/2000/svg"><symbol id="')).toBe(true);
        expect((hot.match(/<symbol /g) ?? []).length).toBe(HOT_ICON_NAMES.length);
        expect(hot).not.toMatch(/"[a-zA-Z][\w:-]*=/);
        const duotone = (await iconSprite('duotone', 'astronomy'))!;
        expect(duotone).toContain('<symbol id="asteroid"');
        expect(duotone).toContain(xmlSafe(iconRegistry.asteroid!.duotone!));
        expect(await iconSprite('line', 'nope')).toBeUndefined();
        expect(xmlSafe('<circle r="10"stroke="currentColor" fill="none"/>')).toBe('<circle r="10" stroke="currentColor" fill="none"/>');
    });

    it('serves a sprite in development and emits every sprite into the client build', async () => {
        const plugin = cossackCmsIcons();
        const handlers: ((request: { url?: string }, response: Record<string, unknown>, next: () => void) => void)[] = [];
        (plugin.configureServer as (server: unknown) => void)({ middlewares: { use: (handler: (typeof handlers)[number]) => handlers.push(handler) } });
        const respond = (url: string) => new Promise<{ status: number; headers: Record<string, string>; body: string; passed: boolean }>(resolve => {
            const result = { status: 200, headers: {} as Record<string, string>, body: '', passed: false };
            const response = {
                set statusCode(value: number) { result.status = value; },
                setHeader: (name: string, value: string) => { result.headers[name] = value; },
                end: (body?: string) => { result.body = body ?? ''; resolve(result); },
            };
            handlers[0]!({ url }, response, () => { result.passed = true; resolve(result); });
        });
        expect((await respond('/dashboard')).passed).toBe(true);
        const served = await respond(`${iconSpriteUrl('bold', 'hot')}?x=1`);
        expect(served.status).toBe(200);
        expect(served.headers['Content-Type']).toBe('image/svg+xml; charset=utf-8');
        expect(served.headers['Cache-Control']).toContain('immutable');
        expect(served.body).toContain('<symbol id="document-text"');
        expect((await respond('/assets/icons/bold/hot.stale.svg')).status).toBe(404);
        expect((await respond('/assets/icons/comic/hot.' + ICON_SPRITE_VERSION + '.svg')).status).toBe(404);

        const emitted: { fileName: string; source: string }[] = [];
        const generate = plugin.generateBundle as (this: unknown) => Promise<void>;
        await generate.call({ environment: { name: 'ssr' }, emitFile: (file: { fileName: string; source: string }) => emitted.push(file) });
        expect(emitted).toEqual([]);
        await generate.call({ environment: { name: 'client' }, emitFile: (file: { fileName: string; source: string }) => emitted.push(file) });
        expect(emitted.length).toBe(ICON_STYLES.length * ICON_SPRITE_GROUPS.length);
        expect(emitted.map(file => file.fileName)).toContain(iconSpriteUrl('outline', 'other').slice(1));
        expect(emitted.every(file => file.source.startsWith('<svg xmlns'))).toBe(true);
    }, 60_000);
});
