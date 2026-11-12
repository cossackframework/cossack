/**
 * The public site on the CMS: the active theme, its menus, entries and archives as views, and
 * which entry, archive or term a URL names, in which language. Server-only; pages call these
 * from `init()` and hand the views to the theme's templates.
 */
import {
    ENTRY_VIEW_REFUSED_BLOCKS, siteEntryView, validateBlocks, type EntryViewParts,
    ANONYMOUS, ARTICLE_TYPES, authorUrl, entryAuthors, blockDocuments, SHARE_BRAND_URLS, blockIsData, blocksPlain, editedSize, fieldGroupDeclarations, hasBlockReference, parseBlockText, PATTERN_REFERENCE, resolveBindings, resolveBlockBindings, siteBindingScope, textBlocks, usesUserBinding, type BindingScopes, type ParsedText, flattenBlocks, escapeHtml, formatSiteDate, formInputs, formSettings, imageSrcset, imageUrl, imageWidths, IMAGE_WIDTHS, isCmsError, languageFlag, languageName, mediaUrl, notificationRules, recordTitle, resolvePresets, richTextBlocks, richTextParts, richTextPlain, systemPrincipal, templateCandidates, transformable, urlList,
    type AuthorView, type Block,
    type Principal, type TemplatePage, type ThemeData, type ThemePresets,
    type ArchiveView, type BodyPart, type BrandIcon, type CollectionDefinition, type CommentShape, type CommentView, type CommentsView, type EntryReference, type EntryView, type FieldDeclaration, type FieldFilter,
    type BreadcrumbView, type FieldView, type LanguageLink, type MediaView, type MenuItemView, type Paging, type RecordShape, type RenderedBlock, type ResolvedMenuItem, type RichTextDoc, type SiteSettings, type SiteView, type TermLink, type TermShape,
} from '@cossackframework/cms';
import { brandIcon, excerptOf, lockedView, renderMarkdown, type CmsFile, type CmsHost, type CmsUser, type LoadedForm, type SiteLanguages } from '@cossackframework/cms/server';
import type { FormView } from '@cossackframework/cms';
import { formView, type FormRequest } from './site-forms';
import { withHeadingAnchors } from './headings';

/** The active theme, the theme it extends, its option values and presets, which every site page renders with. */
export interface ThemeState {
    name: string | null;
    parent?: string | null;
    options: Record<string, unknown>;
    /** The presets blocks pick from, the site's color changes applied. */
    presets?: Required<ThemePresets>;
    /** The site's Additional CSS, already checked. */
    customCss?: string;
    /** Active plugins apart from the theme and its parent: their `ui.ts` `head` runs on the site. */
    plugins?: readonly string[];
}

const visitor = { principal: ANONYMOUS };
/** Patterns are private; the site reads them to render the entries that use them. */
const renderer = { principal: systemPrincipal('site') };

/**
 * Texts with block references, parsed once per site in each isolate: saving checks them, so
 * serving a page parses each text once. Sites can have different block types active.
 */
const PARSED = new WeakMap<CmsHost, Map<string, ParsedText>>();

