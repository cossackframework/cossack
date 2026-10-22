/**
 * Themes. As in VS Code, a theme is an extension: a plugin whose manifest has a `theme` field
 * and that ships the site templates, as files under `templates/` or as the `theme` export of
 * its `ui.ts`. One theme is active at a time and switching is a settings write. Templates
 * receive plain view data and helpers; they never read the database. Themes own templates,
 * never routes: the site's URLs come from its content.
 */
import type { HeadValue } from '@cossackframework/core';
import type { TemplateResult } from '@cossackframework/renderer';
import { fieldProblems } from './fields';
import { MENU_LOCATION, type MenuItemView } from './menus';
import type { SettingDeclaration } from './settings';
import { PRESET_SLUG, STYLE_PROPERTIES, TEXT_ALIGNMENTS, type StyleProperty } from './block-shape';
import type { BlockCondition, BlockLayout, BlockStyle, InputKind } from './blocks';
import type { ChoiceOption, FormValue } from './form-builder';

/** A named value blocks pick by slug: a colour, a font size or a spacing step. */
export interface Preset {
    readonly slug: string;
    readonly name: string;
    /** A CSS colour, or a CSS length for sizes and spacing. */
    readonly value: string;
}

/** The presets a theme offers the Style tab. Absent kinds take `DEFAULT_PRESETS`. */
export interface ThemePresets {
    readonly colors?: readonly Preset[];
    readonly fontSizes?: readonly Preset[];
    readonly spacing?: readonly Preset[];
}
export type PresetKind = keyof ThemePresets;
export const PRESET_KINDS = Object.freeze(['colors', 'fontSizes', 'spacing'] as const);

/** The `theme` field of a plugin manifest. */
export interface ThemeManifest {
    readonly label: string;
    readonly description?: string;
    /** Menu locations the theme renders, such as `{ "primary": "Primary menu" }`. */
    readonly locations?: { readonly [name: string]: string };
    /** Options shown under Appearance → Customize, stored as settings `<plugin>.<option>`. */
    readonly options?: { readonly [name: string]: SettingDeclaration };
    /**
     * A parent theme, by plugin name. The child's templates, loaders, assets, options, menu
     * locations and widget areas are layered over the parent's, slot by slot. Its option
     * values are its own.
     */
    readonly extends?: string;
    /** Widget areas: block lists edited under Appearance → Widgets, such as `{ "sidebar": "Sidebar" }`. */
    readonly areas?: { readonly [name: string]: string };
    /** The palette, font sizes and spacing steps blocks pick from; the site adjusts colours under Customize. */
    readonly presets?: ThemePresets;
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
    if (value.extends !== undefined && (typeof value.extends !== 'string' || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value.extends))) problems.push('theme.extends must name a theme plugin.');
    const areas = Object.entries(value.areas ?? {});
    if (areas.length > 8) problems.push('theme.areas: declare at most 8 widget areas.');
    for (const [name, label] of areas) {
        if (!MENU_LOCATION.test(name)) problems.push(`theme.areas: ${name} must be lowercase letters, digits and hyphens.`);
        if (typeof label !== 'string' || !label.trim() || label.length > 60) problems.push(`theme.areas.${name} needs a label of at most 60 characters.`);
    }
    const options = Object.entries(value.options ?? {});
    if (options.length > 16) problems.push('theme.options: declare at most 16 options.');
    for (const [name, option] of options) {
        if (!option || typeof option !== 'object' || !OPTION_KINDS.has(option.kind)) { problems.push(`theme.options.${name} must be a string, text, enum, boolean, integer or number field.`); continue; }
        if (option.unique || option.index || option.search || option.slugFrom || option.taxonomy || option.media) problems.push(`theme.options.${name} cannot be indexed, searched or derived.`);
        problems.push(...fieldProblems(name, option).map(problem => `theme.options: ${problem}`));
    }
    if (value.presets !== undefined) problems.push(...presetProblems(value.presets).map(problem => `theme.presets: ${problem}`));
    return problems;
}


