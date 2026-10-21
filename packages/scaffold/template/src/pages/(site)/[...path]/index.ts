import { Client, ClientState, Cossack, Page, Server, State, defineServerMiddleware, type HeadValue } from '@cossackframework/core';
import { isTransportPath } from '@cossackframework/core/transport-routes';
import { component, html } from '@cossackframework/renderer';
import { isCmsError, type ArchiveView, type EntryView, type ThemeData } from '@cossackframework/cms';
import { archive, commentResult, entryViews, homeView, languageLinks, pageNumber, redirectFor, resolvePath, searchEntries, termArchive, themeData, themeState, type Resolved, type ThemeState } from '../../../cms/site';
import { archiveTemplate, entryTemplate, siteContent, siteTheme, themeHelpers, unavailable } from '../../../cms/site-view';
import { entrySeo, homeSeo, listSeo } from '../../../cms/seo';
import { emptySeo, seoHead, type SeoView } from '../../../cms/seo-head';
import { editBar, type SiteDraft, type SiteEditable } from '../../../cms/site-editor';
import { draftEntry, draftMedia, editableRecord, saveDraft, siteDraft, siteEditable } from '../../../cms/site-editing';
import { fieldErrors } from '../../../cms/content';
import type { EditorValues } from '../../../cms/editor';
import type { MediaPreview } from '../../../cms/field-controls';
import type { MediaChooserState } from '../../../cms/media-chooser';

/** The site editor, loaded the first time an editor enters edit mode; visitors never load it. */
let SiteEditor: typeof import('../../../cms/site-editor.client').SiteEditor | undefined;

const segmentsOf = (path: string | undefined) => (path ?? '').split('/').filter(Boolean);

/**
 * Resolve the path before rendering, so entries can redirect to their canonical URL and
 * missing paths can follow redirects. A root catch-all's middleware also sees requests for
 * routes registered after it, such as /crpc, so it acts only on page reads.
 */
const resolveSitePath = defineServerMiddleware(async (c, next) => {
    if ((c.req.method !== 'GET' && c.req.method !== 'HEAD') || isTransportPath(c.req.path)) { await next(); return; }
    // Unknown API paths keep their JSON 404.
    if (c.req.path === '/api' || c.req.path.startsWith('/api/')) return c.json({ error: 'Not Found', code: 'COSSACK_NOT_FOUND' }, 404);
    const cms = c.get('cms');
    let resolved: Resolved | { kind: 'unavailable' } = { kind: 'none', locale: 'en' };
    // Before setup, or while a migration is pending, content is unavailable.
    try {
        resolved = await resolvePath(cms, segmentsOf(c.req.param('path')));
        if (resolved.kind === 'none') {
            const query = new URL(c.req.url).search.slice(1);
            resolved = await redirectFor(cms, c.req.path, query, work => { try { c.executionCtx.waitUntil(work.catch(() => undefined)); } catch { void work.catch(() => undefined); } }) ?? resolved;
        }
    } catch (error) { if (!isCmsError(error, 'CMS_UNAVAILABLE')) throw error; resolved = { kind: 'unavailable' }; }
    if (resolved.kind === 'redirect') return c.redirect(resolved.url, resolved.status ?? 301);
    c.set('cms.site', resolved);
    await next();
});

/**
 * Every site URL without its own route: collection archives (/posts), entries
 * (/posts/hello-world, /shop/rocket-skates), term archives (/category/news), nested pages
 * (/about/team) and other languages' pages (/fr, /fr/a-propos), drawn by the active theme.
 * Missing paths follow Tools → Redirects; anything else is a 404.
 */
@Page({ transport: 'http', middlewares: [resolveSitePath] })
export default class SitePath extends Cossack {
    @State() kind: 'entry' | 'list' | 'home' | 'none' | 'gone' | 'unavailable' = 'none';
    @State() entry: EntryView | null = null;
    @State() view: ArchiveView = { kind: 'archive', collection: null, taxonomy: null, title: '', description: '', entries: [], paging: { page: 1, pages: 1, base: '/' }, query: '' };
    @State() theme: ThemeState = { name: null, options: {} };
    /** What the theme's loader for the page returned. */
    @State() data: ThemeData = {};
    @State() seo: SeoView = emptySeo();
    /** For a signed-in user who may update the entry: the bar's links. Null for visitors. */
    @State() editable: SiteEditable | null = null;
    /** Edit mode: the entry's draft. `?edit` opens it. */
    @State() draft: SiteDraft | null = null;
    @ClientState() editorReady = false;
    @ClientState() saving = false;