function parsedText(cms: CmsHost, text: string): ParsedText {
    let texts = PARSED.get(cms);
    if (!texts) PARSED.set(cms, texts = new Map());
    let parsed = texts.get(text);
    if (!parsed) {
        parsed = parseBlockText(text, cms.blockTypes);
        if (texts.size >= 500) texts.delete(texts.keys().next().value!);
        texts.set(text, parsed);
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
        site: siteBindingScope(settings),
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
    return { name, parent: theme?.parent ?? null, options, presets: resolvePresets(theme?.presets, name ? settings['appearance.presets']?.[name] : null), customCss: settings['appearance.customCss'] ?? '',
        plugins: cms.activePluginNames().filter(entry => entry !== name && entry !== theme?.parent) };
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
    if (!languages.multilingual) return '';
    const code = languages.all.includes(locale) ? locale : languages.default;
    return code !== languages.default || languages.prefixDefault ? `/${code}` : '';
}

/** Language filter for queries: only on a site with several languages. */
function localeWhere(languages: SiteLanguages, locale: string): { [field: string]: FieldFilter } {
    return languages.multilingual ? { locale } : {};
}

/** The layout's data: site title, tagline, the menus of the active theme's locations and the language links. */
export async function siteView(cms: CmsHost, theme: ThemeState, options: { locale?: string; languages?: readonly LanguageLink[]; forms?: FormRequest; template?: string | null; entry?: RecordShape | null; user?: { name: string } | null; usage?: { user: boolean };
    /** The page's absolute URL, for sharing. */ url?: string; /** The page resolved, for its breadcrumbs. */ page?: Resolved | { kind: string; locale: string } } = {}): Promise<SiteView & { noindex: boolean }> {
    const settings = await cms.settings.all();
    useImageSettings(cms, settings);
    const languages = await cms.languages();
    const locale = options.locale ?? languages.default;
    const info = cms.themes().find(entry => entry.name === theme.name);
    const menus = await siteMenus(cms, theme, { locale, user: options.user, forms: options.forms, usage: options.usage });
    let blog: string | null = null;
    try { blog = await cms.archiveUrl(cms.collection('posts'), locale); } catch { /* no posts */ }
    return {
        title: settings['general.siteTitle'], tagline: settings['general.tagline'], logo: settings['general.logo'] || null, blog, menus, noindex: settings['reading.discourageSearchEngines'],
        locale, languages: options.languages ?? [], searchUrl: `${localePrefix(languages, locale)}/search`, homeUrl: localePrefix(languages, locale) || '/',
        areas: await areaViews(cms, info?.areas ?? [], options.forms, bindingScopes(settings, options), options.usage),
        template: options.template ?? null,
        url: options.url ?? '',
        breadcrumbs: await breadcrumbTrail(cms, options.page, languages, locale),
    };
}

/**
 * The way to a page: Home (the language's), then an entry's collection archive and ancestors, a
 * term's ancestors, or the archive, search or author page, and last the page itself without a
 * URL. The `core/breadcrumbs` block and `helpers.breadcrumbs` draw it; the SEO graph has its own.
 */
async function breadcrumbTrail(cms: CmsHost, page: Resolved | { kind: string; locale: string } | undefined, languages: SiteLanguages, locale: string): Promise<BreadcrumbView[]> {
    const prefix = localePrefix(languages, locale);
    const home: BreadcrumbView = { label: __('Home'), url: prefix || '/' };
    if (!page || page.kind === 'home') return [{ label: home.label, url: null }];
    const crumbs: BreadcrumbView[] = [home];
    const resolved = page as Resolved;
    switch (resolved.kind) {
        case 'entry': {
            const archive = resolved.collection.hierarchical ? null : await cms.archiveUrl(resolved.collection, locale).catch(() => null);
            if (archive && archive !== home.url) crumbs.push({ label: resolved.collection.label, url: archive });
            if (resolved.collection.hierarchical) for (const ancestor of await entryAncestors(cms, resolved.collection, resolved.record)) crumbs.push({ label: ancestor.name, url: ancestor.url });
            crumbs.push({ label: recordTitle(resolved.record, 'title'), url: null });
            break;
        }
        case 'archive': crumbs.push({ label: resolved.collection.label, url: null }); break;
        case 'term': {
            const taxonomy = cms.taxonomies.declaration(resolved.term.taxonomy);
            for (const ancestor of resolved.ancestors) crumbs.push({ label: ancestor.name, url: taxonomy.path ? `${prefix}/${taxonomy.path}/${ancestor.slug}` : null });
            crumbs.push({ label: resolved.term.name, url: null });
            break;
        }
        case 'search': crumbs.push({ label: __('Search'), url: null }); break;
        case 'author': crumbs.push({ label: resolved.user.name, url: null }); break;
        default: break;
    }
    return crumbs;
}

/** Ancestors of a nested entry, top first, each with its URL; the SEO graph's breadcrumbs use it too. */
export async function entryAncestors(cms: CmsHost, collection: CollectionDefinition, record: RecordShape): Promise<{ name: string; url: string }[]> {
    const chain: RecordShape[] = [];
    let parent = typeof record.parent === 'string' ? record.parent : null;
    for (let depth = 0; parent && depth < 8; depth++) {
        const found = (await cms.resource(`cms/${collection.name}`).getMany([parent], { principal: { kind: 'anonymous' } })).get(parent);
        if (!found) break;
        chain.unshift(found);
        parent = typeof found.parent === 'string' ? found.parent : null;
    }
    const urls = await cms.entryUrls(collection, chain);
    return chain.flatMap(entry => urls.get(entry.id) ? [{ name: String(entry.title ?? ''), url: urls.get(entry.id)! }] : []);
}

/** What the site blocks need of the site and the page, in the page's language: the logo and search blocks, the share buttons (`url`) and the breadcrumbs. */
export interface SiteInfo { readonly title: string; readonly tagline: string; readonly logo: string | null; readonly homeUrl: string; readonly searchUrl: string; readonly locale: string; readonly url: string; readonly breadcrumbs: readonly BreadcrumbView[] }

export async function siteInfo(cms: CmsHost, locale?: string, page: { /** The page's absolute URL. */ url?: string; /** The page resolved, for its breadcrumbs. */ page?: Resolved | { kind: string; locale: string } } = {}): Promise<SiteInfo> {
    const settings = await cms.settings.all();
    const languages = await cms.languages();
    const prefix = localePrefix(languages, locale ?? languages.default);
    return { title: settings['general.siteTitle'], tagline: settings['general.tagline'], logo: settings['general.logo'] || null, homeUrl: prefix || '/', searchUrl: `${prefix}/search`,
        locale: locale ?? languages.default, url: page.url ?? '', breadcrumbs: await breadcrumbTrail(cms, page.page, languages, locale ?? languages.default) };
}

/**
 * The menus of the active theme's locations, finished for the site (`menuViews`); an unassigned
 * primary location lists the top-level pages. Menus bind to the site and the signed-in user,
 * never to the entry shown, so a panel reads the same on every page.
 */
export async function siteMenus(cms: CmsHost, theme: ThemeState, options: { locale?: string; user?: { name: string } | null; forms?: FormRequest; usage?: { user: boolean }; patternDrafts?: ReadonlyMap<string, readonly Block[]> } = {}): Promise<Record<string, readonly MenuItemView[]>> {
    const settings = await cms.settings.all();
    const languages = await cms.languages();
    const locale = options.locale ?? languages.default;
    const info = cms.themes().find(entry => entry.name === theme.name);
    const declared = info?.locations.map(location => location.name) ?? [];
    const locations = declared.length ? declared : ['primary'];
    const menus: Record<string, readonly MenuItemView[]> = {};
    const scopes = bindingScopes(settings, { user: options.user ?? null });
    for (const location of locations) {
        const menu = await cms.menus.forLocation(location, languages.multilingual ? locale : undefined).catch(() => null);
        if (menu) menus[location] = await menuViews(cms, menu, { scopes, locale, forms: options.forms, usage: options.usage, patternDrafts: options.patternDrafts });
        else if (location === 'primary') menus[location] = await pageMenu(cms, languages, locale);
    }
    return menus;
}

/** The menus a page's own blocks show: those of the theme's locations when a Navigation block is among the blocks, nothing otherwise. */
export async function contentMenus(cms: CmsHost, theme: ThemeState, blocks: readonly RenderedBlock[], options: { locale?: string; user?: { name: string } | null; forms?: FormRequest; usage?: { user: boolean } } = {}): Promise<Record<string, readonly MenuItemView[]>> {
    let found = false;
    walkBlocks(blocks, block => { if (block.type === 'core/navigation') found = true; });
    return found ? siteMenus(cms, theme, options) : {};
}

/** The blocks of the theme's widget areas, rendered: the saved blocks, or the theme's defaults until the site saves its own; blocks of inactive plugins are left out. */
export async function areaViews(cms: CmsHost, declared: readonly { name: string; defaults: readonly Block[] }[], forms?: FormRequest, scopes?: BindingScopes, usage?: { user: boolean }, drafts?: ReadonlyMap<string, readonly Block[]>, patternDrafts?: ReadonlyMap<string, readonly Block[]>): Promise<Record<string, RenderedBlock[]>> {
    if (!declared.length) return {};
    const saved = await cms.areas.all().catch(() => new Map<string, { blocks: readonly Block[] }>());
    const available = new Set((await cms.blocks()).map(block => block.name));
    const blocks = new Map(declared.map(area => [area.name, (drafts?.get(area.name) ?? saved.get(area.name)?.blocks ?? area.defaults).filter(block => available.has(block.type))]));
    const all = [...blocks.values()].flat() as Block[];
    const patterns = withPatternDrafts(await usedPatterns(cms, blockDocuments(all, cms.blockTypes), all), patternDrafts);
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
async function withLatest(cms: CmsHost, blocks: readonly RenderedBlock[], locale?: string, options: { exclude?: string } = {}): Promise<void> {
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
            const resource = cms.resourceById(`cms/${collection.name}`);
            const author = typeof block.data.author === 'string' && block.data.author && 'authors' in resource.fields ? block.data.author : '';
            if (author) where.authors = { contains: author };
            const offset = Math.min(Math.max(Math.trunc(Number(block.data.offset) || 0), 0), 100);
            const exclude = block.data.excludeCurrent !== false && options.exclude ? options.exclude : '';
            const stickyFirst = block.data.stickyFirst === true && 'sticky' in resource.fields;
            // The page reads a few more than it shows: the entry being shown is left out, and sticky entries move to the front.
            const page = await cms.resource(`cms/${collection.name}`).list({ where, order, limit: Math.min(count + offset + (exclude ? 1 : 0) + (stickyFirst ? 10 : 0), 100) }, visitor);
            let records = page.records.filter(record => record.id !== exclude);
            if (stickyFirst) records = [...records.filter(record => record.sticky === true), ...records.filter(record => record.sticky !== true)];
            (block as { entries?: readonly EntryView[] }).entries = await entryViews(cms, collection, records.slice(offset, offset + count));
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
    const resizes = imageOptions(cms);
    const media = (id: string) => {
        const view = mediaView(files.get(id), resizes);
        return view ? { url: view.url, width: view.width, height: view.height, srcset: view.srcset } : null;
    };
    // Bindings resolve in each text run, as in a block's text fields; a run that names the user makes the page per user.
    const text = (scope: BindingScopes) => (value: string) => {
        if (scope.user && usage && usesUserBinding(value)) usage.user = true;
        return resolveBindings(value, scope);
    };
    const parts = (doc: RichTextDoc, scope?: BindingScopes, depth = 0): BodyPart[] => richTextParts(doc, { media, ...(scope ? { text: text(scope) } : {}) }).flatMap((part): BodyPart[] => {
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
        } catch (error) {
            if (!isCmsError(error)) throw error;
            // The page still renders, without the form; say why, or a missing form cannot be told from a bug.
            console.warn(`[cms] the form "${slug}" was left off the page: ${error.message}`);
        }
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
            return url ? [{ id: record.id, label: recordTitle(record, 'title'), url, newTab: false, kind: 'entry' as const, description: '', className: '', attributes: {}, fields: {}, panel: null, children: [] }] : [];
        });
    } catch { return []; /* before setup, or without pages */ }
}