/** A CSS colour: hex, a named colour, or a colour function without nested parentheses. */
const COLOR_VALUE = /^(?:#[0-9a-f]{3,8}|[a-z]{3,30}|(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\([^()]{1,60}\))$/i;
/** A CSS length, or `clamp()`, `min()`, `max()` and `calc()` of lengths. */
const LENGTH_VALUE = /^(?:-?\d*\.?\d+(?:px|rem|em|%|vw|vh|ch|cqi|cqw)?|(?:clamp|min|max|calc)\([-+*/\d.\s,%a-z]{1,60}\))$/i;
const PRESET_LIMITS: Readonly<Record<PresetKind, number>> = { colors: 24, fontSizes: 8, spacing: 8 };

/** Problems with presets, as a manifest declares them or as the site's custom colours; empty when valid. */
export function presetProblems(presets: unknown): string[] {
    if (!presets || typeof presets !== 'object' || Array.isArray(presets)) return ['presets is an object of colors, fontSizes and spacing.'];
    const problems: string[] = [];
    for (const [kind, list] of Object.entries(presets)) {
        if (!(PRESET_KINDS as readonly string[]).includes(kind)) { problems.push(`${kind} is not a preset kind; use ${PRESET_KINDS.join(', ')}.`); continue; }
        if (!Array.isArray(list)) { problems.push(`${kind} is a list.`); continue; }
        if (list.length > PRESET_LIMITS[kind as PresetKind]) problems.push(`${kind} lists at most ${PRESET_LIMITS[kind as PresetKind]} presets.`);
        const slugs = new Set<string>();
        for (const entry of list as Preset[]) {
            const at = `${kind}.${String(entry?.slug)}`;
            if (typeof entry?.slug !== 'string' || !PRESET_SLUG.test(entry.slug) || entry.slug.length > 40) { problems.push(`${kind}: slugs are lowercase letters, digits and hyphens.`); continue; }
            if (slugs.has(entry.slug)) problems.push(`${at} is listed twice.`);
            slugs.add(entry.slug);
            if (typeof entry.name !== 'string' || !entry.name.trim() || entry.name.length > 40) problems.push(`${at} needs a name of at most 40 characters.`);
            if (typeof entry.value !== 'string' || !(kind === 'colors' ? COLOR_VALUE : LENGTH_VALUE).test(entry.value.trim())) problems.push(`${at} needs a CSS ${kind === 'colors' ? 'colour' : 'length'}.`);
        }
    }
    return problems;
}

/** What a theme without its own gets: no palette, five font sizes and five spacing steps. */
export const DEFAULT_PRESETS: ThemePresets = Object.freeze({
    colors: Object.freeze([]),
    fontSizes: Object.freeze([
        { slug: 'small', name: 'Small', value: '0.875rem' }, { slug: 'medium', name: 'Medium', value: '1rem' }, { slug: 'large', name: 'Large', value: '1.25rem' },
        { slug: 'x-large', name: 'Extra large', value: '1.5rem' }, { slug: 'xx-large', name: 'Huge', value: '2.25rem' },
    ]),
    spacing: Object.freeze([
        { slug: 'none', name: 'None', value: '0' }, { slug: 'small', name: 'Small', value: '0.75rem' }, { slug: 'medium', name: 'Medium', value: '1.5rem' },
        { slug: 'large', name: 'Large', value: '3rem' }, { slug: 'x-large', name: 'Extra large', value: '5rem' },
    ]),
});

/** `top`'s presets over `base`'s, slug by slug, kind by kind; a kind `top` lists at all is its own list plus the base's extra slugs. */
export function layerPresets(base: ThemePresets | undefined, top: ThemePresets | undefined): ThemePresets {
    const result: { -readonly [K in PresetKind]?: Preset[] } = {};
    for (const kind of PRESET_KINDS) {
        const lower = base?.[kind];
        const upper = top?.[kind];
        if (!lower && !upper) continue;
        const merged = new Map<string, Preset>();
        for (const preset of upper ?? []) merged.set(preset.slug, preset);
        for (const preset of lower ?? []) if (!merged.has(preset.slug)) merged.set(preset.slug, preset);
        result[kind] = [...merged.values()];
    }
    return result;
}

/** The site's changes to the active theme's palette: new values by slug, and colours it added. */
export interface PresetOverrides {
    readonly colors?: { readonly [slug: string]: string };
    readonly custom?: readonly Preset[];
}

/** A problem with `appearance.presets` entries, which are overrides keyed by theme; undefined when valid. */
export function presetOverridesProblem(value: unknown): string | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return 'Preset overrides are an object.';
    const { colors, custom } = value as PresetOverrides;
    if (colors !== undefined) {
        if (!colors || typeof colors !== 'object' || Array.isArray(colors)) return 'colors maps slugs to colours.';
        for (const [slug, color] of Object.entries(colors)) {
            if (!PRESET_SLUG.test(slug) || typeof color !== 'string' || !COLOR_VALUE.test(color.trim())) return `${slug} needs a CSS colour.`;
        }
    }
    if (custom !== undefined) {
        const problems = presetProblems({ colors: custom });
        if (problems.length) return problems[0]!.replace(/^colors[.:]?\s?/, '');
    }
    return undefined;
}

