import { Client, ClientState, Cossack, Page, Server, State, defineServerMiddleware, setRequestLocale, type HeadValue } from '@cossackframework/core';
import { input } from '@cossackframework/core/input';
import { isTransportPath } from '@cossackframework/core/transport-routes';
import { getCookie } from 'hono/cookie';
import { component, html } from '@cossackframework/renderer';
import { hasPermission, isCmsError, isSameOriginPost, PERMISSIONS, type ArchiveView, type EntryView, type LanguageLink, type Note, type RecordShape, type ThemeData } from '@cossackframework/cms';
import type { CmsHost } from '@cossackframework/cms/server';
import { archive, authorArchive, authorView, bindableEntry, bindingScopes, commentResult, entryLock, entryViews, homeView, isMembersOnly, isProtected, languageLinks, localePrefix, pageNumber, redirectFor, requestLock, resolvePath, searchBase, searchEntries, termArchive, themeData, themeState, unlockCookie, unlockToken, resolvedOptions, type Resolved, type ThemeState, notFoundPage } from '../../../cms/site';
import { archiveTemplate, entryTemplate, siteContent, siteTheme, tagDocument, themeHelpers, unavailable } from '../../../cms/site-view';
import { authorSeo, entrySeo, homeSeo, listSeo } from '../../../cms/seo';
import { emptySeo, seoHead, type SeoView } from '../../../cms/seo-head';
import type { SiteDraft, SiteEditable } from '../../../cms/site-editor';
import { draftBlockOptions, draftEntry, draftMedia, editableRecord, frameDraft, saveDocuments, saveDraft, siteDraft, siteEditable } from '../../../cms/site-editing';
import { siteSession, type SiteEditingContext } from '../../../cms/site-session';
import type { SiteDocument } from '../../../cms/site-editor';
import { contentMenus, siteInfo, type SiteInfo } from '../../../cms/site';
import type { MenuItemView } from '@cossackframework/cms';
import { fieldErrors } from '../../../cms/content';
import { entryAsMarkdown, wantsMarkdown } from '../../../cms/machine';
import { applyCacheHeaders, cacheHeaders, listedCollections } from '../../../cms/cache';
import { trackCrawler, trackNotFound } from '../../../cms/traffic';
import { siteOrigin } from '../../../cms/seo';
import type { EditorBlock, EditorValues } from '../../../cms/editor';
import type { MediaPreview } from '../../../cms/field-controls';
import type { MediaChooserState } from '../../../cms/media-chooser';

/** What the layout needs of the draft's documents at render time, to mark the areas and the patterns in them. */
function editingContext(documents: readonly SiteDocument[]): SiteEditingContext {
    return {
        areas: documents.filter(document => document.kind === 'area').map(document => ({ name: document.name, blocks: document.blocks })),
        editable: documents.some(document => document.kind === 'area' && document.editable),
        patterns: documents.filter(document => document.kind === 'pattern').map(document => ({ id: document.name, editable: document.editable })),
    };
}

/** The site editor, loaded the first time an editor enters edit mode; visitors never load it. */
let SiteEditor: typeof import('../../../cms/site-editor.client').SiteEditor | undefined;

const segmentsOf = (path: string | undefined) => (path ?? '').split('/').filter(Boolean);

/**
 * Resolve the path before rendering, so entries can redirect to their canonical URL and
 * missing paths can follow redirects. A root catch-all's middleware also sees requests for
 * routes registered after it, such as /crpc, so it acts only on page reads. The home page
 * (`src/pages/(site)/index.ts`) runs it too.
 */
