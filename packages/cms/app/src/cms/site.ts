/**
 * The public site on the CMS: the active theme, its menus, entries and archives as views, and
 * which entry, archive or term a URL names, in which language. Server-only; pages call these
 * from `init()` and hand the views to the theme's templates.
 */
import {
    ANONYMOUS, ARTICLE_TYPES, authorUrl, blockDocuments, blockIsData, blocksPlain, editedSize, hasBlockReference, parseBlockText, PATTERN_REFERENCE, resolveBindings, resolveBlockBindings, textBlocks, usesUserBinding, type BindingScopes, type ParsedText, flattenBlocks, escapeHtml, formatSiteDate, formInputs, formSettings, imageSrcset, imageUrl, isCmsError, languageName, mediaUrl, notificationRules, recordTitle, resolvePresets, richTextBlocks, richTextParts, richTextPlain, systemPrincipal, templateCandidates, transformable, urlList,
    type AuthorView, type Block,
    type Principal, type TemplatePage, type ThemeData, type ThemePresets,
    type ArchiveView, type BodyPart, type CollectionDefinition, type CommentShape, type CommentView, type CommentsView, type EntryReference, type EntryView, type FieldDeclaration, type FieldFilter,
    type FieldView, type LanguageLink, type MediaView, type MenuItemView, type RecordShape, type RenderedBlock, type RichTextDoc, type SiteSettings, type SiteView, type TermLink, type TermShape,
} from '@cossackframework/cms';
import { excerptOf, renderMarkdown, type CmsFile, type CmsHost, type CmsUser, type LoadedForm, type SiteLanguages } from '@cossackframework/cms/server';
import type { FormView } from '@cossackframework/cms';
import { formView, type FormRequest } from './site-forms';

/** The active theme, the theme it extends, its option values and presets, which every site page renders with. */
export interface ThemeState {
    name: string | null;
    parent?: string | null;
    options: Record<string, unknown>;
    /** The presets blocks pick from, the site's color changes applied. */
    presets?: Required<ThemePresets>;
    /** The site's Additional CSS, already checked. */
    customCss?: string;
}

const visitor = { principal: ANONYMOUS };
/** Patterns are private; the site reads them to render the entries that use them. */
const renderer = { principal: systemPrincipal('site') };

/** Texts with block references, parsed once per isolate: saving checks them, so serving a page parses each text once. */
const PARSED = new Map<string, ParsedText>();

function parsedText(cms: CmsHost, text: string): ParsedText {
    let parsed = PARSED.get(text);
    if (!parsed) {
        parsed = parseBlockText(text, cms.blockTypes);
        if (PARSED.size >= 500) PARSED.delete(PARSED.keys().next().value!);
        PARSED.set(text, parsed);
    }
    return parsed;
}

/** The blocks a block's Markdown fields reference, for collecting their media and patterns. */
function referencedBlocks(cms: CmsHost, block: { type: string; data: Record<string, unknown> }): Block[] {
    const found: Block[] = [];
    for (const [key, declaration] of Object.entries(cms.blockTypes.get(block.type)?.fields ?? {})) {
        const value = block.data[key];
        if (declaration.kind === 'text' && declaration.format === 'markdown' && hasBlockReference(value)) found.push(...flattenBlocks(textBlocks(parsedText(cms, value))));
    }
    return found;
}

/** What bindings read on a page: the entry (when there is one), the site's public settings and the signed-in user. */
export function bindingScopes(settings: SiteSettings, options: { entry?: Readonly<Record<string, unknown>> | null; user?: { readonly name: string } | null } = {}): BindingScopes {
    return {
        entry: options.entry ?? null,
        site: { title: settings['general.siteTitle'], tagline: settings['general.tagline'], logo: settings['general.logo'], icon: settings['general.favicon'] },
        user: options.user ?? null,
    };
}

/** Theme options with their bindings resolved, so a footer text can say `© {{ $site.title }}`. */
export function resolvedOptions(options: Readonly<Record<string, unknown>>, scopes: BindingScopes): Record<string, unknown> {
    return Object.fromEntries(Object.entries(options).map(([name, value]) => [name, typeof value === 'string' ? resolveBindings(value, scopes) : value]));
}

export async function themeState(cms: CmsHost): Promise<ThemeState> {
    const name = await cms.activeTheme();
    const theme = cms.themes().find(entry => entry.name === name);
    const settings = await cms.settings.all();
    const options = Object.fromEntries(Object.keys(theme?.options?.fields ?? {}).map(option => [option, settings[`${name}.${option}`]]));
    return { name, parent: theme?.parent ?? null, options, presets: resolvePresets(theme?.presets, name ? settings['appearance.presets']?.[name] : null), customCss: settings['appearance.customCss'] ?? '' };
}

/** The active theme's presets with the site's changes, for the editors' Style tab. */
export async function activePresets(cms: CmsHost): Promise<Required<ThemePresets>> {
    const name = await cms.activeTheme();
    const theme = cms.themes().find(entry => entry.name === name);
    const settings = await cms.settings.all();
    return resolvePresets(theme?.presets, name ? settings['appearance.presets']?.[name] : null);
}

/**
 * What the active theme's loader for a page returns: the first of the page's template
 * candidates the theme has a loader for (`layout` for the layout). Empty when there is none.
 */
export function themeData(cms: CmsHost, theme: ThemeState, page: TemplatePage | 'layout', view: SiteView | EntryView | ArchiveView, principal: Principal, locale?: string): Promise<ThemeData> {
    return cms.themeData(theme.name, page === 'layout' ? ['layout'] : templateCandidates(page), view, { principal, options: theme.options, ...(locale ? { locale } : {}) });
}

/** The URL prefix of a language: empty for the default one. */
export function localePrefix(languages: SiteLanguages, locale: string): string {
    return languages.multilingual && locale !== languages.default && languages.others.includes(locale) ? `/${locale}` : '';
}

/** Language filter for queries: only on a site with several languages. */
function localeWhere(languages: SiteLanguages, locale: string): { [field: string]: FieldFilter } {
    return languages.multilingual ? { locale } : {};
}

/** The layout's data: site title, tagline, the menus of the active theme's locations and the language links. */
export async function siteView(cms: CmsHost, theme: ThemeState, options: { locale?: string; languages?: readonly LanguageLink[]; forms?: FormRequest; template?: string | null; entry?: RecordShape | null; user?: { name: string } | null; usage?: { user: boolean } } = {}): Promise<SiteView & { noindex: boolean }> {
    const settings = await cms.settings.all();
    const languages = await cms.languages();
    const locale = options.locale ?? languages.default;
    const info = cms.themes().find(entry => entry.name === theme.name);
    const declared = info?.locations.map(location => location.name) ?? [];
    const locations = declared.length ? declared : ['primary'];
    const menus: Record<string, readonly MenuItemView[]> = {};
    for (const location of locations) {
        const menu = await cms.menus.forLocation(location, languages.multilingual ? locale : undefined).catch(() => null);
        if (menu) menus[location] = menu;
        else if (location === 'primary') menus[location] = await pageMenu(cms, languages, locale);
    }
    let blog: string | null = null;
    try { blog = await cms.archiveUrl(cms.collection('posts'), locale); } catch { /* no posts */ }
    return {
        title: settings['general.siteTitle'], tagline: settings['general.tagline'], logo: settings['general.logo'] || null, blog, menus, noindex: settings['reading.discourageSearchEngines'],
        locale, languages: options.languages ?? [], searchUrl: `${localePrefix(languages, locale)}/search`, homeUrl: localePrefix(languages, locale) || '/',
        areas: await areaViews(cms, info?.areas.map(area => area.name) ?? [], options.forms, bindingScopes(settings, options), options.usage),
        template: options.template ?? null,
    };
}