/**
 * Resolved menu items finished for the site and the content API: each item's meta becomes typed
 * `fields` (media as views, blocks rendered, references with titles and URLs) through the field
 * groups attached to menu items, and its panel pattern renders like a widget area: expanded one
 * level, media resolved, latest entries filled, forms placed. A panel that is gone is null.
 */
export async function menuViews(cms: CmsHost, items: readonly ResolvedMenuItem[], options: { scopes?: BindingScopes; locale?: string; forms?: FormRequest; usage?: { user: boolean }; patternDrafts?: ReadonlyMap<string, readonly Block[]> } = {}): Promise<MenuItemView[]> {
    const all = flattenResolved(items);
    if (!all.length) return [];
    const settings = await cms.settings.all();
    useImageSettings(cms, settings);
    const scopes = options.scopes ?? bindingScopes(settings);
    const locale = options.locale ?? (await cms.languages()).default;
    const declarations = Object.entries(fieldGroupDeclarations(cms.fieldGroupsFor({ kind: 'menus' }).flatMap(group => group.blocks), cms.blockTypes));
    // The panels' patterns, read as the site renders patterns; a missing one leaves the item without a panel.
    const panelIds = [...new Set(all.map(item => item.panel).filter((id): id is string => !!id))];
    const panels = new Map<string, Block[]>();
    if (panelIds.length) {
        try {
            for (const [id, record] of await cms.resource('cms/patterns').getMany(panelIds, renderer)) if (Array.isArray(record.content)) panels.set(id, record.content as Block[]);
        } catch (error) { if (!isCmsError(error)) throw error; }
        for (const id of panelIds) { const draft = options.patternDrafts?.get(id); if (draft) panels.set(id, [...draft]); }
        // A panel's blocks are the pattern's own: marked as such, so Live Edit edits the pattern.
        for (const [id, blocks] of panels) panels.set(id, blocks.map(block => fromPattern(block, id)));
    }
    const metaBlocks = all.flatMap(item => declarations.flatMap(([name, declaration]) => declaration.kind === 'blocks' && Array.isArray(item.meta[name]) ? item.meta[name] as Block[] : []));
    const stored = [...[...panels.values()].flat(), ...metaBlocks];
    const patterns = withPatternDrafts(await usedPatterns(cms, blockDocuments(stored, cms.blockTypes), stored), options.patternDrafts);
    const expanded = new Map([...panels].map(([id, blocks]) => [id, expandPatterns(blocks, patterns)]));
    const ids = new Set<string>();
    for (const list of expanded.values()) for (const block of list) blockMediaIds(cms, block, ids);
    for (const item of all) for (const [name, declaration] of declarations) {
        const value = item.meta[name];
        if (declaration.media && typeof value === 'string') ids.add(value);
        if (declaration.media && Array.isArray(value)) for (const id of value) ids.add(String(id));
        if (declaration.kind === 'blocks' && Array.isArray(value)) for (const block of expandPatterns(value as Block[], patterns)) blockMediaIds(cms, block, ids);
    }
    const files = cms.files && ids.size ? await cms.files.getMany([...ids]) : new Map<string, CmsFile>();
    const richText = bodyRenderer(cms, files, patterns, options.usage);
    const render = (block: RenderedBlock) => renderedBlock(cms, block, files, doc => richText(doc, scopes), scopes, { patterns, ...(options.usage ? { usage: options.usage } : {}) });
    const references = await referencedRecords(cms, declarations, all.map(item => ({ id: item.id, rev: 0, createdAt: 0, updatedAt: 0, owner: null, ...item.meta })));
    const context: FieldViewContext = { full: true, files, resizes: imageOptions(cms), terms: new Map(), termUrl: () => null, references, patterns, richText: doc => richText(doc, scopes), render };
    const rendered: RenderedBlock[] = [];
    const view = (item: ResolvedMenuItem): MenuItemView => {
        const fields: Record<string, FieldView> = {};
        for (const [name, declaration] of declarations) {
            const typed = fieldViewOf(name, declaration, item.meta[name], locale, item.meta, context);
            if (typed !== undefined) fields[name] = typed;
        }
        const panel = item.panel && expanded.has(item.panel) ? expanded.get(item.panel)!.map(block => render(block as RenderedBlock)) : null;
        if (panel) rendered.push(...panel);
        return { id: item.id, label: item.label, url: item.url, newTab: item.newTab, kind: item.kind, description: item.description, className: item.className, attributes: item.attributes, fields, panel, children: item.children.map(view) };
    };
    const views = items.map(view);
    await withForms(cms, rendered, options.forms);
    await withLatest(cms, rendered, locale);
    return views;
}

function flattenResolved(items: readonly ResolvedMenuItem[]): ResolvedMenuItem[] {
    return items.flatMap(item => [item, ...flattenResolved(item.children)]);
}