export const resolveSitePath = defineServerMiddleware(async (c, next) => {
    // Pages read with GET; a POST is a visitor's password for a protected entry, resolved the same way, never redirected.
    const post = c.req.method === 'POST';
    if ((c.req.method !== 'GET' && c.req.method !== 'HEAD' && !post) || isTransportPath(c.req.path)) { await next(); return; }
    // Unknown API paths keep their JSON 404.
    if (c.req.path === '/api' || c.req.path.startsWith('/api/')) return c.json({ error: 'Not Found', code: 'COSSACK_NOT_FOUND' }, 404);
    const cms = c.get('cms');
    let resolved: Resolved | { kind: 'unavailable' } = { kind: 'none', locale: 'en' };
    // Before setup, or while a migration is pending, content is unavailable.
    try {
        resolved = await resolvePath(cms, segmentsOf(c.req.param('path')));
        const query = new URL(c.req.url).search.slice(1);
        // A canonical or language redirect keeps the query, such as ?page=2 or ?edit.
        if (resolved.kind === 'redirect' && query && !resolved.url.includes('?')) resolved = { ...resolved, url: `${resolved.url}?${query}` };
        if (resolved.kind === 'none' && !post) {
            resolved = await redirectFor(cms, c.req.path, query, work => { try { c.executionCtx.waitUntil(work.catch(() => undefined)); } catch { void work.catch(() => undefined); } }) ?? resolved;
        }
    } catch (error) { if (!isCmsError(error, 'CMS_UNAVAILABLE')) throw error; resolved = { kind: 'unavailable' }; }
    if (resolved.kind === 'redirect') return post ? c.text('Not found', 404) : c.redirect(resolved.url, resolved.status ?? 301);
    // Agents asking for Markdown get the entry as a document; the HTML varies on Accept.
    if (resolved.kind === 'entry' && !post) {
        c.header('vary', 'Accept');
        if (wantsMarkdown(c.req.raw) && await cms.settings.get('seo.markdown')) {
            // As the HTML page decides: its editors and a visitor who unlocked it read a protected entry, members a members-only one.
            const lock = await requestLock(cms, resolved.record, `cms/${resolved.collection.name}`, c.get('principal'), getCookie(c, unlockCookie(resolved.record)));
            if (lock === 'password') return c.text('This entry is password protected.', 403);
            if (lock === 'members') return c.text('This entry is for members.', 403);
            trackCrawler(c, 'markdown');
            const url = (await cms.entryUrls(resolved.collection, [resolved.record])).get(resolved.record.id) ?? c.req.path;
            // Caches key HTML by URL and ignore Vary: Markdown chosen by Accept is never stored; `?format=md` is the address to cache.
            const addressed = /^(?:md|markdown)$/.test(c.req.query('format') ?? '');
            const headers = addressed && !isMembersOnly(resolved.record) && !isProtected(resolved.record) ? await cacheHeaders(cms, [cms.purge.tag.entry(resolved.collection.name, resolved.record.id), cms.purge.tag.collection(resolved.collection.name)]) : { 'cache-control': 'private, no-store' };
            return c.body(await entryAsMarkdown(cms, resolved.collection, resolved.record, url, siteOrigin(c)), 200, { 'content-type': 'text/markdown; charset=utf-8', ...headers, 'x-robots-tag': 'noindex' });
        }
    }
    if (!post) {
        if (resolved.kind === 'none') trackNotFound(c);
        if (resolved.kind !== 'unavailable') trackCrawler(c, resolved.kind === 'none' || resolved.kind === 'gone' ? 'not-found' : resolved.kind === 'entry' || resolved.kind === 'archive' || resolved.kind === 'home' || resolved.kind === 'term' || resolved.kind === 'author' || resolved.kind === 'search' ? resolved.kind : 'other');
    }
    c.set('cms.site', resolved);
    // The page renders in its content's language: <html lang>, and the theme's text when a catalog has it.
    if ('locale' in resolved) setRequestLocale(resolved.locale);
    await next();
});

/**
 * Every site URL without its own route: the home page (/, which `src/pages/(site)/index.ts`
 * routes here too), collection archives (/posts), entries (/posts/hello-world,
 * /shop/rocket-skates), term archives (/category/news), nested pages (/about/team) and other
 * languages' pages (/fr, /fr/a-propos), drawn by the active theme. Missing paths follow
 * Tools → Redirects; anything else is a 404. An entry its editor may update, a static front
 * page included, is edited in place at `?edit`.
 */
@Page({ transport: 'http', middlewares: [resolveSitePath] })
export default class SitePath extends Cossack {
    @State() kind: 'entry' | 'list' | 'home' | 'none' | 'gone' | 'unavailable' = 'none';
    @State() entry: EntryView | null = null;
    /** The entry is the page Settings → Reading shows for missing addresses: status 404, no indexing. */
    @State() notFound = false;
    /** Why this visitor cannot read the entry: the password form or a sign-in prompt shows instead of its content. */
    @State() locked: 'password' | 'members' | null = null;
    /** The site takes registrations: a members-only entry's prompt links to the registration page. */
    @State() registration = false;
    @State() wrongPassword = false;
    @State() view: ArchiveView = { kind: 'archive', collection: null, taxonomy: null, title: '', description: '', entries: [], paging: { page: 1, pages: 1, base: '/' }, query: '' };
    @State() theme: ThemeState = { name: null, options: {} };
    /** The page in each of the site's languages, for `helpers.languages()` in the page's templates and blocks. */
    @State() languages: LanguageLink[] = [];
    /** The theme's menus, for Navigation blocks in the entry's own content; empty when it has none. */
    @State() menus: Record<string, readonly MenuItemView[]> = {};
    /** The site's title, logo and URLs in the page's language, for site blocks in the content. */
    @State() site: SiteInfo | null = null;
    /** What the theme's loader for the page returned. */
    @State() data: ThemeData = {};
    @State() seo: SeoView = emptySeo();
    /** For a signed-in user who may update the entry: what `?edit` opens, and the taskbar's editor links. Null for others. */
    @State() editable: SiteEditable | null = null;
    /** A list page whose frame (the theme's areas) the user may change: `?edit` opens the frame alone. */
    @State() frameEditable = false;
    /** Edit mode: the entry's draft. `?edit` opens it. */
    @State() draft: SiteDraft | null = null;
    @ClientState() editorReady = false;
    @ClientState() saving = false;