/** The blocks of the theme's widget areas, rendered; blocks of inactive plugins are left out. */
async function areaViews(cms: CmsHost, names: readonly string[], forms?: FormRequest, scopes?: BindingScopes, usage?: { user: boolean }): Promise<Record<string, RenderedBlock[]>> {
    if (!names.length) return {};
    const saved = await cms.areas.all().catch(() => new Map<string, { blocks: readonly { id: string; type: string; data: Record<string, unknown> }[] }>());
    const available = new Set((await cms.blocks()).map(block => block.name));
    const blocks = new Map(names.map(name => [name, (saved.get(name)?.blocks ?? []).filter(block => available.has(block.type))]));
    const all = [...blocks.values()].flat() as Block[];
    const patterns = await usedPatterns(cms, blockDocuments(all, cms.blockTypes), all);
    const expanded = new Map([...blocks].map(([name, list]) => [name, expandPatterns(list as Block[], patterns)]));
    const ids = new Set<string>();
    for (const list of expanded.values()) for (const block of list) blockMediaIds(cms, block as { type: string; data: Record<string, unknown> }, ids);
    const files = cms.files && ids.size ? await cms.files.getMany([...ids]) : new Map<string, CmsFile>();
    const richText = bodyRenderer(cms, files, patterns);
    // Widgets bind like entry blocks: on an entry's page `$` is that entry, and `$site` and `$user` are there everywhere.
    const areas = Object.fromEntries([...expanded].map(([name, list]) => [name, list.map(block => renderedBlock(cms, block as { _id: string; type: string; data: Record<string, unknown> }, files, doc => richText(doc, scopes), scopes, { patterns, usage }))]));
    await withForms(cms, Object.values(areas).flat(), forms);
    await withLatest(cms, Object.values(areas).flat());
    return areas;
}

/**
 * Give each `core/latest-entries` block among these its entries: the newest published entries
 * of the collection it names, with the term it asks for, as list views (no bodies).
 */
async function withLatest(cms: CmsHost, blocks: readonly RenderedBlock[], locale?: string): Promise<void> {
    const found: RenderedBlock[] = [];
    walkBlocks(blocks, block => { if (block.type === 'core/latest-entries') found.push(block); });
    const languages = found.length ? await cms.languages() : null;
    for (const block of found) {
        const name = typeof block.data.collection === 'string' ? block.data.collection : '';
        const collection = cms.collections().find(entry => entry.name === name);
        if (!collection || collection.publishable === false) continue;
        const term = typeof block.data.term === 'string' && block.data.term ? block.data.term : '';
        const count = Math.min(Math.max(Number(block.data.count) || 5, 1), 24);
        const order = block.data.order === 'title' ? { field: 'title', direction: 'asc' as const } : { field: 'publishedAt', direction: block.data.order === 'oldest' ? 'asc' as const : 'desc' as const };
        try {
            const where: { [field: string]: FieldFilter } = { status: 'published', ...(languages && locale ? localeWhere(languages, locale) : {}) };
            if (term) {
                const found = await cms.taxonomies.get(term);
                const field = found ? collection.taxonomies?.find(taxonomy => taxonomy === found.taxonomy) : undefined;
                if (!field) { (block as { entries?: readonly EntryView[] }).entries = []; continue; }
                where[field] = { containsAny: (await cms.taxonomies.subtree(term)).slice(0, 50) };
            }
            const page = await cms.resource(`cms/${collection.name}`).list({ where, order, limit: count }, visitor);
            (block as { entries?: readonly EntryView[] }).entries = await entryViews(cms, collection, page.records);
        } catch (error) { if (!isCmsError(error)) throw error; }
    }
}

/** Visit these blocks, their children and the blocks embedded in their rich text, depth first. */
function walkBlocks(blocks: readonly RenderedBlock[], visit: (block: RenderedBlock) => void): void {
    for (const block of blocks) {
        visit(block);
        if (block.children) walkBlocks(block.children, visit);
        for (const parts of Object.values(block.content ?? {})) walkBlocks(parts.flatMap(part => part.kind === 'block' ? [part.block] : []), visit);
    }
}

/**
 * Rich text as body parts: HTML runs and rendered blocks, synced patterns expanded one level.
 * For the rich text inside blocks, the entry's rich text fields among them.
 */
function bodyRenderer(cms: CmsHost, files: ReadonlyMap<string, CmsFile>, patterns: ReadonlyMap<string, Block[]>, usage?: { user: boolean }): (doc: RichTextDoc, scope?: BindingScopes, depth?: number) => BodyPart[] {
    const resizes = cms.files?.resizes ?? false;
    const media = (id: string) => {
        const view = mediaView(files.get(id), resizes);
        return view ? { url: view.url, width: view.width, height: view.height, srcset: view.srcset } : null;
    };
    const parts = (doc: RichTextDoc, scope?: BindingScopes, depth = 0): BodyPart[] => richTextParts(doc, { media }).flatMap((part): BodyPart[] => {
        if (part.kind === 'html') return [part];
        const inner = depth === 0 ? (doc: RichTextDoc) => parts(doc, scope, 1) : undefined;
        if (part.block.type === 'core/pattern') {
            // A pattern embedded in rich text: its blocks in its place, once.
            return depth === 0 ? expandPatterns([part.block as Block], patterns).map(block => ({ kind: 'block' as const, block: renderedBlock(cms, block, files, inner, scope, { patterns, usage }) })) : [];
        }
        return [{ kind: 'block' as const, block: renderedBlock(cms, part.block as RenderedBlock, files, inner, scope, { patterns, usage }) }];
    });
    return parts;
}

/** Give each `core/form` block among these its form, for the page's request. A form that is gone renders nothing. */
async function withForms(cms: CmsHost, blocks: readonly RenderedBlock[], request: FormRequest | undefined): Promise<void> {
    if (!request) return;
    const found: RenderedBlock[] = [];
    walkBlocks(blocks, block => { if (block.type === 'core/form') found.push(block); });
    for (const block of found) {
        const slug = typeof block.data.form === 'string' ? block.data.form : '';
        try {
            const form = slug ? await cms.forms.get(slug) : null;
            if (!form?.published) continue;
            const ids = new Set<string>();
            for (const entry of form.blocks) blockMediaIds(cms, entry, ids);
            const files = cms.files && ids.size ? await cms.files.getMany([...ids]) : new Map<string, CmsFile>();
            (block as { form?: FormView }).form = await formView(cms, form, request, entry => renderedBlock(cms, entry, files));
        } catch (error) { if (!isCmsError(error)) throw error; }
    }
}

