/**
 * Icons by name. Any icon of @cossackframework/solar-icons (`ICON_CATEGORIES`, generated) can be
 * chosen wherever the dashboard asks for one, and drawn on the site and in the dashboard in the
 * style Settings → Appearance picks. Icons ship as sprites of `<symbol>`s under `/assets/icons/`,
 * one per style and category plus one of the hot set below, written by the `cossackCmsIcons()`
 * Vite plugin (`@cossackframework/cms/vite`); a page draws `<svg><use href="…#name">`, so no icon
 * markup is in the HTML or the bundles, and the browser caches each sprite for a year.
 */
import { ICON_CATEGORIES, ICON_SET_VERSION, type IconCategory } from './icon-catalog';

export { ICON_CATEGORIES, ICON_SET_VERSION, type IconCategory };

export const ICON_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The six Solar styles, as the icon package names them. */
export const ICON_STYLES = Object.freeze(['line', 'bold', 'duotone', 'broken', 'outline', 'line-duotone'] as const);
export type IconStyleName = (typeof ICON_STYLES)[number];
export const ICON_STYLE_LABELS: Readonly<Record<IconStyleName, string>> = Object.freeze({
    line: 'Line', bold: 'Bold', duotone: 'Bold duotone', broken: 'Broken', outline: 'Outline', 'line-duotone': 'Line duotone',
});
export const DEFAULT_ICON_STYLE: IconStyleName = 'line';

export function isIconStyle(value: unknown): value is IconStyleName {
    return typeof value === 'string' && (ICON_STYLES as readonly string[]).includes(value);
}

export const SITE_ICON_NAMES: readonly string[] = Object.freeze([
    // Marks and states
    'check-circle', 'close-circle', 'add-circle', 'info-circle', 'question-circle', 'danger-triangle', 'star', 'stars', 'heart', 'like', 'smile-circle',
    // Energy and achievement
    'bolt', 'rocket', 'lightbulb', 'crown', 'medal-ribbon', 'cup', 'gift', 'confetti', 'target', 'flag',
    // Trust and technology
    'shield', 'shield-check', 'shield-star', 'lock', 'key', 'settings', 'code-square', 'cpu', 'server-2', 'database', 'cloud', 'global', 'earth',
    // Places and time
    'map', 'map-point', 'pin', 'home-2', 'buildings', 'bell', 'clock-circle', 'calendar', 'hourglass', 'history', 'refresh',
    // Numbers and money
    'chart', 'chart-2', 'chart-square', 'pie-chart', 'graph', 'course-up', 'course-down', 'dollar', 'euro', 'wallet', 'wallet-money', 'hand-money', 'hand-heart',
    // Commerce
    'cart-large-2', 'bag-4', 'shop', 'delivery', 'box', 'tag',
    // Contact and people
    'letter', 'mailbox', 'phone', 'chat-round-dots', 'chat-round-line', 'dialog', 'link', 'share', 'user', 'user-circle', 'user-id', 'user-plus', 'users-group-rounded', 'case',
    // Documents and learning
    'book', 'bookmark', 'notebook', 'document-text', 'notes', 'clipboard-list', 'checklist', 'list-check', 'diploma', 'square-academic-cap', 'pen', 'magnifier', 'eye',
    // Media and devices
    'camera', 'gallery', 'video-frame', 'play-circle', 'music-note', 'microphone', 'monitor', 'laptop', 'smartphone', 'tablet', 'palette', 'ruler', 'scale',
    // Nature, travel and health
    'leaf', 'sun', 'moon', 'fire', 'snowflake', 'umbrella', 'plane', 'bus', 'running', 'health', 'stethoscope', 'pills', 'hospital', 'bed',
    // Arrows
    'arrow-right', 'arrow-left', 'arrow-up', 'arrow-down', 'download-minimalistic', 'upload-minimalistic',
]);


/**
 * The icons the dashboard draws besides the site's: collections' choices, sections, blocks and
 * controls. With `SITE_ICON_NAMES` they make the hot sprite, which a dashboard page loads in one request.
 */