    head(): HeadValue {
        if (this.notFound) return { title: this.entry?.title ?? __('Page not found'), meta: [{ tag: 'meta', attributes: { name: 'robots', content: 'noindex' } }] };
        if (this.seo.title) return seoHead(this.seo);
        // Before setup the site is unavailable: the layout's site title, kept out of search results.
        if (this.kind === 'unavailable') return { meta: [{ tag: 'meta', attributes: { name: 'robots', content: 'noindex' } }] };
        return { title: this.kind === 'gone' ? __('Page removed') : __('Page not found'), meta: [{ tag: 'meta', attributes: { name: 'robots', content: 'noindex' } }] };
    }

    async init() {
        const cms = this.c.get('cms');
        const resolved = this.c.get('cms.site') ?? { kind: 'none', locale: 'en' };
        const page = pageNumber(this.c.req.query('page'));
        const base = `/${segmentsOf(this.c.req.param('path')).join('/')}`;
        try {
            this.theme = await themeState(cms);
            if (resolved.kind === 'unavailable') { this.kind = 'unavailable'; this.c.status(503); return; }
            if (resolved.kind === 'gone') { this.kind = 'gone'; this.c.status(410); await applyCacheHeaders(this.c, cms, [], { max: 60 }); return; }
            if (resolved.kind === 'none' || resolved.kind === 'redirect') {
                this.c.status(404);
                const locale = resolved.kind === 'none' ? resolved.locale : undefined;
                // Settings → Reading may choose a page for missing addresses: it renders as an entry, with status 404 and no indexing.
                const chosen = await notFoundPage(cms, locale ?? (await cms.languages()).default);
                if (chosen) {
                    this.kind = 'entry';
                    this.entry = chosen;
                    this.notFound = true;
                    this.site = await siteInfo(cms, locale ?? (await cms.languages()).default, { url: this.c.req.url });
                    this.data = await themeData(cms, this.theme, { kind: 'entry', collection: chosen.collection, template: chosen.template }, chosen, this.c.get('principal'), locale);
                } else this.data = await themeData(cms, this.theme, { kind: 'not-found' }, this.view, this.c.get('principal'), locale);
                // A page may appear here later: held a minute, and purged with the site.
                await applyCacheHeaders(this.c, cms, [], { max: 60 });
                return;
            }
            const settings = await cms.settings.all();
            const links = await languageLinks(cms, resolved);
            this.languages = links;
            this.site = await siteInfo(cms, resolved.locale, { url: this.c.req.url, page: resolved });
            const usage = { user: false };
            const viewOptions = {
                comment: commentResult(this.c.req.query('comment')), ...this.readerOptions(),
                forms: { query: this.c.req.query(), principal: this.c.get('principal'), url: base }, usage,
            };
            /** The entry the page shows, which its editor may edit in place: an entry, or the static front page. */
            let shown: { collection: string; record: RecordShape } | null = null;
            // Templates read the theme's options with their bindings resolved, as the layout does.
            // A locked entry binds as its readers see it unless this reader may read it; the password never binds.
            const bound = resolved.kind === 'entry' ? await bindableEntry(cms, resolved.collection.name, resolved.record, this.c.get('principal'), getCookie(this.c, unlockCookie(resolved.record))) : null;
            this.theme = { ...this.theme, options: resolvedOptions(this.theme.options, bindingScopes(settings, { entry: bound, user: viewOptions.user })) };
            if (resolved.kind === 'home') {
                const home = await homeView(cms, resolved.locale, page, viewOptions);
                if (home.page && home.record) {
                    this.kind = 'entry';
                    this.entry = home.page;
                    shown = { collection: 'pages', record: home.record };
                    this.seo = await entrySeo(cms, this.c, cms.collection('pages'), home.record, { ...home.page, url: base }, links);
                } else {
                    this.kind = 'home';
                    this.view = { ...this.view, kind: 'home', ...home.view };
                    this.seo = await homeSeo(cms, this.c, { url: base, locale: resolved.locale, links, page });
                }
            } else if (resolved.kind === 'search') {
                const query = (this.c.req.query('q') ?? '').trim().slice(0, 200);
                this.kind = 'list';
                const found = query ? await searchEntries(cms, query, { locale: resolved.locale, page, base: searchBase(base, query) }) : { entries: [], paging: { page: 1, pages: 1, base }, loose: false };
                this.view = { ...this.view, kind: 'search', collection: null, query, title: query ? `${__('Results for')} “${query}”` : __('Search'), ...found };
                this.seo = await listSeo(cms, this.c, { kind: 'search', title: this.view.title, description: '', url: base, locale: resolved.locale, links, noindex: true });
            } else if (resolved.kind === 'entry' && resolved.collection.name === 'pages' && resolved.record.id === settings['reading.pageForPosts']) {
                // Settings → Reading's posts page lists the latest posts under its own title.
                this.kind = 'list';
                this.view = { ...this.view, title: String(resolved.record.title ?? ''), collection: 'posts', ...await archive(cms, cms.collection('posts'), page, { base, locale: resolved.locale }) };
                const posts = cms.collection('posts');
                this.seo = await listSeo(cms, this.c, { kind: 'archive', collection: posts, title: this.view.title, description: '', url: base, locale: resolved.locale, links, page, noindex: posts.robots?.archiveNoindex, nofollow: posts.robots?.nofollow });
            } else if (resolved.kind === 'entry') {
                this.kind = 'entry';
                shown = { collection: resolved.collection.name, record: resolved.record };
                // Editors read their protected and members-only entries; visitors unlock protected ones with the password, which a cookie remembers.
                const reader = this.c.get('principal');
                const editor = reader.kind === 'user' && cms.resource(`cms/${resolved.collection.name}`).canUpdate(resolved.record, reader);
                const unlocked = isProtected(resolved.record) && getCookie(this.c, unlockCookie(resolved.record)) === await unlockToken(resolved.record);
                const only = new Set([resolved.record.id]);
                this.locked = entryLock(resolved.record, { unlocked: unlocked ? only : undefined, signedIn: reader.kind === 'user', roles: viewOptions.roles, editor });
                this.wrongPassword = this.c.req.query('password') === 'wrong';
                if (this.locked === 'members') this.registration = await cms.settings.get('general.usersCanRegister');
                // The page depends on the password cookie or the session, which shared caches ignore: never stored, locked or unlocked.
                if (isProtected(resolved.record) || isMembersOnly(resolved.record)) this.c.header('cache-control', 'private, no-store');
                this.entry = (await entryViews(cms, resolved.collection, [resolved.record], { ...viewOptions, full: true, ...(unlocked ? { unlocked: only } : {}), ...(editor ? { editable: only } : {}) }))[0]!;
                this.seo = await entrySeo(cms, this.c, resolved.collection, resolved.record, this.entry, links);
            } else if (resolved.kind === 'archive') {
                this.kind = 'list';
                this.view = { ...this.view, title: resolved.collection.label, description: resolved.collection.description ?? '', collection: resolved.collection.name, ...await archive(cms, resolved.collection, page, { base, locale: resolved.locale }) };
                this.seo = await listSeo(cms, this.c, { kind: 'archive', collection: resolved.collection, title: this.view.title, description: this.view.description, url: base, locale: resolved.locale, links, page, noindex: resolved.collection.robots?.archiveNoindex, nofollow: resolved.collection.robots?.nofollow });
            } else if (resolved.kind === 'term') {
                const taxonomy = cms.taxonomies.declaration(resolved.term.taxonomy);
                this.kind = 'list';
                this.view = { ...this.view, kind: 'term', title: `${taxonomy.singular}: ${resolved.term.name}`, description: resolved.term.description, ...await termArchive(cms, resolved.term, page, base, resolved.locale) };
                this.seo = await listSeo(cms, this.c, { kind: 'term', term: resolved.term, taxonomy: taxonomy.label, title: this.view.title, description: this.view.description, url: base, locale: resolved.locale, links, page, noindex: taxonomy.noindex });
            } else if (resolved.kind === 'author') {
                const author = authorView(resolved.user, localePrefix(await cms.languages(), resolved.locale));
                this.kind = 'list';
                this.view = { ...this.view, kind: 'author', author, taxonomy: null, title: author.name, description: author.bio, ...await authorArchive(cms, resolved.user, page, base, resolved.locale) };
                this.seo = await authorSeo(cms, this.c, { user: resolved.user, url: base, locale: resolved.locale, links, page });
            }
            if (this.kind === 'entry' && this.entry) await this.refreshMenus();
            const principal = this.c.get('principal');
            if (shown && principal.kind === 'user') {
                this.editable = await siteEditable(cms, shown.collection, shown.record.id, principal);
                // An editor's page may hold their draft: never cache it.
                if (this.editable) this.c.header('cache-control', 'private, no-store');
                if (this.editable && this.c.req.query('edit') !== undefined) await this.startEditing();
            }
            // A list page has no entry to edit, but its header and footer are the theme's areas: editable in place by whoever may change them.
            this.frameEditable = !shown && (this.kind === 'home' || this.kind === 'list') && principal.kind === 'user' && hasPermission(principal, PERMISSIONS.manageAppearance);
            if (this.frameEditable) {
                this.c.header('cache-control', 'private, no-store');
                if (this.c.req.query('edit') !== undefined) await this.startEditing();
            }
            // The site taskbar shows the page's SEO and, for an entry the user may edit, its status and editor.
            this.c.set('cms.taskbar', { seo: this.seo, frame: this.frameEditable, entry: this.editable && shown
                ? { collection: this.editable.collection, id: this.editable.id, status: String(shown.record.status ?? ''), dashboard: this.editable.dashboard, inPlace: true } : null });
            // A binding to the signed-in user makes the page theirs alone.
            if (usage.user && viewOptions.user) this.c.header('cache-control', 'private, no-store');
            if (this.kind === 'entry' && this.entry) this.data = await themeData(cms, this.theme, { kind: 'entry', collection: this.entry.collection, template: this.entry.template }, this.entry, principal, resolved.locale);
            else if (this.kind === 'home' || this.kind === 'list') this.data = await themeData(cms, this.theme, this.view, this.view, principal, resolved.locale);
            await applyCacheHeaders(this.c, cms, this.cacheTags(cms, resolved, shown));
        } catch (error) {
            if (!isCmsError(error, 'CMS_UNAVAILABLE')) throw error;
            this.kind = 'unavailable';
            this.c.status(503);
        }
    }

