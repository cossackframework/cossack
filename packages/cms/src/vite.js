/**
 * `cossackCmsIcons()`: the Vite plugin that delivers the icons. For each Solar style it makes
 * one SVG sprite of `<symbol>`s per group (`ICON_SPRITE_GROUPS` in icons.ts: the hot set and one
 * per category) from the installed `@cossackframework/solar-icons`, serves them in development
 * and emits them into the client build under `/assets/icons/<style>/<group>.<version>.svg`,
 * where both adapters cache them for a year. Pages draw `<svg><use href="…#name">`, so no icon
 * markup travels in the HTML or the bundles and a style change in Settings changes URLs, not code.
 *
 *   import { cossackCmsIcons } from '@cossackframework/cms/vite';
 *   plugins: [cossackCmsIcons(), …]
 *
 * Plain JavaScript: Vite's config loader hands this file to Node as is, so it cannot be
 * TypeScript; the package's TypeScript modules it needs are loaded through Vite's `runnerImport`.
 */
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { runnerImport } from 'vite';

/**
 * A `<use>` of another file parses that file as XML, where `r="10"stroke="…"` (which the icon
 * package's artwork has, and HTML forgives) is an error that empties the whole sprite: put the
 * space back between attributes.
 * @param {string} markup
 */
export function xmlSafe(markup) {
    return markup.replace(/"(?=[a-zA-Z][\w:-]*=")/g, '" ');
}

/** @typedef {import('./icons').IconStyleName} IconStyleName */
/** @typedef {Pick<typeof import('./icons'), 'ICON_SPRITE_GROUPS' | 'ICON_SPRITE_VERSION' | 'ICON_STYLES' | 'iconSpriteNames' | 'iconSpriteUrl' | 'isIconStyle'>} IconModule */

/** @type {Promise<IconModule> | undefined} */
let iconModule;
/** The package's icons.ts (TypeScript), loaded once through Vite's module runner. */
function icons() {
    return iconModule ??= runnerImport(fileURLToPath(new URL('./icons.ts', import.meta.url)), { logLevel: 'silent' })
        .then(result => /** @type {IconModule} */ (result.module));
}

/** @type {Promise<Readonly<Record<string, Partial<Record<IconStyleName, string>>>>> | undefined} */
/**
 * One icon's artwork in a style, or undefined when the package lacks it. Each style of each icon
 * is its own small module, so a sprite loads only its own names: the package's registry imports
 * all 8,700 modules, half a minute on a slow file system, and stalls the dev server meanwhile.
 * @param {string} name
 * @param {IconStyleName} style
 * @returns {Promise<string | undefined>}
 */
async function artwork(name, style) {
    // Resolving each icon through the package's 2,500-entry exports map costs about 9 ms; its files sit at dist/<name>/<style>.js.
    const file = new URL(`${name}/${style}.js`, artworkRoot());
    // The module is one string constant; reading it as text is far cheaper than importing thousands of modules for a build.
    const literal = /=\s*("(?:[^"\\]|\\.)*")\s*;/.exec(await readFile(file, 'utf8').catch(() => ''))?.[1];
    if (literal) {
        try { return JSON.parse(literal); } catch { /* not plain JSON: import it */ }
    }
    try {
        const markup = Object.values(await import(`@cossackframework/solar-icons/${name}/${style}`))[0];
        return typeof markup === 'string' ? markup : undefined;
    } catch {
        return undefined;
    }
}

let root;
/** The folder of the icon package's built modules, next to its registry. */
function artworkRoot() {
    return root ??= new URL('./', import.meta.resolve('@cossackframework/solar-icons/registry'));
}

/**
 * The sprite of a group in a style, or undefined for an unknown group. Missing artwork in a
 * style falls back to line.
 * @param {IconStyleName} style
 * @param {string} group
 * @returns {Promise<string | undefined>}
 */
export async function iconSprite(style, group) {
    const names = (await icons()).iconSpriteNames(group);
    if (!names) return undefined;
    const symbols = await Promise.all(names.map(async name => {
        const markup = await artwork(name, style) ?? (style === 'line' ? undefined : await artwork(name, 'line'));
        if (!markup) throw new Error(`@cossackframework/solar-icons has no artwork for ${name}`);
        return `<symbol id="${name}" viewBox="0 0 24 24" fill="none">${xmlSafe(markup)}</symbol>`;
    }));
    return `<svg xmlns="http://www.w3.org/2000/svg">${symbols.join('')}</svg>`;
}

const SPRITE_PATH = /^\/assets\/icons\/([a-z-]+)\/([a-z0-9-]+)\.([a-z0-9]+)\.svg$/;

/** @returns {import('vite').Plugin} */
export function cossackCmsIcons() {
    /** @type {Map<string, Promise<string | undefined>>} */
    const made = new Map();
    /** @param {IconStyleName} style @param {string} group */
    const sprite = (style, group) => {
        const key = `${style}/${group}`;
        let pending = made.get(key);
        if (!pending) {
            pending = iconSprite(style, group);
            made.set(key, pending);
            pending.catch(() => made.delete(key));
        }
        return pending;
    };
    return {
        name: 'cossack:cms-icons',
        configureServer(server) {
            server.middlewares.use((request, response, next) => {
                const match = SPRITE_PATH.exec((request.url ?? '').split('?')[0] ?? '');
                if (!match) return next();
                const [, style, group, version] = match;
                icons().then(async module => {
                    if (!module.isIconStyle(style) || version !== module.ICON_SPRITE_VERSION) { response.statusCode = 404; response.end(); return; }
                    const body = await sprite(style, /** @type {string} */ (group));
                    if (!body) { response.statusCode = 404; response.end(); return; }
                    response.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
                    response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
                    response.end(body);
                }).catch(error => { response.statusCode = 500; response.end(error instanceof Error ? error.message : String(error)); });
            });
        },
        async generateBundle() {
            // The sprites are client assets; the server build and the plugin bundles do not carry them.
            if (this.environment?.name !== 'client') return;
            const module = await icons();
            for (const style of module.ICON_STYLES) {
                for (const group of module.ICON_SPRITE_GROUPS) {
                    const source = await sprite(style, group);
                    if (source) this.emitFile({ type: 'asset', fileName: module.iconSpriteUrl(style, group).slice(1), source });
                }
            }
        },
    };
}
