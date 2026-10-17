import { Cossack, Page, State, defineServerMiddleware, type HeadValue } from '@cossackframework/core';
import { isTransportPath } from '@cossackframework/core/transport-routes';
import { html } from '@cossackframework/renderer';
import { isCmsError, type ArchiveView, type EntryView } from '@cossackframework/cms';
import { archive, commentResult, entryViews, homeView, languageLinks, pageNumber, redirectFor, resolvePath, searchEntries, termArchive, themeState, type Resolved, type ThemeState } from '../../../cms/site';
import { siteTheme, themeHelpers, unavailable } from '../../../cms/site-view';
import { entrySeo, homeSeo, listSeo } from '../../../cms/seo';
import { emptySeo, seoHead, type SeoView } from '../../../cms/seo-head';

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
    @State() view: ArchiveView = { kind: 'archive', title: '', description: '', entries: [], paging: { page: 1, pages: 1, base: '/' }, query: '' };
    @State() theme: ThemeState = { name: null, options: {} };
    @State() seo: SeoView = emptySeo();

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
            if (resolved.kind === 'none' || resolved.kind === 'redirect') { this.c.status(404); return; }
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
                this.view = { ...this.view, kind: 'search', query, title: query ? `${__('Results for')} “${query}”` : __('Search'), entries: query ? await searchEntries(cms, query, resolved.locale) : [] };
                this.seo = await listSeo(cms, this.c, { title: this.view.title, description: '', url: base, locale: resolved.locale, links, noindex: true });
            } else if (resolved.kind === 'entry' && resolved.collection.name === 'pages' && resolved.record.id === settings['reading.pageForPosts']) {
                // Settings → Reading's posts page lists the latest posts under its own title.
                this.kind = 'list';
                this.view = { ...this.view, title: String(resolved.record.title ?? ''), ...await archive(cms, cms.collection('posts'), page, { base, locale: resolved.locale }) };
                this.seo = await listSeo(cms, this.c, { title: this.view.title, description: '', url: base, locale: resolved.locale, links });
            } else if (resolved.kind === 'entry') {
                this.kind = 'entry';
                this.entry = (await entryViews(cms, resolved.collection, [resolved.record], { ...viewOptions, full: true }))[0]!;
                this.seo = await entrySeo(cms, this.c, resolved.collection, resolved.record, this.entry, links);
            } else if (resolved.kind === 'archive') {
                this.kind = 'list';
                this.view = { ...this.view, title: resolved.collection.label, description: resolved.collection.description ?? '', ...await archive(cms, resolved.collection, page, { base, locale: resolved.locale }) };
                this.seo = await listSeo(cms, this.c, { title: this.view.title, description: this.view.description, url: base, locale: resolved.locale, links });
            } else if (resolved.kind === 'term') {
                const taxonomy = cms.taxonomies.declaration(resolved.term.taxonomy);
                this.kind = 'list';
                this.view = { ...this.view, kind: 'term', title: `${taxonomy.singular}: ${resolved.term.name}`, description: resolved.term.description, ...await termArchive(cms, resolved.term, page, base, resolved.locale) };
                this.seo = await listSeo(cms, this.c, { title: this.view.title, description: this.view.description, url: base, locale: resolved.locale, links });
            }
        } catch (error) {
            if (!isCmsError(error, 'CMS_UNAVAILABLE')) throw error;
            this.kind = 'unavailable';
            this.c.status(503);
        }
    }

    render() {
        if (this.kind === 'unavailable') return unavailable();
        const theme = siteTheme(this.theme.name);
        const helpers = themeHelpers(theme, this.theme.options, (path, exact) => this.isActive(path, exact));
        if (this.kind === 'entry' && this.entry) return theme.entry(this.entry, helpers);
        if (this.kind === 'home') return (theme.home ?? theme.archive)(this.view, helpers);
        if (this.kind === 'list') return (this.view.kind === 'search' ? theme.search ?? theme.archive : theme.archive)(this.view, helpers);
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
