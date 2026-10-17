/**
 * Themes. As in VS Code, a theme is an extension: a plugin whose manifest has a `theme` field
 * and whose `ui.ts` exports `theme`, the site templates. One theme is active at a time and
 * switching is a settings write. Templates receive plain view data and helpers; they never
 * read the database.
 */
import type { TemplateResult } from '@cossackframework/renderer';
import { fieldProblems } from './fields';
import { MENU_LOCATION, type MenuItemView } from './menus';
import type { SettingDeclaration } from './settings';

/** The `theme` field of a plugin manifest. */
export interface ThemeManifest {
    readonly label: string;
    readonly description?: string;
    /** Menu locations the theme renders, such as `{ "primary": "Primary menu" }`. */
    readonly locations?: { readonly [name: string]: string };
    /** Options shown under Appearance → Customize, stored as settings `<plugin>.<option>`. */
    readonly options?: { readonly [name: string]: SettingDeclaration };
}

const OPTION_KINDS = new Set(['string', 'text', 'enum', 'boolean', 'integer', 'number']);

/** Problems with a manifest's `theme` field; empty when valid. */
export function themeProblems(theme: unknown): string[] {
    if (!theme || typeof theme !== 'object' || Array.isArray(theme)) return ['theme must be an object.'];
    const value = theme as ThemeManifest;
    const problems: string[] = [];
    if (typeof value.label !== 'string' || !value.label.trim() || value.label.length > 60) problems.push('theme.label must be 1-60 characters.');
    if (value.description !== undefined && (typeof value.description !== 'string' || value.description.length > 300)) problems.push('theme.description can be at most 300 characters.');
    const locations = Object.entries(value.locations ?? {});
    if (locations.length > 8) problems.push('theme.locations: declare at most 8 menu locations.');
    for (const [name, label] of locations) {
        if (!MENU_LOCATION.test(name)) problems.push(`theme.locations: ${name} must be lowercase letters, digits and hyphens.`);
        if (typeof label !== 'string' || !label.trim() || label.length > 60) problems.push(`theme.locations.${name} needs a label of at most 60 characters.`);
    }
    const options = Object.entries(value.options ?? {});
    if (options.length > 16) problems.push('theme.options: declare at most 16 options.');
    for (const [name, option] of options) {
        if (!option || typeof option !== 'object' || !OPTION_KINDS.has(option.kind)) { problems.push(`theme.options.${name} must be a string, text, enum, boolean, integer or number field.`); continue; }
        if (option.unique || option.index || option.search || option.slugFrom || option.taxonomy || option.media) problems.push(`theme.options.${name} cannot be indexed, searched or derived.`);
        problems.push(...fieldProblems(name, option).map(problem => `theme.options: ${problem}`));
    }
    return problems;
}

export interface MediaView {
    readonly url: string;
    readonly alt: string;
    /** Size after the image's crop. */
    readonly width: number | null;
    readonly height: number | null;
    readonly contentType: string;
    readonly caption: string;
    /** Resized variants for `<img srcset>`; empty when the image is served as uploaded. */
    readonly srcset: string;
    /** `srcset` variants in a 16:9 shape around the focal point, for cards and headers. */
    readonly wideSrcset: string;
}

export interface TermLink {
    readonly name: string;
    readonly url: string | null;
}

/** A block with its Markdown fields rendered and its media resolved. */
export interface RenderedBlock {
    readonly id: string;
    readonly type: string;
    readonly data: { readonly [field: string]: unknown };
    /** Markdown fields rendered to escaped HTML. */
    readonly html: { readonly [field: string]: string };
    /** Media the block uses, by file ID. */
    readonly media: { readonly [id: string]: MediaView };
}

/** A run of escaped HTML from the body, or a block embedded in it. */
export type BodyPart = { readonly kind: 'html'; readonly html: string } | { readonly kind: 'block'; readonly block: RenderedBlock };

/** A comment as themes show it, with its replies. */
export interface CommentView {
    readonly id: string;
    readonly author: string;
    /** The author's website, when given. */
    readonly authorUrl: string | null;
    readonly avatar: string | null;
    readonly date: string;
    /** The text as escaped paragraphs. */
    readonly html: string;
    readonly replies: readonly CommentView[];
    /** Replies may nest below this comment. */
    readonly replyable: boolean;
}

/** What the comment form posts and asks for. */
export interface CommentFormView {
    /** POST target: `/api/cms/comments`, with `collection`, `entry`, `parent`, `content`, `authorName`, `authorEmail`, `authorUrl`. */
    readonly action: string;
    readonly collection: string;
    readonly entry: string;
    /** The signed-in commenter's name; empty for visitors. */
    readonly userName: string;
    readonly requireNameEmail: boolean;
    /** Visitors must sign in first, at `signInUrl`. */
    readonly requireSignIn: boolean;
    readonly signInUrl: string;
    /** Turnstile's site key when the site checks for bots, else null. */
    readonly turnstileSiteKey: string | null;
}