/** Without an assigned menu, the primary location lists the published top-level pages. */
async function pageMenu(cms: CmsHost, languages: SiteLanguages, locale: string): Promise<MenuItemView[]> {
    try {
        const pages = cms.collection('pages');
        const where = { status: 'published', parent: null, ...localeWhere(languages, locale) };
        const repository = cms.resource('cms/pages');
        const top = await repository.list({ where, order: { field: 'menuOrder', direction: 'asc' }, limit: 12 }, visitor);
        const urls = await cms.entryUrls(pages, top.records);
        return top.records.flatMap(record => {
            const url = urls.get(record.id);
            return url ? [{ id: record.id, label: recordTitle(record, 'title'), url, newTab: false, kind: 'entry' as const, className: '', attributes: {}, meta: {}, children: [] }] : [];
        });
    } catch { return []; /* before setup, or without pages */ }
}

/** A file as themes show it: cropped through a variant when the host resizes images, with `srcset`s. */
export function mediaView(file: CmsFile | undefined, resizes: boolean): MediaView | null {
    if (!file) return null;
    const source = { ...file, version: file.updatedAt };
    const variants = resizes && transformable(file.contentType);
    const size = variants ? editedSize(file) : null;
    const url = variants && file.edits?.crop && size ? imageUrl(source, { width: Math.min(size.width, 2560) }) : mediaUrl(file);
    return {
        url, alt: file.alt, width: size?.width ?? file.width, height: size?.height ?? file.height, contentType: file.contentType, caption: file.caption,
        srcset: variants ? imageSrcset(source) : '', wideSrcset: variants ? imageSrcset(source, { aspect: 16 / 9 }) : '',
        placeholder: file.placeholder,
    };
}

/**
 * A block with its Markdown rendered, its rich text as parts (through `richText`, when given),
 * its media resolved and its children rendered. With `scopes`, text fields show what their
 * bindings read (`{{ $.price }}`, `{{ $site.title }}`). Markdown with block references renders
 * as `content.<field>`: its text runs and the referenced blocks, synced patterns expanded.
 */
function renderedBlock(cms: CmsHost, block: { _id: string; type: string; data: Record<string, unknown>; layout?: RenderedBlock['layout']; style?: RenderedBlock['style']; when?: RenderedBlock['when']; children?: readonly unknown[] },
    files: ReadonlyMap<string, CmsFile>, richText?: (doc: RichTextDoc) => BodyPart[], scope?: BindingScopes, refs: { patterns?: ReadonlyMap<string, Block[]>; usage?: { user: boolean }; depth?: number } = {}): RenderedBlock {
    const html: Record<string, string> = {};
    const media: Record<string, MediaView> = {};
    const content: Record<string, BodyPart[]> = {};
    const resizes = cms.files?.resizes ?? false;
    const type = cms.blockTypes.get(block.type);
    const bound = Object.entries(type?.fields ?? {}).filter(([, declaration]) => (declaration.kind === 'string' && !declaration.media) || declaration.kind === 'text').map(([key]) => key);
    const data = scope && bound.length ? resolveBlockBindings(block.data, bound, scope) : block.data;
    if (scope?.user && refs.usage && bound.some(key => usesUserBinding(block.data[key]))) refs.usage.user = true;
    for (const [key, declaration] of Object.entries(type?.fields ?? {})) {
        const entry = data[key];
        const raw = block.data[key];
        if (declaration.kind === 'text' && declaration.format === 'markdown' && hasBlockReference(raw) && (refs.depth ?? 0) === 0) {
            // References are parsed from the text as written, then each run's bindings resolve: a value with quotes cannot break a tag.
            const parsed = parsedText(cms, raw);
            if (scope?.user && refs.usage && usesUserBinding(raw)) refs.usage.user = true;
            const resolve = (text: string) => scope ? resolveBindings(text, scope) : text;
            const inner = { ...refs, depth: 1 };
            content[key] = parsed.parts.flatMap((part): BodyPart[] => {
                if (part.kind === 'text') return part.text.trim() ? [{ kind: 'html', html: renderMarkdown(resolve(part.text)) }] : [];
                const child = { ...part.block, _id: `${block._id}-${part.block._id}`.slice(0, 40) };
                if (child.type === PATTERN_REFERENCE) {
                    const blocks = refs.patterns?.get(String(child.data.pattern ?? '')) ?? [];
                    return blocks.filter(entry => entry.type !== PATTERN_REFERENCE).map(entry => ({ kind: 'block' as const, block: renderedBlock(cms, prefixIds(entry, `${child._id}-`), files, richText, scope, inner) }));
                }
                return [{ kind: 'block', block: renderedBlock(cms, child, files, richText, scope, inner) }];
            });
            html[key] = parsed.parts.map(part => part.kind === 'text' ? renderMarkdown(resolve(part.text)) : '').join('');
        } else if (declaration.kind === 'text' && declaration.format === 'markdown' && typeof entry === 'string') html[key] = renderMarkdown(entry);
        if (declaration.kind === 'richtext' && entry && typeof entry === 'object') content[key] = richText ? richText(entry as RichTextDoc) : richTextParts(entry as RichTextDoc).filter(part => part.kind === 'html');
        for (const id of declaration.media ? (Array.isArray(entry) ? entry : [entry]) : []) {
            const view = mediaView(files.get(id as string), resizes);
            if (view) media[id as string] = view;
        }
    }
    const children = Array.isArray(block.children) ? (block.children as RenderedBlock[]).map(child => renderedBlock(cms, child, files, richText, scope, refs)) : undefined;
    return { _id: block._id, type: block.type, data, html, media, ...(Object.keys(content).length ? { content } : {}), ...(type && blockIsData(type) ? { dataOnly: true } : {}),
        ...(block.layout ? { layout: block.layout } : {}), ...(block.style ? { style: block.style } : {}), ...(block.when ? { when: block.when } : {}), ...(children ? { children } : {}) };
}

function blockMediaIds(cms: CmsHost, block: { type: string; data: Record<string, unknown>; children?: readonly unknown[] }, into: Set<string>): void {
    for (const [key, declaration] of Object.entries(cms.blockTypes.get(block.type)?.fields ?? {})) {
        const entry = block.data[key];
        if (declaration.media && typeof entry === 'string') into.add(entry);
        if (declaration.media && Array.isArray(entry)) for (const id of entry) into.add(id as string);
        if (declaration.kind === 'richtext' && entry && typeof entry === 'object') docMediaIds(cms, entry as RichTextDoc, into);
    }
    for (const child of Array.isArray(block.children) ? block.children as RenderedBlock[] : []) blockMediaIds(cms, child, into);
    for (const referenced of referencedBlocks(cms, block)) if (referenced.type !== PATTERN_REFERENCE) blockMediaIds(cms, referenced, into);
}

function docMediaIds(cms: CmsHost, doc: RichTextDoc, into: Set<string>): void {
    for (const node of doc.content) {
        if (node.type === 'cmsBlock' && node.attrs) blockMediaIds(cms, node.attrs as unknown as RenderedBlock, into);
        if (node.type === 'image' && typeof node.attrs?.mediaId === 'string') into.add(node.attrs.mediaId);
    }
}