/** The presets blocks pick from: the theme's over the defaults, with the site's colour changes and additions. */
export function resolvePresets(theme: ThemePresets | undefined, overrides?: PresetOverrides | null): Required<ThemePresets> {
    const layered = layerPresets(DEFAULT_PRESETS, theme);
    const colors = (layered.colors ?? []).map(preset => overrides?.colors?.[preset.slug] ? { ...preset, value: overrides.colors[preset.slug]! } : preset);
    const custom = (overrides?.custom ?? []).filter(preset => !colors.some(entry => entry.slug === preset.slug));
    return { colors: [...colors, ...custom], fontSizes: layered.fontSizes ?? [], spacing: layered.spacing ?? [] };
}

const PRESET_VARIABLES: Readonly<Record<PresetKind, string>> = { colors: '--cms-color', fontSizes: '--cms-size', spacing: '--cms-space' };

/** The presets as custom properties for an inline `style`, such as `--cms-color-brand: #0f172a;`. */
export function presetStyle(presets: ThemePresets | undefined): string {
    if (!presets) return '';
    return PRESET_KINDS.flatMap(kind => (presets[kind] ?? []).map(preset => `${PRESET_VARIABLES[kind]}-${preset.slug}: ${preset.value.trim()};`)).join(' ');
}

/** What a styled block's wrapper carries: classes per property, the `id`, and inline properties through the presets' variables. Null for an unstyled block. */
export function blockStyleAttributes(block: { readonly style?: BlockStyle; readonly layout?: BlockLayout }): { className: string; style: string; id: string } | null {
    const classes: string[] = [];
    const rules: string[] = [];
    const slug = (property: StyleProperty) => {
        const value = block.style?.[property];
        return typeof value === 'string' && PRESET_SLUG.test(value) && value.length <= 40 ? value : '';
    };
    const background = slug('background');
    if (background) { classes.push(`cms-bg-${background}`); rules.push(`background-color: var(--cms-color-${background})`); }
    const text = slug('text');
    if (text) { classes.push(`cms-text-${text}`); rules.push(`color: var(--cms-color-${text})`); }
    const padding = slug('padding');
    if (padding) { classes.push(`cms-p-${padding}`); rules.push(`padding: var(--cms-space-${padding})`); }
    const margin = slug('margin');
    if (margin) { classes.push(`cms-m-${margin}`); rules.push(`margin-block: var(--cms-space-${margin})`); }
    const fontSize = slug('fontSize');
    if (fontSize) { classes.push(`cms-size-${fontSize}`); rules.push(`font-size: var(--cms-size-${fontSize})`); }
    const align = block.style?.align;
    if (align && (TEXT_ALIGNMENTS as readonly string[]).includes(align)) { classes.push(`cms-align-${align}`); rules.push(`text-align: ${align}`); }
    const extra = (block.layout?.className ?? '').trim().split(/\s+/).filter(name => /^-?[_A-Za-z][\w-]*$/.test(name));
    const id = /^[A-Za-z][\w-]{0,59}$/.test(block.layout?.anchor ?? '') ? block.layout!.anchor! : '';
    if (!classes.length && !extra.length && !id) return null;
    return { className: ['cms-block', ...classes, ...extra].join(' '), style: rules.join('; '), id };
}