/** How a site shows images: whether it resizes them, and Settings → Files. */
export interface ImageOptions { readonly resizes: boolean; readonly widths: readonly number[]; readonly placeholder: boolean; readonly sizes: string }

/** Each site's Settings → Files, as its last page read them; they are the same for every visitor. */
const IMAGE_SETTINGS = new WeakMap<CmsHost, Omit<ImageOptions, 'resizes'>>();

function useImageSettings(cms: CmsHost, settings: SiteSettings): void {
    IMAGE_SETTINGS.set(cms, { widths: imageWidths(settings['media.imageWidths']), placeholder: settings['media.placeholder'] !== 'none', sizes: settings['media.sizes'] || '(min-width: 768px) 768px, 100vw' });
}

function imageOptions(cms: CmsHost): ImageOptions {
    return { resizes: cms.files?.resizes ?? false, ...(IMAGE_SETTINGS.get(cms) ?? { widths: IMAGE_WIDTHS, placeholder: true, sizes: '(min-width: 768px) 768px, 100vw' }) };
}

/** A file as themes show it: cropped through a variant when the host resizes images, with `srcset`s. */
export function mediaView(file: CmsFile | undefined, imageOptions: ImageOptions): MediaView | null {
    if (!file) return null;
    const source = { ...file, version: file.updatedAt };
    const variants = imageOptions.resizes && transformable(file.contentType);
    const size = variants ? editedSize(file) : null;
    const { widths } = imageOptions;
    const url = variants && file.edits?.crop && size ? imageUrl(source, { width: Math.min(size.width, widths[widths.length - 1]!) }) : mediaUrl(file);
    return {
        url, alt: file.alt, width: size?.width ?? file.width, height: size?.height ?? file.height, contentType: file.contentType, name: file.name, size: file.size, caption: file.caption,
        srcset: variants ? imageSrcset(source, { widths }) : '', wideSrcset: variants ? imageSrcset(source, { aspect: 16 / 9, widths }) : '',
        placeholder: imageOptions.placeholder ? file.placeholder : null, sizes: imageOptions.sizes, focus: file.edits?.focus ?? null,
    };
}

/** Mark the first image of an entry to load at once: the featured image, or else the first Image block of its content. */
function markFirstImage(image: MediaView | null, content: readonly RenderedBlock[]): MediaView | null {
    if (image) return { ...image, priority: true };
    let done = false;
    walkBlocks(content, block => {
        if (done || block.type !== 'core/image' || !block.media.image) return;
        (block.media as Record<string, MediaView>).image = { ...block.media.image, priority: true };
        done = true;
    });
    return image;
}

/**
 * A block with its Markdown rendered, its rich text as parts (through `richText`, when given),
 * its media resolved and its children rendered. With `scopes`, text fields show what their
 * bindings read (`{{ $.price }}`, `{{ $site.title }}`). Markdown with block references renders
 * as `content.<field>`: its text runs and the referenced blocks, synced patterns expanded.
 */
function renderedBlock(cms: CmsHost, block: { _id: string; type: string; data: Record<string, unknown>; layout?: RenderedBlock['layout']; style?: RenderedBlock['style']; when?: RenderedBlock['when']; children?: readonly unknown[]; pattern?: string; sourceId?: string },
    files: ReadonlyMap<string, CmsFile>, richText?: (doc: RichTextDoc) => BodyPart[], scope?: BindingScopes, refs: { patterns?: ReadonlyMap<string, Block[]>; usage?: { user: boolean }; depth?: number } = {}): RenderedBlock {
    const html: Record<string, string> = {};
    const media: Record<string, MediaView> = {};
    const icons: Record<string, BrandIcon> = {};
    const content: Record<string, BodyPart[]> = {};
    const resizes = imageOptions(cms);
    const type = cms.blockTypes.get(block.type);
    // Code keeps its text: a value put into a Custom HTML block's HTML would run as markup.
    const bound = Object.entries(type?.fields ?? {}).filter(([, declaration]) => (declaration.kind === 'string' && !declaration.media) || (declaration.kind === 'text' && declaration.format !== 'code')).map(([key]) => key);
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
        // The networks a brand field links to, resolved here so the page ships only the icons it shows.
        for (const url of declaration.brand ? (Array.isArray(entry) ? entry : [entry]) : []) {
            const brand = typeof url === 'string' ? brandIcon(url) : null;
            if (brand) icons[url as string] = brand;
        }
    }
    // Share buttons name networks, not URLs: each gets its network's icon, by name.
    if (block.type === 'core/share') for (const network of Array.isArray(data.networks) ? data.networks as string[] : []) {
        const brand = SHARE_BRAND_URLS[network as keyof typeof SHARE_BRAND_URLS];
        const icon = brand ? brandIcon(brand) : null;
        if (icon) icons[network] = icon;
    }
    // The files a container's background shows, resolved like a media field's.
    for (const id of [block.style?.image, block.style?.video]) {
        const view = typeof id === 'string' && id ? mediaView(files.get(id), resizes) : null;
        if (view) media[id as string] = view;
    }
    const children = Array.isArray(block.children) ? (block.children as RenderedBlock[]).map(child => renderedBlock(cms, child, files, richText, scope, refs)) : undefined;
    return { _id: block._id, type: block.type, data, html, media, ...(Object.keys(icons).length ? { icons } : {}), ...(Object.keys(content).length ? { content } : {}), ...(type && blockIsData(type) ? { dataOnly: true } : {}),
        ...(block.pattern ? { pattern: block.pattern, sourceId: block.sourceId ?? block._id } : {}),
        ...(block.layout ? { layout: block.layout } : {}), ...(block.style ? { style: block.style } : {}), ...(block.when ? { when: block.when } : {}), ...(children ? { children } : {}) };
}