    /**
     * What the page shows, for its `Cache-Tag` header: the entry, the collections it lists (lists
     * and feeds of a collection, the Latest entries blocks of the entry and of the theme's areas,
     * which the layout noted) and the term, so a change purges the pages that showed it.
     */
    private cacheTags(cms: CmsHost, resolved: Resolved, shown: { collection: string; record: RecordShape } | null): string[] {
        const { tag } = cms.purge;
        const tags = [...(this.c.get('cms.cacheTags') ?? [])];
        const listed = (collections: Iterable<string>) => { for (const name of collections) tags.push(tag.collection(name)); };
        if (shown) tags.push(tag.entry(shown.collection, shown.record.id), tag.collection(shown.collection));
        if (this.entry) listed(listedCollections(this.entry.content));
        if (resolved.kind === 'home' || resolved.kind === 'search' || resolved.kind === 'author') listed(cms.collections().filter(collection => typeof collection.path === 'string').map(collection => collection.name));
        if (resolved.kind === 'archive') listed([resolved.collection.name]);
        if (this.kind === 'list' && this.view.collection) listed([this.view.collection]);
        if (resolved.kind === 'term') {
            tags.push(tag.term(resolved.term.taxonomy, resolved.term.slug));
            listed(cms.taxonomies.usage(resolved.term.taxonomy).map(usage => usage.resource).filter(resource => resource.startsWith('cms/')).map(resource => resource.slice(4)));
        }
        return tags;
    }

