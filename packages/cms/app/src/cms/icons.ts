/**
 * Icons for the dashboard and the site, any of the catalog's 1,246, drawn in the style
 * Settings → Appearance picks. `icon(name)` is a sprite reference, `<use href="…#name">` into
 * `/assets/icons/<style>/<group>.<version>.svg`, which the `cossackCmsIcons()` Vite plugin
 * serves and builds: no icon markup ships in the client bundle or the HTML, and the browser
 * caches each sprite for a year. The hot set (the site's and the dashboard's own icons) is one
 * sprite, so a dashboard page loads its icons in one request; any other icon comes from its
 * category's sprite.
 */
import { DEFAULT_ICON_STYLE, ICON_CATEGORIES, iconHref, isIconStyle, type IconStyleName } from '@cossackframework/cms';
import { getRequestContext } from '@cossackframework/core';
import type { IconEntry } from '@cossackframework/solar-icons/types';
import type { IconPickerCatalog, SpriteIconEntry } from '@cossackframework/ui';

/** The `<meta>` the dashboard (`dashboardHead()`) and the site's pages carry, so client renders draw the same style as the server. */
export const ICON_STYLE_META = 'cms-icon-style';

let clientStyle: IconStyleName | undefined;

/**
 * The style of this request's icons: on the server what the CMS middleware read from the
 * site's settings (Settings → Interface); on the client the page's meta tag, or failing that the
 * style of the first icon the server drew; `line` when nothing is at hand (jobs, tests). Read
 * once per page on the client.
 */
export function iconStyle(): IconStyleName {
    if (typeof document !== 'undefined') {
        if (!clientStyle) {
            const content = document.querySelector(`meta[name="${ICON_STYLE_META}"]`)?.getAttribute('content')
                ?? document.querySelector('use[href^="/assets/icons/"]')?.getAttribute('href')?.split('/')[3];
            clientStyle = isIconStyle(content) ? content : DEFAULT_ICON_STYLE;
        }
        return clientStyle;
    }
    const style = getRequestContext()?.get('cms.iconStyle');
    return isIconStyle(style) ? style : DEFAULT_ICON_STYLE;
}

/** For tests: forget the style read from the document. */
export function resetIconStyle(): void {
    clientStyle = undefined;
}

/** An icon by name in the request's style; a name outside the catalog gets the fallback. */
export function icon(name: string | undefined, fallback = 'document-text'): IconEntry {
    const style = iconStyle();
    const href = (name && iconHref(name, style)) || iconHref(fallback, style);
    if (!href) throw new Error(`${fallback} is not an icon of the catalog.`);
    const entry: SpriteIconEntry = { href };
    return entry;
}

/** Whether a name is in the catalog, for places that draw nothing rather than a fallback. */
export function hasIcon(name: string | undefined): boolean {
    return !!name && iconHref(name) !== undefined;
}

/** The whole catalog for the icon picker: every category and its names, drawn through `icon()`. */
export const ICON_CATALOG: IconPickerCatalog = Object.freeze({ categories: ICON_CATEGORIES, entry: (name: string) => icon(name) });

/** Names offered for collections, in the builder's order. */
export const COLLECTION_ICONS = Object.freeze(['document-text', 'notebook', 'box', 'bag-4', 'cart-large-2', 'shop', 'gallery', 'calendar-mark', 'map-point', 'star', 'bookmark', 'case', 'cup', 'home-2', 'notes', 'clipboard-list', 'graph', 'medal-ribbon', 'video-library', 'music-note', 'book', 'ticket', 'user-id', 'hashtag', 'widget-add']);

/** A block's icon; plugin blocks naming an icon the catalog lacks get a generic one. */
export function blockIcon(name: string | undefined): IconEntry {
    return icon(name, 'widget-4');
}

/**
 * The color of a block's icon by its category, so block types tell apart at a glance: text
 * blue, media violet, design amber, widgets emerald, embeds sky, form fields rose, data slate.
 */
export const BLOCK_CATEGORY_COLORS: Readonly<Record<string, string>> = Object.freeze({
    text: 'text-blue-600 dark:text-blue-400', media: 'text-violet-600 dark:text-violet-400', design: 'text-amber-600 dark:text-amber-400',
    widgets: 'text-emerald-600 dark:text-emerald-400', embeds: 'text-sky-600 dark:text-sky-400', form: 'text-rose-600 dark:text-rose-400', field: 'text-teal-600 dark:text-teal-400', data: 'text-slate-500 dark:text-slate-400',
});

export function blockIconColor(category: string | undefined): string {
    return BLOCK_CATEGORY_COLORS[category ?? ''] ?? 'text-muted-foreground';
}