function blockMediaIds(cms: CmsHost, block: { type: string; data: Record<string, unknown>; style?: RenderedBlock['style']; children?: readonly unknown[] }, into: Set<string>): void {
    for (const id of [block.style?.image, block.style?.video]) if (typeof id === 'string' && id) into.add(id);
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

/**
 * Blocks with each Pattern block replaced by the pattern's blocks, their IDs prefixed so they
 * stay distinct; patterns inside patterns are left out. Each expanded block remembers the
 * pattern and its own ID there (`pattern`, `sourceId`), so Live Edit edits the pattern.
 */
function expandPatterns(blocks: readonly Block[], patterns: ReadonlyMap<string, Block[]>): Block[] {
    return blocks.flatMap(block => {
        if (block.type === 'core/pattern') {
            const id = String(block.data.pattern ?? '');
            return (patterns.get(id) ?? []).filter(inner => inner.type !== 'core/pattern').map(inner => prefixIds(fromPattern(inner, id), `${block._id}-`));
        }
        return [block.children ? { ...block, children: expandPatterns(block.children, patterns) } : block];
    });
}

/** A pattern's block as a page shows it: marked with the pattern and its ID there, children too. */
export function fromPattern(block: Block, pattern: string): Block {
    return { ...block, pattern, sourceId: block._id, ...(block.children ? { children: block.children.map(child => fromPattern(child, pattern)) } : {}) } as Block;
}

/** The patterns a page uses, with the editor's drafts of them in place of what is saved. */
function withPatternDrafts(patterns: Map<string, Block[]>, drafts?: ReadonlyMap<string, readonly Block[]>): Map<string, Block[]> {
    for (const [id, blocks] of drafts ?? []) patterns.set(id, [...blocks]);
    return patterns;
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
    /** The signed-in reader's role IDs, for members-only entries limited to roles. */
    roles?: readonly string[];
    /** IDs of entries the reader may edit: nothing of them is locked. */
    editable?: ReadonlySet<string>;
    /** Set when a binding reads the signed-in user, so the page is not cached for everyone. */
    usage?: { user: boolean };
    /** IDs of protected entries this visitor unlocked, whose content shows. */
    unlocked?: ReadonlySet<string>;
    /** The request, for the forms the entry places; without it they render nothing. */
    forms?: FormRequest;
    /** Live Edit: the editor's drafts of synced patterns, in place of what is saved. */
    patternDrafts?: ReadonlyMap<string, readonly Block[]>;
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

/** Whether only signed-in users read an entry's content. */
export function isMembersOnly(record: RecordShape): boolean {
    return record.membersOnly === true;
}

/** The roles a members-only entry is for; empty for every signed-in user. */
export function memberRoles(record: RecordShape): string[] {
    return Array.isArray(record.memberRoles) ? record.memberRoles.filter((role): role is string => typeof role === 'string' && role !== '') : [];
}

/** Who reads an entry: signed in or not, with which role IDs, and whether they may edit it. */
export interface EntryReader {
    readonly signedIn: boolean;
    readonly roles?: readonly string[];
    /** May edit the entry: nothing is locked for them. */
    readonly editor?: boolean;
    /** IDs of protected entries this visitor unlocked with their password. */
    readonly unlocked?: ReadonlySet<string> | undefined;
}

/**
 * Why a reader cannot read an entry's content: `password` for a protected entry they have not
 * unlocked, `members` for a members-only entry and a reader who is not signed in or has none
 * of its roles; null when they can. A password wins: signing in does not unlock a protected entry.
 */
export function entryLock(record: RecordShape, reader: EntryReader): 'password' | 'members' | null {
    if (reader.editor) return null;
    if (isProtected(record) && !reader.unlocked?.has(record.id)) return 'password';
    if (!isMembersOnly(record)) return null;
    if (!reader.signedIn) return 'members';
    const roles = memberRoles(record);
    return roles.length && !roles.some(role => reader.roles?.includes(role)) ? 'members' : null;
}

/**
 * Search results a signed-in dashboard user may see: a locked entry (`entryLock`) that matched
 * would tell what its content says, so only entries open to them stay, as the content API's search.
 */
export function openMatches(cms: CmsHost, resourceId: string, records: readonly RecordShape[], principal: Principal): RecordShape[] {
    const repository = cms.resource(resourceId);
    const signedIn = principal.kind === 'user';
    return records.filter(record => !entryLock(record, { editor: signedIn && repository.canUpdate(record, principal), signedIn, roles: signedIn ? principal.roles : [] }));
}

/**
 * Why the request's reader cannot read the entry (`entryLock`), from its principal and the
 * entry's unlock cookie, as the entry's page decides: for the comments API and form.
 */
export async function requestLock(cms: CmsHost, record: RecordShape, resourceId: string, principal: Principal, cookie: string | undefined): Promise<'password' | 'members' | null> {
    const editor = principal.kind === 'user' && cms.resource(resourceId).canUpdate(record, principal);
    const unlocked = isProtected(record) && cookie !== undefined && cookie === await unlockToken(record);
    return entryLock(record, { signedIn: principal.kind === 'user', roles: principal.kind === 'user' ? principal.roles : [], editor, unlocked: unlocked ? new Set([record.id]) : undefined });
}

/**
 * The entry a theme's `$` bindings read (widgets, theme options): whole for a reader the site's
 * gate lets in, less its password, else the reader's view (`lockedView`), so a binding can never
 * print a locked entry's content or anyone's password.
 */
export async function bindableEntry(cms: CmsHost, collection: string, record: RecordShape, principal: Principal, cookie: string | undefined): Promise<RecordShape> {
    const resource = `cms/${collection}`;
    if (await requestLock(cms, record, resource, principal, cookie)) return lockedView(record, cms.resourceById(resource).fields);
    const { password: _password, ...open } = record;
    return open as RecordShape;
}

/** The cookie that remembers an unlocked entry, and its value: a digest of the entry and its password. */
export function unlockCookie(record: RecordShape): string {
    return `cms_unlock_${record.id}`;
}
export async function unlockToken(record: RecordShape): Promise<string> {
    const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`cms-unlock:${record.id}:${String(record.password)}`)));
    return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

/** What typed field views are built from: the files, terms and references already read, and how rich text and blocks render. */
interface FieldViewContext {
    /** Bodies and blocks are included; lists leave them out. */
    readonly full: boolean;
    readonly files: ReadonlyMap<string, CmsFile>;
    readonly resizes: ImageOptions;
    readonly terms: ReadonlyMap<string, TermShape>;
    readonly termUrl: (term: TermShape, locale: string) => string | null;
    readonly references: ReadonlyMap<string, EntryReference>;
    readonly patterns: ReadonlyMap<string, Block[]>;
    /** Rich text as body parts, its bindings read against `scope`. */
    readonly richText: (doc: RichTextDoc, scope: Readonly<Record<string, unknown>>) => BodyPart[];
    /** A block rendered, its bindings read against `scope`. */
    readonly render: (block: RenderedBlock, scope: Readonly<Record<string, unknown>>) => RenderedBlock;
}

/**
 * A field's typed value (`FieldView`) for entry views and menu items; undefined leaves it out
 * (rich text, Markdown and blocks in lists, vectors). `scope` is what the field's bindings read.
 */