    /** A visitor's password for a protected entry: right, and a cookie remembers it; wrong, and the form says so. */
    async post() {
        if (!isSameOriginPost(this.c.req.raw)) return this.c.text('Forbidden', 403);
        const resolved = this.c.get('cms.site');
        if (!resolved || resolved.kind !== 'entry' || !isProtected(resolved.record)) return this.c.text('Not found', 404);
        const form = await this.c.req.formData();
        const typed = String(form.get('password') ?? '');
        const url = this.c.req.path;
        if (typed !== String(resolved.record.password)) return this.redirect(`${url}?password=wrong#password`);
        const secure = new URL(this.c.req.url).protocol === 'https:' ? '; Secure' : '';
        // Path=/: the comments form posts to /api/cms/comments, which checks the same unlock.
        this.c.header('set-cookie', `${unlockCookie(resolved.record)}=${await unlockToken(resolved.record)}; Path=/; Max-Age=${10 * 24 * 3600}; HttpOnly; SameSite=Lax${secure}`, { append: true });
        return this.redirect(url);
    }

    /** What a members-only entry shows a visitor who is not signed in: the theme's prompt, or a plain one. */
    private membersPrompt(theme: ReturnType<typeof siteTheme>, helpers: ReturnType<typeof themeHelpers>) {
        const entry = this.entry!;
        const back = encodeURIComponent(this.c.req.path);
        const signedIn = this.c.get('principal').kind === 'user';
        const view = { entry, signedIn, signIn: `/auth/login?redirect=${back}`, register: this.registration && !signedIn ? `/auth/register?redirect=${back}` : null };
        return theme.members?.(view, helpers) ?? html`<article class="space-y-6" data-members-only>
            <header><h1 class="text-4xl font-bold tracking-tight text-foreground">${entry.title}</h1></header>
            <div class="max-w-sm space-y-3">
                ${signedIn ? html`<p class="text-sm text-muted-foreground">${__('This content is for members with another kind of account than yours.')}</p>` : html`
                <p class="text-sm text-muted-foreground">${__('This content is for members. Sign in to read it.')}</p>
                <p class="flex flex-wrap items-center gap-3">
                    <a href=${view.signIn} class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground no-underline">${__('Sign in')}</a>
                    ${view.register ? html`<a href=${view.register} class="text-sm text-primary hover:underline">${__('Create an account')}</a>` : null}
                </p>`}
            </div>
        </article>`;
    }

