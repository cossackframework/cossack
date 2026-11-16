/**
 * The dashboard menu as administrators arrange it: which of the built-in modules show, in what
 * order, and the links they add. Stored in the `dashboard.menu` setting; the application builds
 * the default navigation for the signed-in user and applies this on top, so a module the user
 * may not see stays away whatever the order says. Pure shapes and checks.
 */

export interface DashboardMenuLink {
    /** Letters, digits, `-` and `_`; unique among the links. */
    readonly id: string;
    readonly label: string;
    /** A same-site path (`/dashboard/...`, `/...`) or an http(s) URL. */
    readonly href: string;
    /** An icon of the dashboard's set; the application falls back to a link icon. */
    readonly icon?: string;
}

export interface DashboardMenu {
    /** Module IDs (built-in `collection-posts`, `media`, ..., or `link-<id>`) in the order they show; unlisted ones follow in the default order. */
    readonly order: readonly string[];
    /** Module IDs that are not shown. */
    readonly hidden: readonly string[];
    readonly links: readonly DashboardMenuLink[];
}

export const EMPTY_DASHBOARD_MENU: DashboardMenu = Object.freeze({ order: [], hidden: [], links: [] });
export const DASHBOARD_MENU_LIMITS = Object.freeze({ links: 30, label: 60, href: 2000, ids: 200 });

const LINK_ID = /^[A-Za-z0-9_-]{1,40}$/;
const MODULE_ID = /^[A-Za-z0-9_.:/-]{1,120}$/;

/** The ID of the module a custom link becomes. */
export function dashboardLinkModuleId(link: Pick<DashboardMenuLink, 'id'>): string {
    return `link-${link.id}`;
}

/** Whether a link's address stays on this site or names an http(s) URL. */
export function dashboardLinkHrefProblem(href: unknown): string | undefined {
    if (typeof href !== 'string' || !href.trim()) return 'needs an address.';
    if (href.length > DASHBOARD_MENU_LIMITS.href) return `is longer than ${DASHBOARD_MENU_LIMITS.href} characters.`;
    if (/[\s<>"']/.test(href)) return 'has spaces or quotes.';
    if (href.startsWith('/')) return href.startsWith('//') ? 'must not start with //.' : undefined;
    try {
        const url = new URL(href);
        return url.protocol === 'http:' || url.protocol === 'https:' ? undefined : 'must be a path on this site or an http(s) URL.';
    } catch {
        return 'must be a path on this site or an http(s) URL.';
    }
}

/** What is wrong with a menu, as sentences; empty when it can be saved. */
export function dashboardMenuProblems(input: unknown): string[] {
    if (input === null || input === undefined) return [];
    if (!input || typeof input !== 'object' || Array.isArray(input)) return ['The dashboard menu must be an object.'];
    const value = input as Record<string, unknown>;
    const problems: string[] = [];
    for (const key of ['order', 'hidden'] as const) {
        const list = value[key];
        if (list === undefined) continue;
        if (!Array.isArray(list) || list.length > DASHBOARD_MENU_LIMITS.ids || list.some(id => typeof id !== 'string' || !MODULE_ID.test(id))) problems.push(`${key} lists up to ${DASHBOARD_MENU_LIMITS.ids} module IDs.`);
        else if (new Set(list).size !== list.length) problems.push(`${key} repeats a module.`);
    }
    const links = value.links;
    if (links !== undefined) {
        if (!Array.isArray(links) || links.length > DASHBOARD_MENU_LIMITS.links) problems.push(`links holds up to ${DASHBOARD_MENU_LIMITS.links} links.`);
        else {
            const ids = new Set<string>();
            links.forEach((link, index) => {
                const at = `Link ${index + 1}`;
                if (!link || typeof link !== 'object') { problems.push(`${at} must be an object.`); return; }
                const { id, label, href, icon } = link as Record<string, unknown>;
                if (typeof id !== 'string' || !LINK_ID.test(id)) problems.push(`${at}: the ID is letters, digits, - and _.`);
                else if (ids.has(id)) problems.push(`${at}: the ID ${id} is used twice.`);
                else ids.add(id);
                if (typeof label !== 'string' || !label.trim() || label.length > DASHBOARD_MENU_LIMITS.label) problems.push(`${at}: a label of 1 to ${DASHBOARD_MENU_LIMITS.label} characters.`);
                const problem = dashboardLinkHrefProblem(href);
                if (problem) problems.push(`${at}: the address ${problem}`);
                if (icon !== undefined && (typeof icon !== 'string' || icon.length > 64)) problems.push(`${at}: the icon is a name of the dashboard's set.`);
            });
        }
    }
    for (const key of Object.keys(value)) if (!['order', 'hidden', 'links'].includes(key)) problems.push(`${key} is not part of the dashboard menu.`);
    return problems;
}

/** A stored value as a menu; anything unusable is the empty menu, so a bad setting never hides the dashboard. */
export function dashboardMenuOf(value: unknown): DashboardMenu {
    if (!value || typeof value !== 'object' || dashboardMenuProblems(value).length) return EMPTY_DASHBOARD_MENU;
    const stored = value as Partial<DashboardMenu>;
    return { order: [...(stored.order ?? [])], hidden: [...(stored.hidden ?? [])], links: (stored.links ?? []).map(link => ({ ...link })) };
}

/**
 * The modules as the menu arranges them: the links become modules (through `link`), hidden ones
 * leave, and the listed ones come first in the menu's order, the rest after in their own order.
 */
export function applyDashboardMenu<T extends { readonly id: string }>(modules: readonly T[], menu: DashboardMenu, link: (entry: DashboardMenuLink) => T): T[] {
    const all = [...modules, ...menu.links.map(link)];
    const hidden = new Set(menu.hidden);
    const rank = new Map(menu.order.map((id, index) => [id, index]));
    return all.filter(module => !hidden.has(module.id))
        .map((module, index) => ({ module, key: rank.get(module.id) ?? menu.order.length + index }))
        .sort((a, b) => a.key - b.key)
        .map(entry => entry.module);
}