/** Synced patterns the blocks and documents use, by ID: their blocks. Patterns inside patterns are not expanded. */
async function usedPatterns(cms: CmsHost, docs: readonly RichTextDoc[], blocks: readonly Block[] = []): Promise<Map<string, Block[]>> {
    const all = [...docs.flatMap(doc => richTextBlocks(doc)), ...flattenBlocks(blocks)];
    const ids = [...new Set(all.filter(block => block.type === 'core/pattern').map(block => String(block.data.pattern ?? '')))].filter(Boolean);
    // `{{ pattern hero /}}` in text names a pattern by its slug.
    const slugs = [...new Set(all.flatMap(block => referencedBlocks(cms, block as { type: string; data: Record<string, unknown> })).filter(block => block.type === PATTERN_REFERENCE).map(block => String(block.data.pattern ?? '')))].filter(Boolean).slice(0, 50);
    if (!ids.length && !slugs.length) return new Map();
    try {
        const repository = cms.resource('cms/patterns');
        const patterns = ids.length ? await repository.getMany(ids, renderer) : new Map<string, RecordShape>();
        const named = slugs.length ? (await repository.list({ where: { slug: { in: slugs } }, limit: 50 }, renderer)).records : [];
        return new Map([...[...patterns].flatMap(([id, record]) => Array.isArray(record.content) ? [[id, record.content as Block[]] as const] : []),
            ...named.flatMap(record => Array.isArray(record.content) && typeof record.slug === 'string' ? [[record.slug, record.content as Block[]] as const] : [])]);
    } catch (error) {
        if (isCmsError(error)) return new Map();
        throw error;
    }
}

/** Blocks with each Pattern block replaced by the pattern's blocks, their IDs prefixed so they stay distinct; patterns inside patterns are left out. */
function expandPatterns(blocks: readonly Block[], patterns: ReadonlyMap<string, Block[]>): Block[] {
    return blocks.flatMap(block => {
        if (block.type === 'core/pattern') {
            const id = String(block.data.pattern ?? '');
            return (patterns.get(id) ?? []).filter(inner => inner.type !== 'core/pattern').map(inner => prefixIds(inner, `${block._id}-`));
        }
        return [block.children ? { ...block, children: expandPatterns(block.children, patterns) } : block];
    });
}

function prefixIds(block: Block, prefix: string): Block {
    return { ...block, _id: `${prefix}${block._id}`.slice(0, 40), ...(block.children ? { children: block.children.map(child => prefixIds(child, prefix)) } : {}) };
}

/** The `?comment=` result of posting a comment, as the comment view's notice or error. */
export function commentResult(value: string | undefined): Pick<CommentsView, 'notice' | 'error'> {
    if (value === 'held' || value === 'posted') return { notice: value, error: '' };
    if (value === 'closed' || value === 'sign-in' || value === 'too-fast' || value === 'invalid' || value === 'bot') return { notice: '', error: value };
    return { notice: '', error: '' };
}

export interface EntryViewOptions {
    /** Bodies, blocks and comments, for an entry's own page. */
    full?: boolean;
    /** After posting a comment, for the message above the form. */
    comment?: Pick<CommentsView, 'notice' | 'error'>;
    /** The signed-in user, who comments without a name and email. */
    user?: { name: string } | null;
    /** Set when a binding reads the signed-in user, so the page is not cached for everyone. */
    usage?: { user: boolean };
    /** IDs of protected entries this visitor unlocked, whose content shows. */
    unlocked?: ReadonlySet<string>;
    /** The request, for the forms the entry places; without it they render nothing. */
    forms?: FormRequest;
}

/** Fields a details list leaves out: core fields themes show on their own, and internal ones. */
const NOT_DETAILS = new Set(['title', 'slug', 'status', 'publishedAt', 'parent', 'menuOrder', 'excerpt', 'summary', 'sticky', 'seo', 'locale', 'translationGroup', 'commentsOpen', 'template']);
/** Fields entry views leave out: search settings have their own head tags; translations their own links. */
const NOT_FIELDS = new Set(['seo', 'translationGroup']);

/** The titles and URLs of the records reference fields point at, by `<target>:<id>`. Records visitors cannot read are left out. */
async function referencedRecords(cms: CmsHost, fields: readonly (readonly [string, FieldDeclaration])[], records: readonly RecordShape[]): Promise<Map<string, EntryReference>> {
    const byTarget = new Map<string, Set<string>>();
    for (const [name, declaration] of fields) {
        if (declaration.kind !== 'reference' || !declaration.target) continue;
        for (const record of records) if (typeof record[name] === 'string' && record[name]) byTarget.set(declaration.target, (byTarget.get(declaration.target) ?? new Set()).add(record[name] as string));
    }
    const found = new Map<string, EntryReference>();
    for (const [target, ids] of byTarget) {
        try {
            const resource = cms.resourceById(target);
            const rows = await cms.resource(target).getMany([...ids].slice(0, 100), visitor);
            const collection = target.startsWith('cms/') ? cms.collections().find(entry => entry.name === target.slice(4)) : undefined;
            const urls = collection ? await cms.entryUrls(collection, [...rows.values()]) : new Map<string, string | null>();
            for (const row of rows.values()) found.set(`${target}:${row.id}`, { id: row.id, title: recordTitle(row, resource.titleField ?? 'title'), url: urls.get(row.id) ?? null });
        } catch (error) { if (!isCmsError(error)) throw error; }
    }
    return found;
}

/** A rich text or Markdown field: part of the entry's content, rendered as one `core/richtext` block. */
function isTextField(declaration: FieldDeclaration): boolean {
    return declaration.kind === 'richtext' || (declaration.kind === 'text' && declaration.format === 'markdown');
}

/** A rich text or Markdown field as a block of the entry's content: `field` names it, so the site editor opens the field. */
function textBlock(field: string, parts: readonly BodyPart[]): RenderedBlock {
    return { _id: `field-${field}`.slice(0, 40), type: 'core/richtext', data: {}, html: {}, media: {}, content: { text: parts }, field };
}

/** Whether an entry has a password visitors must type. */
export function isProtected(record: RecordShape): boolean {
    return typeof record.password === 'string' && record.password.length > 0;
}

/** The cookie that remembers an unlocked entry, and its value: a digest of the entry and its password. */
export function unlockCookie(record: RecordShape): string {
    return `cms_unlock_${record.id}`;
}
export async function unlockToken(record: RecordShape): Promise<string> {
    const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`cms-unlock:${record.id}:${String(record.password)}`)));
    return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Views of entries: content rendered with its blocks, patterns and media, authors, URLs, term links, typed fields and comments. */