function fieldViewOf(name: string, declaration: FieldDeclaration, value: unknown, locale: string, scope: Readonly<Record<string, unknown>>, context: FieldViewContext): FieldView | undefined {
    const { full, files, resizes, terms, termUrl, references, patterns } = context;
    if (declaration.kind === 'vector' || declaration.kind === 'bigint') return undefined;
    if ((declaration.kind === 'richtext' || declaration.kind === 'blocks' || (declaration.kind === 'text' && declaration.format === 'markdown')) && !full) return undefined;
    if (value === undefined || value === null || value === '') return null;
    // A multiple field is the list of its kind's views; its rich text and Markdown items are one block each.
    if (declaration.multiple && !declaration.taxonomy && !declaration.media && Array.isArray(value)) {
        const items = value.map((item, index) => fieldViewOf(`${name}-${index + 1}`, { ...declaration, multiple: false }, item, locale, scope, context));
        if (items.some(item => item === undefined)) return undefined;
        return declaration.kind === 'richtext' || (declaration.kind === 'text' && declaration.format === 'markdown')
            ? items.flatMap(item => (item as readonly RenderedBlock[] | null) ?? []).map(block => ({ ...block, field: name }))
            : items.filter((item): item is Exclude<FieldView, null> => item !== null) as FieldView;
    }
    if (declaration.taxonomy) return ((value as string[] | undefined) ?? []).map(id => terms.get(id)).filter((term): term is TermShape => !!term).map((term): TermLink => ({ name: term.name, url: termUrl(term, locale), icon: term.icon }));
    if (declaration.media && Array.isArray(value)) return value.map(id => mediaView(files.get(String(id)), resizes)).filter((view): view is MediaView => !!view);
    if (declaration.media) return mediaView(files.get(String(value)), resizes);
    if (declaration.kind === 'reference') return references.get(`${declaration.target}:${String(value)}`) ?? null;
    if (declaration.kind === 'richtext') return typeof value === 'object' ? [textBlock(name, context.richText(value as RichTextDoc, scope))] : null;
    if (declaration.kind === 'text' && declaration.format === 'markdown') {
        // Block references render through a paragraph of the text, which parses them.
        if (hasBlockReference(value)) return [textBlock(name, context.render({ _id: name, type: 'core/paragraph', data: { text: value }, html: {}, media: {} }, scope).content?.text ?? [])];
        return [textBlock(name, [{ kind: 'html', html: renderMarkdown(String(value)) }])];
    }
    if (declaration.kind === 'blocks') return Array.isArray(value) ? (expandPatterns(value as Block[], patterns) as RenderedBlock[]).map(block => context.render(block, scope)) : [];
    return value as FieldView;
}

/** Views of entries: content rendered with its blocks, patterns and media, authors, URLs, term links, typed fields and comments. */
/** Minutes to read a text at 200 words a minute: at least 1 when there are words, 0 when there are none. */
export function readingTime(text: string): number {
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    return words ? Math.max(1, Math.round(words / 200)) : 0;
}