    /** The password form of a protected entry: the theme's, or a plain one. */
    private passwordForm(theme: ReturnType<typeof siteTheme>, helpers: ReturnType<typeof themeHelpers>) {
        const entry = this.entry!;
        const view = { entry, action: this.c.req.path, error: this.wrongPassword };
        return theme.password?.(view, helpers) ?? html`<article class="space-y-6" data-protected>
            <header><h1 class="text-4xl font-bold tracking-tight text-foreground">${entry.title}</h1></header>
            <form id="password" method="post" action=${view.action} class="max-w-sm space-y-3">
                <p class="text-sm text-muted-foreground">${__('This content is password protected. To view it, enter the password below.')}</p>
                ${view.error ? html`<p role="alert" class="text-sm text-destructive">${__('That password is not right. Try again.')}</p>` : null}
                <label for="entry-password" class="block text-sm font-medium text-foreground">${__('Password')}</label>
                <input id="entry-password" name="password" type="password" required autocomplete="off" class="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring">
                <button type="submit" class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground border-none cursor-pointer">${__('Enter')}</button>
            </form>
        </article>`;
    }

    // --- Editing on the site ------------------------------------------------------------------

    /** Enter edit mode: a draft of the saved entry, rendered like a preview. */
    @Server()
    async startEditing() {
        // The entry this address shows, never the one the client's state names.
        await this.openDraft(await this.routeEntry());
    }

    /**
     * Start again from the saved entry being edited, after a conflict: the draft's own entry, since
     * a save elsewhere may have moved it to another address. Its editor's rights are checked again.
     */
    @Server()
    async restartEditing() {
        const draft = this.draft;
        await this.openDraft(draft?.collection && draft.id ? { collection: draft.collection, id: draft.id } : await this.routeEntry());
    }

    private async openDraft(shown: { collection: string; id: string } | null) {
        const cms = this.c.get('cms');
        const found = shown ? await editableRecord(cms, shown.collection, shown.id, this.c.get('principal')) : null;
        if (!found) {
            // A list page: the frame alone, for a user who may change the theme's areas.
            const frame = this.frameEditable ? await frameDraft(cms, this.c.get('principal')) : null;
            this.editable = null;
            this.draft = frame;
            if (frame) this.c.set('cms.editing', editingContext(frame.documents));
            return;
        }
        this.editable = { collection: found.collection.name, id: found.record.id, dashboard: `/dashboard/content/${found.collection.name}/${found.record.id}` };
        this.draft = await siteDraft(cms, found.collection, found.record, this.c.get('principal'));
        // The layout renders the areas with their markers from the first paint (`server$` in the layout reads this at render time).
        this.c.set('cms.editing', editingContext(this.draft.documents));
        this.entry = await draftEntry(cms, found.collection, found.record, this.draft.values, this.formRequest());
        await this.refreshMenus();
    }

    /**
     * The entry the page's address shows, as `init` finds it: an entry (not the posts page) or the
     * static front page. The other editing methods act on the draft this one started, and check
     * again that the user may edit its entry.
     */
    private async routeEntry(): Promise<{ collection: string; id: string } | null> {
        const cms = this.c.get('cms');
        const resolved = await resolvePath(cms, segmentsOf(this.c.req.param('path'))).catch(() => null);
        if (resolved?.kind === 'entry') {
            if (resolved.collection.name === 'pages' && resolved.record.id === await cms.settings.get('reading.pageForPosts').catch(() => null)) return null;
            return { collection: resolved.collection.name, id: resolved.record.id };
        }
        if (resolved?.kind === 'home') {
            const home = await homeView(cms, resolved.locale, 1);
            return home.record ? { collection: 'pages', id: home.record.id } : null;
        }
        return null;
    }

    /** Render the page from the draft's values. Invalid values keep the last rendering and show why. */
    @Server({ input: input.args(input.record()) })
    async previewDraft(values: EditorValues) {
        const cms = this.c.get('cms');
        const draft = this.draft;
        const found = draft ? await editableRecord(cms, draft.collection, draft.id, this.c.get('principal')) : null;
        if (!draft || !found) { this.draft = null; return; }
        try {
            this.entry = await draftEntry(cms, found.collection, found.record, values, this.formRequest(), draft.documents, await draftBlockOptions(cms, draft, this.c.get('principal')));
            await this.refreshMenus();
            this.draft = { ...draft, values, changed: true, error: '', errors: {} };
        } catch (error) {
            if (!isCmsError(error)) throw error;
            this.draft = { ...draft, values, changed: true, error: error.message, errors: fieldErrors(error) };
        }
    }