export async function entryViews(cms: CmsHost, collection: CollectionDefinition, records: readonly RecordShape[], options: EntryViewOptions = {}): Promise<EntryView[]> {
    const resource = cms.resourceById(`cms/${collection.name}`);
    const settings = await cms.settings.all();
    const languages = await cms.languages();
    const resizes = cms.files?.resizes ?? false;
    const fields = Object.entries(resource.fields);
    // The entry's content is its blocks fields and its rich text and Markdown fields, rendered into `entry.content` in declared order; `entry.fields` keeps them apart.
    const contentFields = fields.filter(([, declaration]) => (declaration.kind === 'blocks' && !declaration.form) || isTextField(declaration));
    const blocksFields = contentFields.filter(([, declaration]) => declaration.kind === 'blocks');
    const imageField = fields.find(([, declaration]) => declaration.kind === 'string' && declaration.media);
    const excerptField = fields.find(([name, declaration]) => name === 'excerpt' && declaration.kind === 'text');
    const docs = options.full ? records.flatMap(record => [
        ...fields.filter(([, declaration]) => declaration.kind === 'richtext').map(([name]) => record[name]).filter((value): value is RichTextDoc => !!value && typeof value === 'object'),
        ...fields.filter(([, declaration]) => declaration.kind === 'blocks').flatMap(([name]) => Array.isArray(record[name]) ? blockDocuments(record[name] as Block[], cms.blockTypes) : []),
    ]) : [];
    const stored = (record: RecordShape) => blocksFields.flatMap(([name]) => Array.isArray(record[name]) ? record[name] as Block[] : []);
    const patterns = await usedPatterns(cms, docs, options.full ? records.flatMap(stored) : []);
    /** The content's plain text for an excerpt: every content field in order, 4,000 characters at most. */
    const contentPlain = (record: RecordShape): string => {
        let text = '';
        for (const [name, declaration] of contentFields) {
            const value = record[name];
            if (text.length >= 4000) break;
            if (declaration.kind === 'blocks' && Array.isArray(value)) text += ` ${blocksPlain(value as Block[], cms.blockTypes, doc => richTextPlain(doc), 4000 - text.length)}`;
            else if (declaration.kind === 'richtext' && value && typeof value === 'object') text += ` ${richTextPlain(value as RichTextDoc)}`;
            else if (declaration.kind === 'text' && typeof value === 'string') text += ` ${value}`;
        }
        return text.trim().slice(0, 4000);
    };
    const mediaIds = new Set<string>();
    for (const record of records) for (const [name, declaration] of fields) {
        const value = record[name];
        if (declaration.media && typeof value === 'string') mediaIds.add(value);
        if (declaration.media && Array.isArray(value)) for (const id of value) mediaIds.add(id as string);
        if (!options.full) continue;
        if (declaration.kind === 'blocks' && Array.isArray(value)) for (const block of expandPatterns(value as Block[], patterns) as RenderedBlock[]) blockMediaIds(cms, block, mediaIds);
    }
    for (const doc of docs) docMediaIds(cms, doc, mediaIds);
    if (options.full) for (const list of patterns.values()) for (const block of list as RenderedBlock[]) blockMediaIds(cms, block, mediaIds);
    const files = cms.files ? await cms.files.getMany([...mediaIds]) : new Map<string, CmsFile>();
    // Articles name their author; with author pages on, the name links to the author's page, so the owners need slugs.
    const articles = ARTICLE_TYPES.has(collection.schema?.type ?? 'WebPage');
    const found = articles ? await cms.users.getMany(records.map(record => record.owner).filter((owner): owner is string => !!owner)) : new Map<string, CmsUser>();
    const owners = articles && settings['seo.authorPages'] ? await cms.users.withSlugs(found) : found;
    const references = await referencedRecords(cms, fields, records);
    const taxonomyFields = fields.filter(([, declaration]) => declaration.taxonomy);
    const terms = await cms.taxonomies.getMany(records.flatMap(record => taxonomyFields.flatMap(([name]) => (record[name] as string[] | undefined) ?? [])));
    const urls = await cms.entryUrls(collection, records);
    const termUrl = (term: TermShape, locale: string) => {
        const taxonomy = cms.taxonomies.declaration(term.taxonomy);
        return taxonomy.path ? `${localePrefix(languages, locale)}/${taxonomy.path}/${term.slug}` : null;
    };
    // Blocks bind to the entry's own fields (`{{ $.price }}`), so each record renders with itself as the scope.
    const parts = bodyRenderer(cms, files, patterns, options.usage);
    const render = (block: RenderedBlock, record: RecordShape) => {
        const scopes = bindingScopes(settings, { entry: record, user: options.user ?? null });
        return renderedBlock(cms, block, files, doc => parts(doc, scopes), scopes, { patterns, ...(options.usage ? { usage: options.usage } : {}) });
    };
    /** A field's typed value; undefined leaves it out (rich text, Markdown and blocks in lists, vectors). */
    const fieldView = (name: string, declaration: FieldDeclaration, value: unknown, locale: string, full: boolean, scope: RecordShape): FieldView | undefined => {
        if (declaration.kind === 'vector' || declaration.kind === 'bigint') return undefined;
        if ((declaration.kind === 'richtext' || declaration.kind === 'blocks' || (declaration.kind === 'text' && declaration.format === 'markdown')) && !full) return undefined;
        if (value === undefined || value === null || value === '') return null;
        // A multiple field is the list of its kind's views; its rich text and Markdown items are one block each.
        if (declaration.multiple && !declaration.taxonomy && !declaration.media && Array.isArray(value)) {
            const items = value.map((item, index) => fieldView(`${name}-${index + 1}`, { ...declaration, multiple: false }, item, locale, full, scope));
            if (items.some(item => item === undefined)) return undefined;
            return declaration.kind === 'richtext' || (declaration.kind === 'text' && declaration.format === 'markdown')
                ? items.flatMap(item => (item as readonly RenderedBlock[] | null) ?? []).map(block => ({ ...block, field: name }))
                : items.filter((item): item is Exclude<FieldView, null> => item !== null) as FieldView;
        }
        if (declaration.taxonomy) return ((value as string[] | undefined) ?? []).map(id => terms.get(id)).filter((term): term is TermShape => !!term).map((term): TermLink => ({ name: term.name, url: termUrl(term, locale), icon: term.icon }));
        if (declaration.media && Array.isArray(value)) return value.map(id => mediaView(files.get(String(id)), resizes)).filter((view): view is MediaView => !!view);
        if (declaration.media) return mediaView(files.get(String(value)), resizes);
        if (declaration.kind === 'reference') return references.get(`${declaration.target}:${String(value)}`) ?? null;
        if (declaration.kind === 'richtext') return typeof value === 'object' ? [textBlock(name, parts(value as RichTextDoc, bindingScopes(settings, { entry: scope, user: options.user ?? null })))] : null;
        if (declaration.kind === 'text' && declaration.format === 'markdown') {
            // Block references render through a paragraph of the text, which parses them.
            if (hasBlockReference(value)) return [textBlock(name, render({ _id: name, type: 'core/paragraph', data: { text: value }, html: {}, media: {} }, scope).content?.text ?? [])];
            return [textBlock(name, [{ kind: 'html', html: renderMarkdown(String(value)) }])];
        }
        if (declaration.kind === 'blocks') return Array.isArray(value) ? (expandPatterns(value as Block[], patterns) as RenderedBlock[]).map(block => render(block, scope)) : [];
        return value as FieldView;
    };
    const views: EntryView[] = [];
    for (const record of records) {
        const locale = typeof record.locale === 'string' ? record.locale : languages.default;
        // A protected entry a visitor has not unlocked shows its title alone.
        const locked = isProtected(record) && !options.unlocked?.has(record.id);
        const typed: Record<string, FieldView> = {};
        for (const [name, declaration] of fields) {
            // A locked entry shows nothing of its fields; the password itself is never a field of the view.
            if (NOT_FIELDS.has(name) || name === 'password' || locked) continue;
            const view = fieldView(name, declaration, record[name], locale, options.full === true, record);
            if (view !== undefined) typed[name] = view;
        }
        // Each content field is rendered once, for `content` and for `fields`.
        const content = options.full && !locked ? contentFields.flatMap(([name]) => (typed[name] as readonly RenderedBlock[] | null | undefined) ?? []) : [];
        const details = options.full ? fields.filter(([name, declaration]) => !NOT_DETAILS.has(name) && !declaration.taxonomy && !declaration.media
            && !['text', 'blocks', 'richtext', 'json', 'reference', 'vector', 'bigint'].includes(declaration.kind) && typed[name] !== null && typed[name] !== undefined && typed[name] !== '' && !(Array.isArray(typed[name]) && !(typed[name] as unknown[]).length))
            .map(([name, declaration]) => ({ label: declaration.label ?? name, value: displayValue(declaration.kind, typed[name], settings) })) : [];
        views.push({
            id: record.id, title: recordTitle(record, 'title'), url: urls.get(record.id) ?? null, collection: collection.name, kind: collection.singular,
            date: typeof record.publishedAt === 'number' ? formatSiteDate(record.publishedAt, settings) : '',
            updated: collection.publishable === false ? '' : formatSiteDate(record.updatedAt, settings),
            author: record.owner && articles ? owners.get(record.owner)?.name ?? '' : '',
            authorUrl: record.owner && articles && settings['seo.authorPages'] ? authorUrl(owners.get(record.owner)?.slug, localePrefix(languages, locale)) : null,
            excerpt: locked ? '' : excerptField && record.excerpt ? String(record.excerpt) : typeof record.summary === 'string' && record.summary ? excerptOf(record.summary, 40) : excerptOf(contentPlain(record), 40),
            summary: locked || typeof record.summary !== 'string' ? '' : record.summary,
            content,
            image: imageField ? mediaView(files.get(String(record[imageField[0]] ?? '')), resizes) : null,
            terms: taxonomyFields.map(([name, declaration]) => ({
                label: cms.taxonomies.declaration(declaration.taxonomy!).label,
                terms: ((record[name] as string[] | undefined) ?? []).map(id => terms.get(id)).filter((term): term is TermShape => !!term).map(term => ({ name: term.name, url: termUrl(term, locale), icon: term.icon })),
            })),
            fields: typed,
            details,
            template: typeof record.template === 'string' && record.template ? record.template : null,
            locale,
            comments: options.full && collection.comments && !locked && cms.discussions(settings) ? await commentsView(cms, collection, record, urls.get(record.id) ?? '/', settings, options) : null,
            locked,
        });
        if (options.full) {
            await withForms(cms, content, options.forms);
            await withLatest(cms, content, locale);
        }
    }
    return views;
}