/** Why a site's Additional CSS is refused: it may not load other resources or run scripts. Undefined when fine. */
export function customCssProblem(css: string): string | undefined {
    if (css.length > 20_000) return 'Additional CSS is at most 20,000 characters.';
    if (/@import\b/i.test(css)) return 'Additional CSS cannot use @import.';
    if (/\burl\s*\(/i.test(css)) return 'Additional CSS cannot use url().';
    if (/\bexpression\s*\(|\bbehavior\s*:|-moz-binding|javascript:/i.test(css)) return 'Additional CSS cannot run scripts.';
    if (/<\/?\s*(?:style|script)\b/i.test(css)) return 'Additional CSS cannot contain HTML tags.';
    return undefined;
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
    /** The term's icon name, or empty. Themes may show it before the name. */
    readonly icon?: string;
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
    /** How the block shows: `hide` lists the container widths it is hidden at; `anchor` and `className` go on its wrapper. */
    readonly layout?: BlockLayout;
    /** Preset slugs the block's wrapper renders as classes and custom properties; see `blockStyleAttributes`. */
    readonly style?: BlockStyle;
    /** In a form: when the block shows, from the form's values. */
    readonly when?: BlockCondition;
    /** In a form: false while its condition hides it. The block still renders, marked `data-hidden`. */
    readonly shown?: boolean;
    /** An input block in a form: its name, value and error. */
    readonly input?: InputView;
    /** `core/form`: the form it places; absent when the form is gone. */
    readonly form?: FormView;
    /** Rich text fields rendered: HTML runs and embedded blocks, for `helpers.content`. */
    readonly content?: { readonly [field: string]: readonly BodyPart[] };
    /** `core/latest-entries`: the entries it lists. */
    readonly entries?: readonly EntryView[];
    /** A data block: it holds values for themes and the API and renders nothing. */
    readonly dataOnly?: boolean;
    /** The rendered blocks a container holds. */
    readonly children?: readonly RenderedBlock[];
}

/** An input block's state in a rendered form. */
export interface InputView {
    readonly name: string;
    readonly kind: InputKind;
    /** The control's HTML id, unique on the page. */
    readonly id: string;
    /** What the form starts with, or what the sender typed when the post came back with errors. */
    readonly value: FormValue | null;
    readonly error: string;
    readonly options: readonly ChoiceOption[];
}

/**
 * A form as themes render it: its blocks with their inputs' state, and what the post needs.
 * The default renderer posts it as HTML and lets `cms/form.client.ts` apply conditions and
 * check values in the browser.
 */
export interface FormView {
    readonly id: string;
    readonly slug: string;
    readonly title: string;
    /** POST target: `/api/cms/forms/<slug>`. */
    readonly action: string;
    /** The page the form is on, where a post returns. */
    readonly page: string;
    readonly blocks: readonly RenderedBlock[];
    readonly submitLabel: string;
    /** After a post came back: the confirmation, or what went wrong, as escaped HTML. */
    readonly notice: { readonly kind: 'success' | 'error'; readonly html: string } | null;
    /** The closed message as escaped HTML when the form takes no submissions; its fields are not shown. */
    readonly closed: string | null;
    /** Visitors must sign in first: where to. */
    readonly signInUrl: string | null;
    /** When the page was rendered, for the hidden `_started` field. */
    readonly startedAt: number;
    readonly turnstileSiteKey: string | null;
    /** Input kinds by block type, for the browser's checks. */
    readonly kinds: { readonly [type: string]: InputKind };
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

/** A reference field's target: an entry with its title and URL, or a record of another resource. */
export interface EntryReference {
    readonly id: string;
    readonly title: string;
    /** The entry's public URL; null for records that are not on the site. */
    readonly url: string | null;
}

/**
 * A field's value on an entry view, by the field's kind: text, enums and slugs as strings,
 * numbers and datetimes (Unix milliseconds) as numbers, booleans, media as `MediaView` (a
 * list of media as `MediaView[]`), references as `EntryReference`, taxonomy terms as
 * `TermLink[]`, other lists as arrays, groups as objects, and in full views rich text and
 * Markdown as `BodyPart[]` (render with `helpers.content`) and blocks as `RenderedBlock[]`.
 * Absent and empty values are null.
 */
export type FieldView =
    | string | number | boolean | null
    | readonly (string | number | boolean)[]
    | MediaView | readonly MediaView[]
    | EntryReference
    | readonly TermLink[]
    | readonly BodyPart[]
    | readonly RenderedBlock[]
    | { readonly [name: string]: unknown };

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
    /**
     * Every field by name with its typed value (see `FieldView`), so a theme can lay out a
     * collection's own fields. Rich text, Markdown and blocks are present in full views only.
     */
    readonly fields: { readonly [name: string]: FieldView };
    /** Scalar fields with values as labelled text, derived from `fields`, for a details list. */
    readonly details: readonly { readonly label: string; readonly value: string }[];
    /** The template an editor chose for this entry, such as `entry-wide`; null for the default. */
    readonly template: string | null;
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
    /** The collection listed, such as `posts`; null for a search across collections. */
    readonly collection: string | null;
    /** term: the taxonomy, such as `category`. */
    readonly taxonomy: string | null;
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
    /** The blocks of the theme's widget areas, by area; render them with `helpers.block`. */
    readonly areas: { readonly [area: string]: readonly RenderedBlock[] };
}

/** Plain JSON a theme's loaders return. */
export type ThemeData = { readonly [key: string]: unknown };

/** What the host gives every template. */
export interface ThemeHelpers {
    /** The active theme's option values, defaults applied. */
    readonly options: { readonly [name: string]: unknown };
    /** The presets blocks pick from, the site's changes applied; `presetStyle(helpers.presets)` renders them as custom properties. */
    readonly presets: Required<ThemePresets>;
    /**
     * What the theme's loaders returned: `layout` in the layout and head templates, `page` in
     * the page's template. Empty when the theme has no loader for the page, or it failed.
     */
    readonly data: { readonly layout: ThemeData; readonly page: ThemeData };
    /** The URL of a file in the theme's `assets/`, such as `asset('assets/theme.css')`; empty when it has none. */
    asset(path: string): string;
    /** A body: HTML runs and embedded blocks. */
    content(parts: readonly BodyPart[]): TemplateResult;
    /** A block through the theme's renderer, a plugin's component or the core one. */
    block(block: RenderedBlock): TemplateResult | null;
    /** Whether a URL is the current page or one of its ancestors. */
    isActive(url: string): boolean;
}

/** An entry template, from `templates/entry.ts` or `templates/entry-<collection>.ts`. */
export type EntryTemplate = (entry: EntryView, helpers: ThemeHelpers) => TemplateResult;
/** A list template: an archive, a term, the home page or search results. */
export type ArchiveTemplate = (view: ArchiveView, helpers: ThemeHelpers) => TemplateResult;

/**
 * A theme's templates: the `theme` export of its `ui.ts`, or the default exports of its
 * `templates/` files, assembled by `assembleSiteTheme`. The site picks the most specific one
 * for each page (`entryTemplate`, `archiveTemplate`).
 */
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
    /** Tags for the document head: stylesheets, fonts, meta. The page's own title and meta win. */
    head?(site: SiteView, helpers: ThemeHelpers): HeadValue;
    /**
     * More specific templates by name: `entry-<collection>`, `archive-<collection>`, `term` and
     * `term-<taxonomy>`. A file `templates/entry-posts.ts` lands here as `entry-posts`.
     */
    readonly templates?: { readonly [name: string]: EntryTemplate | ArchiveTemplate };
    /** Block renderers that replace the core ones, by block type. */
    readonly blocks?: { readonly [type: string]: (block: RenderedBlock, helpers: ThemeHelpers) => TemplateResult | null };
}

/** Template files that fill the theme's named slots; every other file is a specific template. */
const TEMPLATE_FILES: { readonly [stem: string]: keyof SiteTheme } = { layout: 'layout', entry: 'entry', archive: 'archive', home: 'home', search: 'search', 'not-found': 'notFound', head: 'head' };
/** Names a specific template can have. */
export const SPECIFIC_TEMPLATE = /^(?:entry-[a-z][a-z0-9_-]*|archive-[a-z][a-z0-9_-]*|term(?:-[a-z][a-z0-9_-]*)?)$/;

/** The parts of a plugin registration a theme is assembled from. */
export interface ThemeSource {
    /** The `ui.ts` exports. */
    readonly ui?: { readonly [name: string]: unknown } | null;
    /** The `templates/*.ts` modules by file stem, such as `entry-posts`. */
    readonly templates?: { readonly [stem: string]: { readonly [name: string]: unknown } };
}

/**
 * A plugin's theme: its `templates/` files, with the `ui.ts` `theme` export on top, slot by slot.
 * `templates/layout.ts`, `entry.ts`, `archive.ts`, `home.ts`, `search.ts`, `not-found.ts` and
 * `head.ts` fill the named slots; any other file is a specific template under its stem. A child
 * theme passes its parent, whose theme it is layered over. Undefined when neither ships
 * templates; the result still needs `siteThemeProblems` before use.
 */
export function assembleSiteTheme(source: ThemeSource, parent?: ThemeSource): unknown {
    return parent ? layerSiteThemes(assembleOwnTheme(parent), assembleOwnTheme(source)) : assembleOwnTheme(source);
}

/** A theme layered over another, slot by slot: the top's named templates, specific templates and blocks win. */
export function layerSiteThemes(base: unknown, top: unknown): unknown {
    if (!base || typeof base !== 'object') return top;
    if (!top || typeof top !== 'object') return base;
    const under = base as { [name: string]: unknown };
    const over = top as { [name: string]: unknown };
    const merged: { [name: string]: unknown } = { ...under };
    for (const [name, value] of Object.entries(over)) if (value !== undefined && name !== 'templates' && name !== 'blocks') merged[name] = value;
    for (const name of ['templates', 'blocks']) {
        const both = { ...(under[name] as object | undefined), ...(over[name] as object | undefined) };
        if (Object.keys(both).length) merged[name] = both;
    }
    return merged;
}

function assembleOwnTheme(source: ThemeSource): unknown {
    const theme: { [name: string]: unknown } = {};
    const specific: { [name: string]: unknown } = {};
    for (const [stem, module] of Object.entries(source.templates ?? {})) {
        const template = module && typeof module === 'object' ? module.default : undefined;
        const slot = TEMPLATE_FILES[stem];
        if (slot) theme[slot] = template;
        else specific[stem] = template;
    }
    const exported = source.ui?.theme;
    if (exported && typeof exported === 'object') {
        const { templates, ...rest } = exported as { [name: string]: unknown };
        Object.assign(theme, rest);
        if (templates && typeof templates === 'object') Object.assign(specific, templates);
    } else if (exported !== undefined) {
        return exported;
    }
    if (Object.keys(specific).length) theme.templates = specific;
    return Object.keys(theme).length ? theme : undefined;
}

/** Problems with a theme's templates; empty when it can render the site. */
export function siteThemeProblems(theme: unknown): string[] {
    if (!theme || typeof theme !== 'object') return ['The theme has no templates: add templates/layout.ts, entry.ts and archive.ts, or export theme from ui.ts.'];
    const value = theme as { [name: string]: unknown };
    const problems: string[] = [];
    for (const name of ['layout', 'entry', 'archive']) if (typeof value[name] !== 'function') problems.push(`theme.${name} must be a function.`);
    for (const name of ['home', 'search', 'notFound', 'head']) if (value[name] !== undefined && typeof value[name] !== 'function') problems.push(`theme.${name} must be a function.`);
    if (value.templates !== undefined) {
        if (typeof value.templates !== 'object' || value.templates === null) problems.push('theme.templates must map template names to functions.');
        else for (const [name, template] of Object.entries(value.templates)) {
            if (!SPECIFIC_TEMPLATE.test(name)) problems.push(`theme.templates.${name}: name it entry-<collection>, archive-<collection>, term or term-<taxonomy>.`);
            else if (typeof template !== 'function') problems.push(`theme.templates.${name} must be a function.`);
        }
    }
    if (value.blocks !== undefined && (typeof value.blocks !== 'object' || value.blocks === null || Object.values(value.blocks).some(entry => typeof entry !== 'function'))) problems.push('theme.blocks must map block types to functions.');
    return problems;
}

/** What a site page shows, for choosing its template and loader. */
export type TemplatePage =
    | { readonly kind: 'entry'; readonly collection: string; readonly template?: string | null }
    | Pick<ArchiveView, 'kind' | 'collection' | 'taxonomy'>
    | { readonly kind: 'not-found' };

/**
 * Template names for a page, most specific first. An entry: the template an editor chose,
 * `entry-<collection>`, `entry`. A term: `term-<taxonomy>`, `term`, `archive-<collection>`,
 * `archive`. The home page: `home`, `archive-<collection>`, `archive`. Search: `search`,
 * `archive`. An archive: `archive-<collection>`, `archive`. Loaders are picked from the same list.
 */
export function templateCandidates(page: TemplatePage): string[] {
    if (page.kind === 'not-found') return ['not-found'];
    if (page.kind === 'entry') return [...new Set([...(page.template && SPECIFIC_TEMPLATE.test(page.template) && page.template.startsWith('entry-') ? [page.template] : []), `entry-${page.collection}`, 'entry'])];
    const archive = [...(page.collection ? [`archive-${page.collection}`] : []), 'archive'];
    if (page.kind === 'home') return ['home', ...archive];
    if (page.kind === 'search') return ['search', 'archive'];
    if (page.kind === 'term') return [...(page.taxonomy ? [`term-${page.taxonomy}`] : []), 'term', ...archive];
    return archive;
}

/** The theme's template of that name: a named slot (`entry`, `not-found`, ...) or a specific one. */
function namedTemplate(theme: SiteTheme, name: string): unknown {
    const slot = TEMPLATE_FILES[name];
    return slot ? theme[slot] : theme.templates?.[name];
}

/** The first of the candidates the theme has, or null. */
export function pickTemplate(theme: SiteTheme, candidates: readonly string[]): string | null {
    return candidates.find(name => typeof namedTemplate(theme, name) === 'function') ?? null;
}

/** The template for an entry: the one an editor chose, `entry-<collection>`, else `entry`. */
export function entryTemplate(theme: SiteTheme, collection: string, template?: string | null): EntryTemplate {
    const name = pickTemplate(theme, templateCandidates({ kind: 'entry', collection, template }));
    return name ? namedTemplate(theme, name) as EntryTemplate : theme.entry;
}

/** The template for a list, most specific first (see `templateCandidates`). Everything falls back to `archive`. */
export function archiveTemplate(theme: SiteTheme, view: Pick<ArchiveView, 'kind' | 'collection' | 'taxonomy'>): ArchiveTemplate {
    const name = pickTemplate(theme, templateCandidates(view));
    return name ? namedTemplate(theme, name) as ArchiveTemplate : theme.archive;
}

/** Templates an editor can choose for one entry: the theme's `entry-*` templates, by name. */
export function entryTemplateChoices(theme: SiteTheme | undefined): string[] {
    return Object.keys(theme?.templates ?? {}).filter(name => name.startsWith('entry-')).sort();
}