export const DASHBOARD_ICON_NAMES: readonly string[] = Object.freeze([
    'document-text', 'notebook', 'box', 'bag-4', 'cart-large-2', 'shop', 'gallery', 'calendar-mark', 'map-point', 'star', 'bookmark', 'case', 'cup', 'home-2',
    'notes', 'clipboard-list', 'graph', 'medal-ribbon', 'video-library', 'book', 'ticket', 'user-id', 'hashtag', 'folder', 'tag', 'widget-4', 'structure', 'tuning-2',
    'server-2', 'plug-circle', 'settings', 'text-field', 'palette-2', 'widget-add', 'chat-round-dots', 'paragraph-spacing', 'text-bold', 'gallery-wide', 'chat-round-line',
    'list', 'code-square', 'cursor-square', 'play-circle', 'video-frame', 'music-note', 'minus-square', 'layers', 'widget', 'widget-2', 'widget-3', 'smartphone',
    'tablet', 'monitor', 'trash-bin-trash', 'alt-arrow-down', 'alt-arrow-right', 'arrow-up', 'arrow-down', 'arrow-left', 'arrow-right', 'sidebar-minimalistic',
    'align-left', 'align-horizontal-center', 'align-right', 'palette', 'checklist-minimalistic', 'letter', 'link', 'phone', 'text-square', 'calculator', 'calendar',
    'list-down', 'record-circle', 'checklist', 'check-square', 'shield-check', 'eye-closed', 'inbox', 'download-minimalistic', 'upload-minimalistic', 'filter',
    'copy', 'pen', 'close-circle', 'sort-vertical', 'alt-arrow-up', 'login-2', 'posts-carousel-horizontal', 'card', 'text-selection', 'database', 'list-arrow-down',
    'link-round', 'hamburger-menu', 'history', 'eye', 'magnifier', 'check-circle', 'restart', 'pen-new-square', 'folder-with-files', 'user', 'users-group-rounded',
    'clock-circle', 'danger-triangle', 'info-circle', 'heart', 'flag', 'pin', 'lightbulb', 'bolt', 'global', 'map', 'crown', 'gift', 'rocket', 'menu-dots', 'cursor', 'add-square',
    // The dashboard shell and its account modules.
    'sun', 'moon', 'logout-3', 'monitor-smartphone', 'user-circle', 'shield-keyhole',
]);

/** The names of the hot sprite: the site's and the dashboard's own icons, in one file. */
export const HOT_ICON_NAMES: readonly string[] = Object.freeze([...new Set([...SITE_ICON_NAMES, ...DASHBOARD_ICON_NAMES])].sort());
const HOT_ICON_SET: ReadonlySet<string> = new Set(HOT_ICON_NAMES);

/** Every icon name of the catalog. */
export const ICON_NAME_SET: ReadonlySet<string> = new Set(ICON_CATEGORIES.flatMap(category => category.names));
const CATEGORY_OF: ReadonlyMap<string, string> = new Map(ICON_CATEGORIES.flatMap(category => category.names.map((name): [string, string] => [name, category.id])));

export function isIconName(value: unknown): value is string {
    return typeof value === 'string' && ICON_NAME_SET.has(value);
}

/** The category an icon belongs to, or undefined for a name outside the catalog. */
export function iconCategoryOf(name: string): string | undefined {
    return CATEGORY_OF.get(name);
}

/** The sprite groups: `hot` (the hot set) and one per category. */
export const ICON_SPRITE_GROUPS: readonly string[] = Object.freeze(['hot', ...ICON_CATEGORIES.map(category => category.id)]);

/** The names a sprite group holds, or undefined for an unknown group. */
export function iconSpriteNames(group: string): readonly string[] | undefined {
    if (group === 'hot') return HOT_ICON_NAMES;
    return ICON_CATEGORIES.find(category => category.id === group)?.names;
}

/** The sprite an icon is drawn from: the hot sprite when it is in the hot set, else its category's; undefined outside the catalog. */
export function iconSpriteGroup(name: string): string | undefined {
    return HOT_ICON_SET.has(name) ? 'hot' : CATEGORY_OF.get(name);
}

/** FNV-1a, 32 bits, as eight hex digits: enough to tell one list from another in a file name. */
function fingerprint(text: string): string {
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index++) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
}

/**
 * The version in every sprite's file name: the icon package's version and the hot set, so a
 * new package or a changed list is a new file (both adapters cache `/assets/*.<hash>.*` for a year).
 */
export const ICON_SPRITE_VERSION = `${ICON_SET_VERSION.replace(/[^a-zA-Z0-9]+/g, '')}${fingerprint(`${ICON_SET_VERSION}\n${HOT_ICON_NAMES.join(',')}`)}`;

/** Where a sprite is served: `/assets/icons/<style>/<group>.<version>.svg`. */
export function iconSpriteUrl(style: IconStyleName, group: string): string {
    return `/assets/icons/${style}/${group}.${ICON_SPRITE_VERSION}.svg`;
}

/** The `<use>` reference of an icon in a style, or undefined for a name outside the catalog. */
export function iconHref(name: string, style: IconStyleName = DEFAULT_ICON_STYLE): string | undefined {
    const group = iconSpriteGroup(name);
    return group ? `${iconSpriteUrl(style, group)}#${name}` : undefined;
}