/** Comment text as escaped paragraphs, with line breaks kept. */
function commentHtml(text: string): string {
    return text.split(/\n{2,}/).map(paragraph => `<p>${escapeHtml(paragraph).replaceAll('\n', '<br>')}</p>`).join('');
}

/** An entry's approved comments as a thread, and the form when comments are open. */
async function commentsView(cms: CmsHost, collection: CollectionDefinition, record: RecordShape, url: string, settings: SiteSettings, options: EntryViewOptions): Promise<CommentsView> {
    const open = cms.commentsOpen(collection, record, settings);
    let comments: CommentShape[] = [];
    try { comments = await cms.comments.forEntry(`cms/${collection.name}`, record.id); }
    catch (error) { if (!isCmsError(error)) throw error; }
    const users = await cms.users.getMany(comments.map(comment => comment.userId).filter((id): id is string => !!id));
    const depth = settings['discussion.threadDepth'];
    const byParent = new Map<string | null, CommentShape[]>();
    const known = new Set(comments.map(comment => comment.id));
    // Replies to comments that are no longer shown move to the top level.
    for (const comment of comments) {
        const parent = comment.parentId && known.has(comment.parentId) ? comment.parentId : null;
        byParent.set(parent, [...(byParent.get(parent) ?? []), comment]);
    }
    const thread = (parent: string | null, level: number): CommentView[] => (byParent.get(parent) ?? []).map(comment => ({
        id: comment.id, author: comment.userId ? users.get(comment.userId)?.name ?? comment.authorName : comment.authorName || __('Anonymous'),
        authorUrl: /^https?:\/\//.test(comment.authorUrl) ? comment.authorUrl : null,
        avatar: comment.userId ? users.get(comment.userId)?.avatar ?? null : null,
        date: formatSiteDate(comment.createdAt, settings, { time: settings['general.timeFormat'] }),
        html: commentHtml(comment.content),
        replies: level < depth ? thread(comment.id, level + 1) : [],
        replyable: open && level < depth,
    }));
    const siteKey = env('TURNSTILE_SITE_KEY', '');
    return {
        open, count: comments.length, items: thread(null, 1), notice: options.comment?.notice ?? '', error: options.comment?.error ?? '',
        form: open ? {
            action: '/api/cms/comments', collection: collection.name, entry: record.id, userName: options.user?.name ?? '',
            requireNameEmail: settings['discussion.requireNameEmail'], requireSignIn: settings['discussion.requireSignIn'] && !options.user,
            signInUrl: `/auth/login?next=${encodeURIComponent(url)}`,
            turnstileSiteKey: siteKey && env('TURNSTILE_SECRET_KEY', '') ? siteKey : null,
        } : null,
    };
}

function displayValue(kind: string, value: unknown, settings: SiteSettings): string {
    if (kind === 'boolean') return value ? 'Yes' : 'No';
    if (kind === 'datetime' && typeof value === 'number') return formatSiteDate(value, settings, { time: settings['general.timeFormat'] });
    if (kind === 'number' && typeof value === 'number') return value.toLocaleString('en-US');
    if (Array.isArray(value)) return value.join(', ');
    return String(value);
}

/** Published entries newest first, sticky posts first on the first page, in one language. */
export async function archive(cms: CmsHost, collection: CollectionDefinition, page: number, options: { where?: { [field: string]: FieldFilter }; base: string; perPage?: number; locale?: string }): Promise<Pick<ArchiveView, 'entries' | 'paging'>> {
    const perPage = options.perPage ?? await cms.settings.get('reading.postsPerPage');
    const languages = await cms.languages();
    const repository = cms.resource(`cms/${collection.name}`);
    const publishable = collection.publishable !== false;
    const where = { ...(publishable ? { status: 'published' } : {}), ...localeWhere(languages, options.locale ?? languages.default), ...(options.where ?? {}) };
    const order = publishable ? { field: 'publishedAt', direction: 'desc' as const } : { field: 'title', direction: 'asc' as const };
    const [list, total] = await Promise.all([
        repository.list({ where, order, limit: Math.min(perPage, 100), offset: Math.min((page - 1) * perPage, 10_000) }, visitor),
        repository.count({ where }, visitor),
    ]);
    let records = [...list.records];
    if (page === 1 && collection.name === 'posts' && !options.where) records = [...records.filter(record => record.sticky === true), ...records.filter(record => record.sticky !== true)];
    return { entries: await entryViews(cms, collection, records), paging: { page, pages: Math.max(1, Math.ceil(total / perPage)), base: options.base } };
}