export interface CommentsView {
    readonly open: boolean;
    /** Approved comments. */
    readonly count: number;
    readonly items: readonly CommentView[];
    /** Null when comments are closed. */
    readonly form: CommentFormView | null;
    /** After posting: `held` when the comment awaits moderation, `posted` when it shows. */
    readonly notice: '' | 'held' | 'posted';
    /** Why the last post failed: comments `closed`, `sign-in` needed, posting `too-fast`, an `invalid` form, or a failed `bot` check. */
    readonly error: '' | 'closed' | 'sign-in' | 'too-fast' | 'invalid' | 'bot';
}

/** The current page in another of the site's languages. */
export interface LanguageLink {
    readonly code: string;
    /** The language's own name, such as `Français`. */
    readonly label: string;
    readonly url: string;
    readonly current: boolean;
}

export interface EntryView {
    readonly id: string;
    readonly title: string;
    readonly url: string | null;
    /** The collection's name, such as `posts`. */
    readonly collection: string;
    /** The collection's singular label, such as `Post`. */
    readonly kind: string;
    /** The publication date in the site's format; empty for unpublishable collections. */
    readonly date: string;
    readonly author: string;
    readonly excerpt: string;
    /** The rendered body, empty in lists. */
    readonly body: readonly BodyPart[];
    /** Blocks of the entry's blocks field, empty in lists. */
    readonly blocks: readonly RenderedBlock[];
    readonly image: MediaView | null;
    readonly terms: readonly { readonly label: string; readonly terms: readonly TermLink[] }[];
    /** Other fields with values, for a details list. */
    readonly details: readonly { readonly label: string; readonly value: string }[];
    /** The entry's language code. */
    readonly locale: string;
    /** Comments, when the collection takes them and the view is full; else null. */
    readonly comments: CommentsView | null;
}

export interface Paging {
    readonly page: number;
    readonly pages: number;
    /** The first page's URL; others add `?page=N`. */
    readonly base: string;
}

export interface ArchiveView {
    /** `home` is the latest posts on the front page. */
    readonly kind: 'home' | 'archive' | 'term' | 'search';
    readonly title: string;
    readonly description: string;
    readonly entries: readonly EntryView[];
    readonly paging: Paging;
    /** search: the query. */
    readonly query: string;
}

export interface SiteView {
    readonly title: string;
    readonly tagline: string;
    /** The blog's URL, when posts are on the site. */
    readonly blog: string | null;
    /** Resolved menus by location; an unassigned primary location lists top-level pages. */
    readonly menus: { readonly [location: string]: readonly MenuItemView[] };
    /** The page's language. */
    readonly locale: string;
    /** The page in each of the site's languages; empty for a site with one language. */
    readonly languages: readonly LanguageLink[];
    /** Where the search form posts in this language, such as `/search` or `/fr/search`. */
    readonly searchUrl: string;
    /** The home page in this language, such as `/` or `/fr`. */
    readonly homeUrl: string;
}

/** What the host gives every template. */
export interface ThemeHelpers {
    /** The active theme's option values, defaults applied. */
    readonly options: { readonly [name: string]: unknown };
    /** A body: HTML runs and embedded blocks. */
    content(parts: readonly BodyPart[]): TemplateResult;
    /** A block through the theme's renderer, a plugin's component or the core one. */
    block(block: RenderedBlock): TemplateResult | null;
    /** Whether a URL is the current page or one of its ancestors. */
    isActive(url: string): boolean;
}

/** The `theme` export of a theme's `ui.ts`. */
export interface SiteTheme {
    /** The frame around every page. */
    layout(site: SiteView, content: TemplateResult, helpers: ThemeHelpers): TemplateResult;
    /** One entry: a post, a page or an entry of another collection. */
    entry(entry: EntryView, helpers: ThemeHelpers): TemplateResult;
    /** A collection or term archive. Also the front page and search results when those are absent. */
    archive(view: ArchiveView, helpers: ThemeHelpers): TemplateResult;
    home?(view: ArchiveView, helpers: ThemeHelpers): TemplateResult;
    search?(view: ArchiveView, helpers: ThemeHelpers): TemplateResult;
    notFound?(helpers: ThemeHelpers): TemplateResult;
    /** Block renderers that replace the core ones, by block type. */
    readonly blocks?: { readonly [type: string]: (block: RenderedBlock, helpers: ThemeHelpers) => TemplateResult | null };
}

/** Problems with a `ui.ts` `theme` export; empty when it can render the site. */
export function siteThemeProblems(theme: unknown): string[] {
    if (!theme || typeof theme !== 'object') return ['ui.ts must export theme.'];
    const value = theme as { [name: string]: unknown };
    const problems: string[] = [];
    for (const name of ['layout', 'entry', 'archive']) if (typeof value[name] !== 'function') problems.push(`theme.${name} must be a function.`);
    for (const name of ['home', 'search', 'notFound']) if (value[name] !== undefined && typeof value[name] !== 'function') problems.push(`theme.${name} must be a function.`);
    if (value.blocks !== undefined && (typeof value.blocks !== 'object' || value.blocks === null || Object.values(value.blocks).some(entry => typeof entry !== 'function'))) problems.push('theme.blocks must map block types to functions.');
    return problems;
}