    /** Save the draft over the revision it started from; a newer save is a conflict to reload. */
    @Server()
    async saveDraft(values: EditorValues) {
        const cms = this.c.get('cms');
        const principal = this.c.get('principal');
        const draft = this.draft;
        if (draft && !draft.collection) {
            // The frame alone: the documents are everything there is to save.
            this.draft = { ...draft, documents: await saveDocuments(cms, draft.documents, await draftBlockOptions(cms, draft, principal), principal) };
            return;
        }
        const found = draft ? await editableRecord(cms, draft.collection, draft.id, principal) : null;
        if (!draft || !found) { this.draft = null; return; }
        // The areas save on their own, each over its revision; a conflict stays on its document and the others still save.
        const documents = await saveDocuments(cms, draft.documents, await draftBlockOptions(cms, draft, principal), principal);
        if (!draft.changed) { this.draft = { ...draft, documents }; return; }
        try {
            const record = await saveDraft(cms, draft, values, principal);
            this.draft = { ...await siteDraft(cms, found.collection, record, principal), chooser: draft.chooser, documents };
            this.entry = await draftEntry(cms, found.collection, record, this.draft.values, this.formRequest());
            await this.refreshMenus();
        } catch (error) {
            if (!isCmsError(error)) throw error;
            this.draft = { ...draft, values, documents, conflict: error.code === 'CMS_CONFLICT', error: error.message, errors: fieldErrors(error) };
        }
    }

    /** Leave edit mode: the page shows the saved entry again. */
    @Server()
    async stopEditing() {
        const cms = this.c.get('cms');
        const draft = this.draft;
        this.draft = null;
        const found = draft ? await editableRecord(cms, draft.collection, draft.id, this.c.get('principal')) : null;
        // As init shows it to this reader: an editor reads the protected or members-only entry, and user bindings resolve.
        if (found) this.entry = (await entryViews(cms, found.collection, [found.record], { ...this.readerOptions(), full: true, forms: this.formRequest(), editable: new Set([found.record.id]) }))[0]!;
    }

    /** Who reads the page, for entry views: signed in means the principal is a user (a session still owing its second factor is a visitor here). */
    private readerOptions(): { user: { name: string } | null; roles: readonly string[] } {
        const reader = this.c.get('principal');
        return { user: reader.kind === 'user' && this.user ? { name: this.user.name } : null, roles: reader.kind === 'user' ? reader.roles : [] };
    }

    /** What the entry's forms need in edit mode, whose server methods run under /crpc: the editor and the entry's page. */
    private formRequest() {
        return { query: {}, principal: this.c.get('principal'), url: this.entry?.url ?? '/' };
    }

    /** The menus the entry's own Navigation blocks show; nothing when it has none. */
    private async refreshMenus() {
        this.menus = this.entry ? await contentMenus(this.c.get('cms'), this.theme, this.entry.content, { locale: this.entry.locale, user: this.c.get('principal').kind === 'user' && this.user ? { name: this.user.name } : null, forms: this.formRequest() }) : {};
    }

    /** The media library, for the editor of this entry only. */
    @Server({ input: input.args(input.string({ maxLength: 2000 })) })
    async searchDraftMedia(search: string) {
        const cms = this.c.get('cms');
        const draft = this.draft;
        if (!draft) return;
        const items = await draftMedia(cms, draft, search, this.c.get('principal'), draft.chooser.kind);
        if (items) this.draft = { ...draft, chooser: { ...draft.chooser, search, items } };
    }

    /** A document's blocks changed: keep them, let the layout preview the areas, and render the entry again for a pattern it shows. */
    @Client()
    changeDocument(key: string, blocks: EditorBlock[]) {
        if (!this.draft) return;
        this.draft = { ...this.draft, documents: this.draft.documents.map(document => document.key === key ? { ...document, blocks, changed: true, error: '' } : document) };
        this.shareDocuments();
        // A pattern the entry shows: render the entry again from its draft. The frame alone has no entry to render.
        if (key.startsWith('pattern:') && this.draft.collection) void this.changeDraft(this.draft.values, true);
    }

    /** The areas' and patterns' drafts, for the layout to preview them; null ends the session and shows the saved frame again. */
    @Client()
    private shareDocuments() {
        const documents = this.draft?.documents ?? [];
        siteSession.set(this.draft ? {
            areas: documents.filter(document => document.kind === 'area').map(document => ({ name: document.name, blocks: document.blocks })),
            patterns: documents.filter(document => document.kind === 'pattern').map(document => ({ id: document.name, blocks: document.blocks })),
        } : null);
    }

    /** Start again from the saved entry and areas, after a conflict. */
    @Client()
    async reloadDraft() {
        await this.restartEditing();
        this.shareDocuments();
    }

    /** Leave edit mode, and drop `?edit` from the address so a reload shows the page, not the editor. */
    @Client()
    async exitEditing() {
        siteSession.set(null);
        const url = new URL(window.location.href);
        if (url.searchParams.has('edit')) { url.searchParams.delete('edit'); window.history.replaceState(window.history.state, '', url); }
        await this.stopEditing();
    }

    /** Load the editor's code once edit mode shows. */
    @Client()
    async loadEditor(element: Element | undefined) {
        if (!element || SiteEditor) { this.editorReady = Boolean(SiteEditor); return; }
        SiteEditor = (await import('../../../cms/site-editor.client')).SiteEditor;
        this.editorReady = true;
    }