export type Resolved =
    | { kind: 'entry'; collection: CollectionDefinition; record: RecordShape; locale: string }
    | { kind: 'archive'; collection: CollectionDefinition; locale: string }
    | { kind: 'term'; term: TermShape; ancestors: TermShape[]; locale: string }
    | { kind: 'home'; locale: string }
    | { kind: 'search'; locale: string }
    | { kind: 'author'; user: CmsUser; locale: string }
    | { kind: 'redirect'; url: string; status?: 301 | 302 | 307 | 308 }
    | { kind: 'gone' }
    | { kind: 'none'; locale: string };

/**
 * What a site path names: a language's home page, a collection archive or entry, a term
 * archive, or a nested page. Paths of other languages start with their code (`/fr/...`).
 * Entries answer only at their own URL; other paths to them redirect there.
 */
export async function resolvePath(cms: CmsHost, segments: readonly string[]): Promise<Resolved> {
    const languages = await cms.languages();
    const prefixed = languages.multilingual && segments.length > 0 && languages.others.includes(segments[0]!);
    const locale = prefixed ? segments[0]! : languages.default;
    const rest = prefixed ? segments.slice(1) : segments;
    if (prefixed && !rest.length) return { kind: 'home', locale };
    if (prefixed && rest.length === 1 && rest[0] === 'search') return { kind: 'search', locale };
    if (!rest.length || rest.some(segment => !/^[a-z0-9-]{1,200}$/.test(segment))) return { kind: 'none', locale };
    const path = rest.join('/');
    // Collections served under a path: /<path> is the archive, /<path>/<slug> an entry.
    for (const collection of cms.collections()) {
        if (!collection.path) continue;
        if (path === collection.path) return { kind: 'archive', collection, locale };
        if (!path.startsWith(`${collection.path}/`)) continue;
        const slugs = path.slice(collection.path.length + 1).split('/');
        // Category permalinks take /<path>/<category>/<slug>; the entry then answers at its own address only.
        if (!collection.hierarchical && slugs.length > (collection.permalink === 'category' ? 2 : 1)) return { kind: 'none', locale };
        const found = await bySlug(cms, collection, slugs.at(-1)!);
        return found ? canonical(cms, collection, found, segments) : { kind: 'none', locale };
    }
    // Author pages at /author/<slug>, when Settings → SEO turns them on.
    if (rest.length === 2 && rest[0] === 'author' && await cms.settings.get('seo.authorPages')) {
        const user = await cms.users.bySlug(rest[1]!);
        return user && user.status === 'active' ? { kind: 'author', user, locale } : { kind: 'none', locale };
    }
    for (const taxonomy of cms.taxonomies.declarations) {
        if (!taxonomy.path || rest[0] !== taxonomy.path || rest.length < 2) continue;
        const term = await cms.taxonomies.bySlug(taxonomy.name, rest.at(-1)!);
        if (!term) return { kind: 'none', locale };
        return { kind: 'term', term, ancestors: await cms.taxonomies.ancestors(term), locale };
    }
    // Collections at the site root share one namespace: nested ones (pages) first, then the others by name.
    const roots = cms.collections().filter(collection => collection.path === '').sort((a, b) => Number(!a.hierarchical) - Number(!b.hierarchical) || a.name.localeCompare(b.name));
    for (const root of roots) {
        if (!root.hierarchical && rest.length > (root.permalink === 'category' ? 2 : 1)) continue;
        const found = await bySlug(cms, root, rest.at(-1)!);
        if (found) return canonical(cms, root, found, segments);
    }
    return { kind: 'none', locale };
}

/** The redirect for a path without content, if any; its use is counted in the background. */
export async function redirectFor(cms: CmsHost, path: string, query: string, later: (work: Promise<unknown>) => void): Promise<Resolved | null> {
    let match;
    try { match = await cms.redirects.match(path); }
    catch (error) { if (isCmsError(error) || /cms_redirects|no such table/i.test(String((error as Error).message))) return null; throw error; }
    if (!match) return null;
    later(cms.redirects.hit(match.redirect.id));
    if (match.location === null) return { kind: 'gone' };
    const location = query && !match.location.includes('?') ? `${match.location}?${query}` : match.location;
    return { kind: 'redirect', url: location, status: match.redirect.status as 301 | 302 | 307 | 308 };
}

async function bySlug(cms: CmsHost, collection: CollectionDefinition, slug: string): Promise<RecordShape | null> {
    if (collection.slug === false) return null;
    const where: { [field: string]: FieldFilter } = { slug, ...(collection.publishable === false ? {} : { status: 'published' }) };
    return (await cms.resource(`cms/${collection.name}`).list({ where, limit: 1 }, visitor)).records[0] ?? null;
}

/** An entry answers only at its URL (ancestors' slugs, language prefix); other paths redirect there. */
async function canonical(cms: CmsHost, collection: CollectionDefinition, record: RecordShape, segments: readonly string[]): Promise<Resolved> {
    const url = (await cms.entryUrls(collection, [record])).get(record.id);
    if (!url) return { kind: 'none', locale: (await cms.languages()).default };
    const languages = await cms.languages();
    const locale = typeof record.locale === 'string' && languages.all.includes(record.locale) ? record.locale : languages.default;
    return url === `/${segments.join('/')}` ? { kind: 'entry', collection, record, locale } : { kind: 'redirect', url };
}

/** Entries of every collection that uses the term's taxonomy, including terms below it, in one language. */
export async function termArchive(cms: CmsHost, term: TermShape, page: number, base: string, locale?: string): Promise<Pick<ArchiveView, 'entries' | 'paging' | 'collection' | 'taxonomy'>> {
    const subtree = (await cms.taxonomies.subtree(term.id)).slice(0, 50);
    const usage = cms.taxonomies.usage(term.taxonomy).filter(entry => entry.resource.startsWith('cms/'));
    const collection = usage.length ? cms.collection(usage[0]!.resource.slice(4)) : null;
    if (!collection) return { entries: [], paging: { page: 1, pages: 1, base }, collection: null, taxonomy: term.taxonomy };
    return { ...await archive(cms, collection, page, { where: { [usage[0]!.field]: { containsAny: subtree } }, base, ...(locale ? { locale } : {}) }), collection: collection.name, taxonomy: term.taxonomy };
}

/** An author as their page shows them, from their profile meta. */
export function authorView(user: CmsUser, prefix = ''): AuthorView {
    const meta = user.meta;
    return {
        name: user.name, slug: user.slug ?? '', url: authorUrl(user.slug, prefix) ?? '#', avatar: user.avatar,
        bio: typeof meta.bio === 'string' ? meta.bio : '', jobTitle: typeof meta.jobTitle === 'string' ? meta.jobTitle : '',
        website: typeof meta.website === 'string' && /^https?:\/\//.test(meta.website) ? meta.website : null, profiles: urlList(meta.profiles),
    };
}

/** The collections an author page lists: article collections on the site. */
export function authorCollections(cms: CmsHost): CollectionDefinition[] {
    return cms.collections().filter(collection => typeof collection.path === 'string' && collection.publishable !== false && ARTICLE_TYPES.has(collection.schema?.type ?? 'WebPage'));
}