    head(): HeadValue {
        if (this.seo.title) return seoHead(this.seo);
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
            if (resolved.kind === 'gone') { this.kind = 'gone'; this.c.status(410); return; }
            if (resolved.kind === 'none' || resolved.kind === 'redirect') {
                this.c.status(404);
                this.data = await themeData(cms, this.theme, { kind: 'not-found' }, this.view, this.c.get('principal'), resolved.kind === 'none' ? resolved.locale : undefined);
                return;
            }
            const settings = await cms.settings.all();
            const links = await languageLinks(cms, resolved);
            const viewOptions = { comment: commentResult(this.c.req.query('comment')), user: this.user ? { name: this.user.name } : null };
            if (resolved.kind === 'home') {
                const home = await homeView(cms, resolved.locale, page, viewOptions);
                if (home.page && home.record) {
                    this.kind = 'entry';
                    this.entry = home.page;
                    this.seo = await entrySeo(cms, this.c, cms.collection('pages'), home.record, { ...home.page, url: base }, links);
                } else {
                    this.kind = 'home';
                    this.view = { ...this.view, kind: 'home', ...home.view };
                    this.seo = await homeSeo(cms, this.c, { url: base, locale: resolved.locale, links, searchUrl: `${base}/search` });
                }
            } else if (resolved.kind === 'search') {
                const query = (this.c.req.query('q') ?? '').trim().slice(0, 200);
                this.kind = 'list';
                this.view = { ...this.view, kind: 'search', collection: null, query, title: query ? `${__('Results for')} “${query}”` : __('Search'), entries: query ? await searchEntries(cms, query, resolved.locale) : [] };
                this.seo = await listSeo(cms, this.c, { title: this.view.title, description: '', url: base, locale: resolved.locale, links, noindex: true });
            } else if (resolved.kind === 'entry' && resolved.collection.name === 'pages' && resolved.record.id === settings['reading.pageForPosts']) {
                // Settings → Reading's posts page lists the latest posts under its own title.
                this.kind = 'list';
                this.view = { ...this.view, title: String(resolved.record.title ?? ''), collection: 'posts', ...await archive(cms, cms.collection('posts'), page, { base, locale: resolved.locale }) };
                this.seo = await listSeo(cms, this.c, { title: this.view.title, description: '', url: base, locale: resolved.locale, links });
            } else if (resolved.kind === 'entry') {
                this.kind = 'entry';
                this.entry = (await entryViews(cms, resolved.collection, [resolved.record], { ...viewOptions, full: true }))[0]!;
                this.seo = await entrySeo(cms, this.c, resolved.collection, resolved.record, this.entry, links);
            } else if (resolved.kind === 'archive') {
                this.kind = 'list';
                this.view = { ...this.view, title: resolved.collection.label, description: resolved.collection.description ?? '', collection: resolved.collection.name, ...await archive(cms, resolved.collection, page, { base, locale: resolved.locale }) };
                this.seo = await listSeo(cms, this.c, { title: this.view.title, description: this.view.description, url: base, locale: resolved.locale, links });
            } else if (resolved.kind === 'term') {
                const taxonomy = cms.taxonomies.declaration(resolved.term.taxonomy);
                this.kind = 'list';
                this.view = { ...this.view, kind: 'term', title: `${taxonomy.singular}: ${resolved.term.name}`, description: resolved.term.description, ...await termArchive(cms, resolved.term, page, base, resolved.locale) };
                this.seo = await listSeo(cms, this.c, { title: this.view.title, description: this.view.description, url: base, locale: resolved.locale, links });
            }
            const principal = this.c.get('principal');
            if (resolved.kind === 'entry' && this.kind === 'entry' && principal.kind === 'user') {
                this.editable = await siteEditable(cms, resolved.collection.name, resolved.record.id, principal);
                // An editor's page shows their bar, and in edit mode their draft: never cache it.
                if (this.editable) this.c.header('cache-control', 'private, no-store');
                if (this.editable && this.c.req.query('edit') !== undefined) await this.startEditing();
            }
            if (this.kind === 'entry' && this.entry) this.data = await themeData(cms, this.theme, { kind: 'entry', collection: this.entry.collection, template: this.entry.template }, this.entry, principal, resolved.locale);
            else if (this.kind === 'home' || this.kind === 'list') this.data = await themeData(cms, this.theme, this.view, this.view, principal, resolved.locale);
        } catch (error) {
            if (!isCmsError(error, 'CMS_UNAVAILABLE')) throw error;
            this.kind = 'unavailable';
            this.c.status(503);
        }
    }

    // --- Editing on the site ------------------------------------------------------------------

    /** Enter edit mode: a draft of the saved entry, rendered like a preview. */
    @Server()
    async startEditing() {
        const cms = this.c.get('cms');
        const editable = this.editable;
        const found = editable ? await editableRecord(cms, editable.collection, editable.id, this.c.get('principal')) : null;
        if (!found) { this.editable = null; this.draft = null; return; }
        this.draft = await siteDraft(cms, found.collection, found.record, this.c.get('principal'));
        this.entry = await draftEntry(cms, found.collection, found.record, this.draft.values);
    }

    /** Render the page from the draft's values. Invalid values keep the last rendering and show why. */
    @Server()
    async previewDraft(values: EditorValues) {
        const cms = this.c.get('cms');
        const draft = this.draft;
        const found = draft ? await editableRecord(cms, draft.collection, draft.id, this.c.get('principal')) : null;
        if (!draft || !found) { this.draft = null; return; }
        try {
            this.entry = await draftEntry(cms, found.collection, found.record, values);
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
        const found = draft ? await editableRecord(cms, draft.collection, draft.id, principal) : null;
        if (!draft || !found) { this.draft = null; return; }
        try {
            const record = await saveDraft(cms, draft, values, principal);
            this.draft = { ...await siteDraft(cms, found.collection, record, principal), chooser: draft.chooser };
            this.entry = await draftEntry(cms, found.collection, record, this.draft.values);
        } catch (error) {
            if (!isCmsError(error)) throw error;
            this.draft = { ...draft, values, conflict: error.code === 'CMS_CONFLICT', error: error.message, errors: fieldErrors(error) };
        }
    }

    /** Leave edit mode: the page shows the saved entry again. */
    @Server()
    async stopEditing() {
        const cms = this.c.get('cms');
        const draft = this.draft;
        this.draft = null;
        const found = draft ? await editableRecord(cms, draft.collection, draft.id, this.c.get('principal')) : null;
        if (found) this.entry = (await entryViews(cms, found.collection, [found.record], { full: true }))[0]!;
    }

    /** The media library, for the editor of this entry only. */
    @Server()
    async searchDraftMedia(search: string) {
        const cms = this.c.get('cms');
        const draft = this.draft;
        if (!draft || !await editableRecord(cms, draft.collection, draft.id, this.c.get('principal'))) return;
        this.draft = { ...draft, chooser: { ...draft.chooser, search, items: await draftMedia(cms, search, this.c.get('principal')) } };
    }

    @Client()
    async edit() {
        await this.startEditing();
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
    }

    @Client()
    setChooser(chooser: MediaChooserState) {
        if (this.draft) this.draft = { ...this.draft, chooser };
    }

    @Client()
    setPreviews(previews: Record<string, MediaPreview>) {
        if (this.draft) this.draft = { ...this.draft, previews };
    }

    private editor() {
        const draft = this.draft;
        if (!draft) return this.editable ? editBar(this.editable, () => this.edit()) : null;
        return html`<div ref=${(element: Element) => this.loadEditor(element)}>${this.editorReady && SiteEditor ? component(SiteEditor, {
            draft, saving: this.saving,
            onChange: (values: EditorValues, preview: boolean) => this.changeDraft(values, preview),
            onSave: () => this.save(), onExit: () => this.stopEditing(), onReload: () => this.startEditing(),
            onSearchMedia: (search: string) => this.searchDraftMedia(search),
            onChooser: (chooser: MediaChooserState) => this.setChooser(chooser),
            onPreviews: (previews: Record<string, MediaPreview>) => this.setPreviews(previews),
        }) : html`<p role="status" class="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-full border border-border bg-background px-4 py-2 text-sm text-muted-foreground shadow-lg">${__('Loading the editor…')}</p>`}</div>`;
    }

    render() {
        if (this.kind === 'unavailable') return unavailable();
        const theme = siteTheme(this.theme);
        const helpers = themeHelpers(theme, { ...this.theme, data: { page: this.data }, editing: Boolean(this.draft) }, (path, exact) => this.isActive(path, exact));
        if (this.kind === 'entry' && this.entry) {
            const page = siteContent(entryTemplate(theme, this.entry.collection, this.entry.template)(this.entry, helpers));
            // Visitors get the theme's page alone. The editor sits outside the content root, which contains fixed elements.
            return this.editable || this.draft ? html`${page}${this.editor()}` : page;
        }
        if (this.kind === 'home' || this.kind === 'list') return siteContent(archiveTemplate(theme, this.view)(this.view, helpers));
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