    /** Values waiting to be previewed while a preview runs; only the latest is rendered. */
    private previewPending: EditorValues | null = null;
    private previewing = false;

    /**
     * Keep new values and, for a preview, render the page from them. Previews run one at a
     * time so a slow earlier one cannot land after a later one and show a stale page; values
     * changed meanwhile are previewed next and win over the ones the server echoes back.
     */
    @Client()
    async changeDraft(values: EditorValues, preview: boolean) {
        if (!this.draft) return;
        this.draft = { ...this.draft, values, changed: true };
        if (!preview) return;
        this.previewPending = values;
        if (this.previewing) return;
        this.previewing = true;
        try {
            while (this.previewPending && this.draft) {
                const next = this.previewPending;
                this.previewPending = null;
                await this.previewDraft(next);
                if (this.previewPending && this.draft) this.draft = { ...this.draft, values: this.previewPending };
            }
        } finally { this.previewing = false; }
    }

    @Client()
    async save() {
        if (!this.draft) return;
        this.saving = true;
        try { await this.saveDraft(this.draft.values); }
        finally { this.saving = false; }
        this.shareDocuments();
    }

    @Client()
    setChooser(chooser: MediaChooserState) {
        if (this.draft) this.draft = { ...this.draft, chooser };
    }

    @Client()
    setPreviews(previews: Record<string, MediaPreview>) {
        if (this.draft) this.draft = { ...this.draft, previews };
    }

    @Client()
    setNotes(notes: Note[]) {
        if (this.draft) this.draft = { ...this.draft, notes };
    }

    /** Edit mode: the editor, once its code is loaded. `data-site-editing` hides the site taskbar meanwhile. */
    private editor() {
        const draft = this.draft;
        if (!draft) return null;
        return html`<div data-site-editing ref=${(element: Element) => this.loadEditor(element)}>${this.editorReady && SiteEditor ? component(SiteEditor, {
            draft, saving: this.saving,
            onChange: (values: EditorValues, preview: boolean) => this.changeDraft(values, preview),
            onSave: () => this.save(), onExit: () => this.exitEditing(), onReload: () => this.reloadDraft(),
            onSearchMedia: (search: string) => this.searchDraftMedia(search),
            onChooser: (chooser: MediaChooserState) => this.setChooser(chooser),
            onPreviews: (previews: Record<string, MediaPreview>) => this.setPreviews(previews),
            onNotes: (notes: Note[]) => this.setNotes(notes),
            onDocumentChange: (key: string, blocks: EditorBlock[]) => this.changeDocument(key, blocks),
        }) : html`<p role="status" class="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-full border border-border bg-background px-4 py-2 text-sm text-muted-foreground shadow-lg">${__('Loading the editor…')}</p>`}</div>`;
    }

    render() {
        if (this.kind === 'unavailable') return unavailable();
        const theme = siteTheme(this.theme);
        const helpers = themeHelpers(theme, { ...this.theme, data: { page: this.data }, editing: Boolean(this.draft), languages: this.languages, menus: this.menus, site: this.site ?? undefined }, (path, exact) => this.isActive(path, exact));
        if (this.kind === 'entry' && this.entry && this.locked) return siteContent(this.locked === 'members' ? this.membersPrompt(theme, helpers) : this.passwordForm(theme, helpers), this.theme);
        if (this.kind === 'entry' && this.entry) {
            // In edit mode the content's blocks carry their document: the entry's own, or a pattern's, locked when the user may not change it.
            const entry = this.draft ? { ...this.entry, content: tagDocument(this.entry.content, 'entry', false, new Map(this.draft.documents.filter(document => document.kind === 'pattern').map(document => [document.name, !document.editable]))) } : this.entry;
            const page = siteContent(entryTemplate(theme, entry.collection, entry.template)(entry, helpers), this.theme);
            // The editor sits outside the content root, which contains fixed elements; the taskbar is the layout's.
            return this.draft ? html`${page}${this.editor()}` : page;
        }
        if (this.kind === 'home' || this.kind === 'list') {
            const page = siteContent(archiveTemplate(theme, this.view)(this.view, helpers), this.theme);
            return this.draft ? html`${page}${this.editor()}` : page;
        }
        if (this.kind === 'gone') return html`<section class="space-y-3 py-16 text-center">
            <h1 class="text-3xl font-bold text-foreground">${__('Page removed')}</h1>
            <p class="text-muted-foreground">${__('This page was removed and is not coming back.')}</p>
            <a href="/" class="text-primary hover:underline">${__('Go to the home page')}</a>
        </section>`;
        return theme.notFound?.(helpers) ?? html`<section class="space-y-3 py-16 text-center">
            <h1 class="text-3xl font-bold text-foreground">${__('Page not found')}</h1>
            <p class="text-muted-foreground">${__('The page you are looking for does not exist.')}</p>
            <a href="/" class="text-primary hover:underline">${__('Go to the home page')}</a>
        </section>`;
    }
}