/** An author's published articles across the site's article collections, newest first, in one language. */
export async function authorArchive(cms: CmsHost, user: CmsUser, page: number, base: string, locale?: string): Promise<Pick<ArchiveView, 'entries' | 'paging' | 'collection'>> {
    const perPage = await cms.settings.get('reading.postsPerPage');
    const languages = await cms.languages();
    const collections = authorCollections(cms);
    const where = { status: 'published', ...localeWhere(languages, locale ?? languages.default) };
    const wanted = Math.min(page * perPage, 10_000);
    const found: { collection: CollectionDefinition; record: RecordShape }[] = [];
    let total = 0;
    for (const collection of collections) {
        const repository = cms.resource(`cms/${collection.name}`);
        try {
            const [list, count] = await Promise.all([
                repository.list({ where, owner: user.id, order: { field: 'publishedAt', direction: 'desc' }, limit: Math.min(wanted, 100) }, visitor),
                repository.count({ where, owner: user.id }, visitor),
            ]);
            total += count;
            found.push(...list.records.map(record => ({ collection, record })));
        } catch (error) { if (!isCmsError(error)) throw error; }
    }
    found.sort((a, b) => Number(b.record.publishedAt ?? 0) - Number(a.record.publishedAt ?? 0));
    const slice = found.slice((page - 1) * perPage, page * perPage);
    const entries: EntryView[] = [];
    for (const collection of collections) {
        const records = slice.filter(entry => entry.collection === collection).map(entry => entry.record);
        if (records.length) entries.push(...await entryViews(cms, collection, records));
    }
    entries.sort((a, b) => slice.findIndex(entry => entry.record.id === a.id) - slice.findIndex(entry => entry.record.id === b.id));
    return { entries, paging: { page, pages: Math.max(1, Math.ceil(total / perPage)), base }, collection: collections.length === 1 ? collections[0]!.name : null };
}

/** Published entries of every collection on the site that match the query, in one language. */
export async function searchEntries(cms: CmsHost, query: string, locale?: string): Promise<EntryView[]> {
    const languages = await cms.languages();
    const results: EntryView[] = [];
    for (const collection of cms.collections()) {
        const resource = cms.resourceById(`cms/${collection.name}`);
        if (collection.path === null || collection.path === undefined || !Object.values(resource.fields).some(field => field.search)) continue;
        try {
            const where = { ...(collection.publishable === false ? {} : { status: 'published' }), ...localeWhere(languages, locale ?? languages.default) };
            const records = await cms.resource(resource.id).search(query, { limit: 10, where }, visitor);
            // Protected entries match on their content, which visitors cannot read: they stay out.
            results.push(...await entryViews(cms, collection, records.filter(record => !isProtected(record))));
        } catch (error) { if (!isCmsError(error)) throw error; }
    }
    return results;
}

/**
 * The page in each of the site's languages: an entry's translations (or that language's home
 * page), archives and term archives under each prefix. Empty for a site with one language.
 */
export async function languageLinks(cms: CmsHost, resolved: Resolved | { kind: 'other'; locale: string }): Promise<LanguageLink[]> {
    const languages = await cms.languages();
    if (!languages.multilingual) return [];
    const current = 'locale' in resolved ? resolved.locale : languages.default;
    const home = (code: string) => localePrefix(languages, code) || '/';
    let urls = new Map<string, string>();
    if (resolved.kind === 'entry') {
        const translations = await cms.translations(resolved.collection, resolved.record);
        const entryUrls = await cms.entryUrls(resolved.collection, [...translations.values()]);
        urls = new Map([...translations].flatMap(([code, record]) => {
            const url = entryUrls.get(record.id);
            return url && (resolved.collection.publishable === false || record.status === 'published') ? [[code, url]] : [];
        }));
    } else if (resolved.kind === 'archive') {
        for (const code of languages.all) {
            const url = await cms.archiveUrl(resolved.collection, code);
            if (url) urls.set(code, url);
        }
    } else if (resolved.kind === 'term') {
        const taxonomy = cms.taxonomies.declaration(resolved.term.taxonomy);
        if (taxonomy.path) for (const code of languages.all) urls.set(code, `${localePrefix(languages, code)}/${taxonomy.path}/${resolved.term.slug}`);
    } else if (resolved.kind === 'author') {
        for (const code of languages.all) { const url = authorUrl(resolved.user.slug, localePrefix(languages, code)); if (url) urls.set(code, url); }
    }
    return languages.all.map(code => ({ code, label: languageName(code), url: urls.get(code) ?? home(code), current: code === current }));
}

/**
 * A language's home page: Settings → Reading's front page (its translation in other
 * languages), or that language's latest posts.
 */
export async function homeView(cms: CmsHost, locale: string, page: number, options: EntryViewOptions = {}): Promise<{ page: EntryView | null; record: RecordShape | null; view: Pick<ArchiveView, 'entries' | 'paging' | 'title' | 'description' | 'collection'> }> {
    const settings = await cms.settings.all();
    const languages = await cms.languages();
    const front = settings['reading.showOnFront'] === 'page' ? settings['reading.pageOnFront'] : '';
    if (front) {
        let record = await cms.resource('cms/pages').get(front, visitor);
        if (record && languages.multilingual && (record.locale ?? languages.default) !== locale) record = (await cms.translations(cms.collection('pages'), record)).get(locale) ?? null;
        if (record && record.status === 'published') {
            return { page: (await entryViews(cms, cms.collection('pages'), [record], { ...options, full: true }))[0]!, record, view: { title: '', description: '', entries: [], paging: { page: 1, pages: 1, base: '/' }, collection: null } };
        }
    }
    const result = await archive(cms, cms.collection('posts'), page, { base: localePrefix(languages, locale) || '/', locale });
    return { page: null, record: null, view: { title: settings['general.siteTitle'], description: settings['general.tagline'], collection: 'posts', ...result } };
}

export function pageNumber(value: string | undefined): number {
    const page = Number(value);
    return Number.isSafeInteger(page) && page > 0 && page <= 500 ? page : 1;
}

declare module 'hono' {
    interface ContextVariableMap {
        /** What the site path names, set by the catch-all route's middleware. */
        'cms.site': Resolved | { kind: 'unavailable' };
    }
}

/**
 * A form as its preview shows it: the `core/form` block with the form attached, built from
 * the record given (the saved form, or it with an editor's unsaved changes) whatever its
 * status. The saved form's submissions table is used as is: nothing is migrated for a draft.
 */
export async function formPreviewBlock(cms: CmsHost, saved: LoadedForm, record: RecordShape, request: FormRequest): Promise<RenderedBlock> {
    const blocks = Array.isArray(record.body) ? record.body as Block[] : [];
    const title = typeof record.title === 'string' ? record.title : '';
    const form: LoadedForm = Object.freeze({
        ...saved, record, blocks, settings: formSettings(record.settings), enabled: record.enabled !== false, published: true,
        ref: Object.freeze({ id: record.id, slug: typeof record.slug === 'string' ? record.slug : record.id, title, inputs: formInputs(blocks, cms.blockTypes) }),
        rules: Object.freeze(notificationRules(record.notifications).filter(rule => rule.enabled !== false)),
    });
    const ids = new Set<string>();
    for (const entry of blocks) blockMediaIds(cms, entry, ids);
    const files = cms.files && ids.size ? await cms.files.getMany([...ids]) : new Map<string, CmsFile>();
    const block: RenderedBlock & { form?: FormView } = { _id: 'preview', type: 'core/form', data: { form: form.ref.slug }, html: {}, media: {} };
    block.form = await formView(cms, form, request, entry => renderedBlock(cms, entry, files));
    return block;
}