export async function entryViews(cms: CmsHost, collection: CollectionDefinition, records: readonly RecordShape[], options: EntryViewOptions = {}): Promise<EntryView[]> {
    const resource = cms.resourceById(`cms/${collection.name}`);
    const settings = await cms.settings.all();
    useImageSettings(cms, settings);
    const languages = await cms.languages();
    const resizes = imageOptions(cms);
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
    const patterns = withPatternDrafts(await usedPatterns(cms, docs, options.full ? records.flatMap(stored) : []), options.patternDrafts);
    /**
     * The content's plain text for an excerpt: every content field in order, 4,000 characters at most.
     * Bindings resolve against the entry alone: excerpts and descriptions are the same for every visitor.
     */
    const contentPlain = (record: RecordShape): string => {
        let text = '';
        for (const [name, declaration] of contentFields) {
            const value = record[name];
            if (text.length >= 4000) break;
            if (declaration.kind === 'blocks' && Array.isArray(value)) text += ` ${blocksPlain(value as Block[], cms.blockTypes, doc => richTextPlain(doc), 4000 - text.length)}`;
            else if (declaration.kind === 'richtext' && value && typeof value === 'object') text += ` ${richTextPlain(value as RichTextDoc)}`;
            else if (declaration.kind === 'text' && typeof value === 'string') text += ` ${value}`;
        }
        return resolveBindings(text.trim(), bindingScopes(settings, { entry: record, user: null })).slice(0, 4000);
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
    // Articles name their authors; with author pages on, the names link to the authors' pages, so the users need slugs.
    const articles = ARTICLE_TYPES.has(collection.schema?.type ?? 'WebPage');
    const found = articles ? await cms.users.getMany([...new Set(records.flatMap(record => entryAuthors(record)))]) : new Map<string, CmsUser>();
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
    const context: FieldViewContext = {
        full: options.full === true, files, resizes, terms, termUrl, references, patterns,
        richText: (doc, scope) => parts(doc, bindingScopes(settings, { entry: scope, user: options.user ?? null })),
        render: (block, scope) => render(block, scope as RecordShape),
    };
    const views: EntryView[] = [];
    for (const record of records) {
        const locale = typeof record.locale === 'string' ? record.locale : languages.default;
        // A protected entry a visitor has not unlocked, or a members-only one and a visitor not signed in, shows its title alone.
        const lock = entryLock(record, { unlocked: options.unlocked, signedIn: Boolean(options.user), roles: options.roles ?? [], editor: options.editable?.has(record.id) === true });
        const locked = lock !== null;
        // A members-only entry reads differently for signed-in users: the page is theirs alone.
        if (isMembersOnly(record) && options.usage) options.usage.user = true;
        const typed: Record<string, FieldView> = {};
        for (const [name, declaration] of fields) {
            // A locked entry shows nothing of its fields; the password itself is never a field of the view.
            if (NOT_FIELDS.has(name) || name === 'password' || locked) continue;
            const view = fieldViewOf(name, declaration, record[name], locale, record, context);
            if (view !== undefined) typed[name] = view;
        }
        // Each content field is rendered once, for `content` and for `fields`; the headings get anchors and a table of contents its list.
        const content = options.full && !locked ? withHeadingAnchors(contentFields.flatMap(([name]) => (typed[name] as readonly RenderedBlock[] | null | undefined) ?? [])) : [];
        const details = options.full ? fields.filter(([name, declaration]) => !NOT_DETAILS.has(name) && !declaration.taxonomy && !declaration.media
            && !['text', 'blocks', 'richtext', 'json', 'reference', 'vector', 'bigint'].includes(declaration.kind) && typed[name] !== null && typed[name] !== undefined && typed[name] !== '' && !(Array.isArray(typed[name]) && !(typed[name] as unknown[]).length))
            .map(([name, declaration]) => ({ label: declaration.label ?? name, value: displayValue(declaration.kind, typed[name], settings) })) : [];
        const featured = imageField ? mediaView(files.get(String(record[imageField[0]] ?? '')), resizes) : null;
        views.push({
            id: record.id, title: recordTitle(record, 'title'), url: urls.get(record.id) ?? null, collection: collection.name, kind: collection.singular,
            date: typeof record.publishedAt === 'number' ? formatSiteDate(record.publishedAt, settings) : '',
            updated: collection.publishable === false ? '' : formatSiteDate(record.updatedAt, settings),
            readingTime: locked ? 0 : readingTime(contentPlain(record)),
            authors: articles ? entryAuthors(record).map(id => owners.get(id)).filter(user => user !== undefined)
                .map(user => ({ name: user.name, url: settings['seo.authorPages'] ? authorUrl(user.slug, localePrefix(languages, locale)) : null, avatar: user.avatar })) : [],
            excerpt: locked ? '' : excerptField && record.excerpt ? String(record.excerpt) : typeof record.summary === 'string' && record.summary ? excerptOf(record.summary, 40) : excerptOf(contentPlain(record), 40),
            summary: locked || typeof record.summary !== 'string' ? '' : record.summary,
            content,
            image: options.full && settings['media.eagerFirstImage'] && records.length === 1 ? markFirstImage(featured, content) : featured,
            terms: taxonomyFields.map(([name, declaration]) => ({
                label: cms.taxonomies.declaration(declaration.taxonomy!).label,
                terms: ((record[name] as string[] | undefined) ?? []).map(id => terms.get(id)).filter((term): term is TermShape => !!term).map(term => ({ name: term.name, url: termUrl(term, locale), icon: term.icon })),
            })),
            fields: typed,
            details,
            template: typeof record.template === 'string' && record.template ? record.template : null,
            locale,
            comments: options.full && collection.comments && !locked && cms.discussions(settings) ? await commentsView(cms, collection, record, urls.get(record.id) ?? '/', settings, options) : null,
            locked: lock,
        });
        if (options.full && !locked) {
            // Active plugins change the title and excerpt, and add blocks around the content, through `cms.site.entry-view`.
            const parts = await entryViewParts(cms, collection, record, views.at(-1)!, Boolean(options.user));
            if (parts) {
                const view = views.at(-1)!;
                const around = (blocks: readonly Block[]) => (expandPatterns(blocks, patterns) as RenderedBlock[]).map(block => render(block, record));
                content.unshift(...around(parts.before));
                content.push(...around(parts.after));
                views[views.length - 1] = { ...view, title: parts.title, excerpt: parts.excerpt };
            }
        }
        if (options.full) {
            await withForms(cms, content, options.forms);
            await withLatest(cms, content, locale, { exclude: record.id });
        }
    }
    return views;
}

/**
 * The `cms.site.entry-view` filters' changes to a full entry view, checked: a title and excerpt
 * of bounded text, and valid blocks of known types other than `core/html`, at most ten each side.
 * Null without a change, or when a filter failed or returned something else.
 */
export async function entryViewParts(cms: CmsHost, collection: CollectionDefinition, record: RecordShape, view: EntryView, signedIn: boolean): Promise<EntryViewParts | null> {
    const original: EntryViewParts = { title: view.title, excerpt: view.excerpt, before: [], after: [] };
    const { password: _password, ...visible } = record;
    const changed = await cms.hooks.applyFilters(siteEntryView, original, { collection: collection.name, id: record.id, url: view.url, record: visible as RecordShape, signedIn }).catch(() => original);
    if (changed === original || !changed || typeof changed !== 'object') return null;
    const blocks = (value: unknown): Block[] => {
        if (!Array.isArray(value) || !value.length || value.length > 10 || JSON.stringify(value).length > 64_000) return [];
        const { blocks: valid, errors } = validateBlocks(value as Block[], cms.blockTypes);
        return Object.keys(errors).length || flattenBlocks(valid).some(block => ENTRY_VIEW_REFUSED_BLOCKS.has(block.type)) ? [] : valid;
    };
    const text = (value: unknown, fallback: string, max: number) => typeof value === 'string' ? value.slice(0, max) : fallback;
    return { title: text(changed.title, view.title, 300) || view.title, excerpt: text(changed.excerpt, view.excerpt, 1000), before: blocks(changed.before), after: blocks(changed.after) };
}

/** Comment text as escaped paragraphs, with line breaks kept. */
function commentHtml(text: string): string {
    return text.split(/\n{2,}/).map(paragraph => `<p>${escapeHtml(paragraph).replaceAll('\n', '<br>')}</p>`).join('');
}

/** An entry's approved comments as a thread, and the form when comments are open. */
async function commentsView(cms: CmsHost, collection: CollectionDefinition, record: RecordShape, url: string, settings: SiteSettings, options: EntryViewOptions): Promise<CommentsView> {
    const open = cms.commentsOpen(collection, record, settings);
    let comments: CommentShape[] = [];
    let users = new Map<string, CmsUser>();
    // The entry still shows when its comments or their authors cannot be read.
    try {
        comments = await cms.comments.forEntry(`cms/${collection.name}`, record.id);
        users = await cms.users.getMany(comments.map(comment => comment.userId).filter((id): id is string => !!id));
    } catch (error) {
        comments = [];
        console.warn(`[cms] the comments of ${collection.name}/${record.id} were left off the page: ${error instanceof Error ? error.message : String(error)}`);
    }
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
    // Both URL modes take the default language's code, so links from the other mode redirect.
    const prefixed = languages.multilingual && segments.length > 0 && languages.all.includes(segments[0]!);
    const locale = prefixed ? segments[0]! : languages.default;
    const rest = prefixed ? segments.slice(1) : segments;
    const resolved = await resolveIn(cms, languages, locale, rest, segments);
    // Pages other than entries (which redirect to their own URL) move to their language's prefix.
    // The default language can change, so these redirects are temporary.
    const prefix = localePrefix(languages, locale);
    if (['home', 'archive', 'term', 'author', 'search'].includes(resolved.kind) && prefix !== (prefixed ? `/${segments[0]}` : '')) {
        return { kind: 'redirect', url: `${prefix}/${rest.join('/')}`.replace(/\/$/, '') || '/', status: 302 };
    }
    return resolved;
}

async function resolveIn(cms: CmsHost, languages: SiteLanguages, locale: string, rest: readonly string[], segments: readonly string[]): Promise<Resolved> {
    const prefixed = rest.length < segments.length;
    // `/` and `/<language>` are home pages.
    if (!rest.length) return { kind: 'home', locale };
    if (prefixed && rest.length === 1 && rest[0] === 'search') return { kind: 'search', locale };
    if (rest.some(segment => !/^[a-z0-9-]{1,200}$/.test(segment))) return { kind: 'none', locale };
    const path = rest.join('/');
    // Collections served under a path: /<path> is the archive, /<path>/<slug> an entry.
    for (const collection of cms.collections()) {
        if (!collection.path) continue;
        if (path === collection.path) return { kind: 'archive', collection, locale };
        if (!path.startsWith(`${collection.path}/`)) continue;
        const slugs = path.slice(collection.path.length + 1).split('/');
        // Category permalinks take /<path>/<category>/<slug>; the entry then answers at its own address only.
        if (!collection.hierarchical && slugs.length > (collection.permalink === 'category' ? 2 : 1)) return { kind: 'none', locale };
        const found = await bySlug(cms, collection, slugs.at(-1)!, languages, locale);
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
        const found = await bySlug(cms, root, rest.at(-1)!, languages, locale);
        if (found) return canonical(cms, root, found, segments);
    }
    return { kind: 'none', locale };
}

/** The redirect for a path without content, if any; its use is counted in the background. */
export async function redirectFor(cms: CmsHost, path: string, query: string, later: (work: Promise<unknown>) => void): Promise<Resolved | null> {
    let match;
    let prefix = '';
    try {
        match = await cms.redirects.match(path);
        // A moved collection's or taxonomy's redirects are written without a language prefix: under
        // a language's prefix the same redirect applies, and its target keeps that prefix.
        if (!match) {
            const languages = await cms.languages();
            const code = path.split('/')[1] ?? '';
            if (languages.multilingual && languages.all.includes(code)) {
                const rest = path.slice(code.length + 1) || '/';
                const unprefixed = await cms.redirects.match(rest);
                if (unprefixed?.redirect.prefix && unprefixed.location?.startsWith('/')) { match = unprefixed; prefix = `/${code}`; }
            }
        }
    }
    catch (error) { if (isCmsError(error) || /cms_redirects|no such table/i.test(String((error as Error).message))) return null; throw error; }
    if (!match) return null;
    later(cms.redirects.hit(match.redirect.id));
    if (match.location === null) return { kind: 'gone' };
    const target = prefix ? `${prefix}${match.location === '/' ? '' : match.location}` || '/' : match.location;
    const location = query && !target.includes('?') ? `${target}?${query}` : target;
    return { kind: 'redirect', url: location, status: match.redirect.status as 301 | 302 | 307 | 308 };
}

/**
 * The published entry with a slug in a language; each language has its own slugs. A slug
 * only another language has finds that entry, which then redirects to its own URL.
 */
async function bySlug(cms: CmsHost, collection: CollectionDefinition, slug: string, languages: SiteLanguages, locale: string): Promise<RecordShape | null> {
    if (collection.slug === false) return null;
    const where: { [field: string]: FieldFilter } = { slug, ...(collection.publishable === false ? {} : { status: 'published' }) };
    const repository = cms.resource(`cms/${collection.name}`);
    const found = (await repository.list({ where: { ...where, ...localeWhere(languages, locale) }, limit: 1 }, visitor)).records[0];
    if (found || !languages.multilingual) return found ?? null;
    return (await repository.list({ where, limit: 1 }, visitor)).records[0] ?? null;
}

/** An entry answers only at its URL (ancestors' slugs, language prefix); other paths redirect there. */
async function canonical(cms: CmsHost, collection: CollectionDefinition, record: RecordShape, segments: readonly string[]): Promise<Resolved> {
    const url = (await cms.entryUrls(collection, [record])).get(record.id);
    if (!url) return { kind: 'none', locale: (await cms.languages()).default };
    const languages = await cms.languages();
    const locale = typeof record.locale === 'string' && languages.all.includes(record.locale) ? record.locale : languages.default;
    if (url === `/${segments.join('/')}`) return { kind: 'entry', collection, record, locale };
    // Which language a prefix names follows the settings, which can change (a new default language,
    // another URL mode): a browser must not keep that redirect. Other paths to the entry move for good.
    const requested = languages.multilingual && languages.all.includes(segments[0] ?? '') ? `/${segments[0]}` : '';
    return { kind: 'redirect', url, ...(requested !== localePrefix(languages, locale) ? { status: 302 as const } : {}) };
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

/**
 * One page of the site's search: entries visitors may read, from every collection, best first,
 * with snippets, in the page's language. `base` is the first page's URL (`/search?q=…`).
 */
export async function searchEntries(cms: CmsHost, query: string, options: { locale?: string; page?: number; base: string }): Promise<{ entries: EntryView[]; paging: Paging; loose: boolean }> {
    const languages = await cms.languages();
    const page = options.page ?? 1;
    const none = { entries: [], paging: { page, pages: page, base: options.base }, loose: false };
    const perPage = Math.min(await cms.settings.get('reading.postsPerPage'), 50);
    const found = await cms.siteSearch.search(query, { page, perPage, ...(languages.multilingual ? { locale: options.locale ?? languages.default } : {}) })
        .catch(error => { if (isCmsError(error)) return null; throw error; });
    if (!found) return none;
    // The hits load as the visitor, who may still be refused one; they render in score order.
    const byCollection = new Map<string, string[]>();
    for (const hit of found.hits) byCollection.set(hit.collection, [...byCollection.get(hit.collection) ?? [], hit.id]);
    const views = new Map<string, EntryView>();
    for (const [name, ids] of byCollection) {
        const collection = cms.collections().find(entry => entry.name === name);
        if (!collection) continue;
        const records = await cms.resource(`cms/${name}`).getMany(ids, visitor);
        const readable = ids.map(id => records.get(id)).filter((record): record is RecordShape => record !== undefined && !isProtected(record) && !isMembersOnly(record));
        for (const view of await entryViews(cms, collection, readable)) views.set(`${name}:${view.id}`, view);
    }
    const entries = found.hits.flatMap(hit => { const view = views.get(`${hit.collection}:${hit.id}`); return view ? [{ ...view, snippet: hit.snippet }] : []; });
    return { entries, paging: { page, pages: found.next ? page + 1 : page, base: options.base }, loose: found.loose };
}

/** The search page's own URL for a query: `?q=` on the search path, and `page=N` after it. */
export function searchBase(path: string, query: string): string {
    return query ? `${path}?q=${encodeURIComponent(query)}` : path;
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
    return languages.all.map(code => ({ code, label: languageName(code), flag: languageFlag(code), url: urls.get(code) ?? home(code), current: code === current }));
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

/** The page Settings → Reading shows for missing addresses, in the language, as a full entry view; null when none is chosen, unpublished or absent. */
export async function notFoundPage(cms: CmsHost, locale: string): Promise<EntryView | null> {
    const id = String((await cms.settings.get('reading.notFoundPage').catch(() => '')) ?? '');
    if (!id || !cms.collections().some(collection => collection.name === 'pages')) return null;
    const languages = await cms.languages();
    let record = await cms.resource('cms/pages').get(id, visitor).catch(() => null);
    if (record && languages.multilingual && (record.locale ?? languages.default) !== locale) record = (await cms.translations(cms.collection('pages'), record)).get(locale) ?? null;
    if (!record || record.status !== 'published') return null;
    return (await entryViews(cms, cms.collection('pages'), [record], { full: true }))[0] ?? null;
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
