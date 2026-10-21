import { Cossack, Page, State, type HeadValue } from '@cossackframework/core';
import { isCmsError, type ArchiveView, type EntryView, type ThemeData } from '@cossackframework/cms';
import { commentResult, homeView, languageLinks, pageNumber, themeData, themeState, type ThemeState } from '../../cms/site';
import { archiveTemplate, entryTemplate, siteContent, siteTheme, themeHelpers, unavailable } from '../../cms/site-view';
import { entrySeo, homeSeo } from '../../cms/seo';
import { emptySeo, seoHead, type SeoView } from '../../cms/seo-head';

/** The home page: the latest posts, or a static page chosen in Settings → Reading. Other languages' home pages are /<code>. */
@Page({ transport: 'http' })
export default class HomePage extends Cossack {
    @State() mode: 'posts' | 'page' | 'unavailable' = 'posts';
    @State() page: EntryView | null = null;
    @State() view: ArchiveView = { kind: 'home', collection: 'posts', taxonomy: null, title: '', description: '', entries: [], paging: { page: 1, pages: 1, base: '/' }, query: '' };
    @State() theme: ThemeState = { name: null, options: {} };
    /** What the theme's loader for the page returned. */
    @State() data: ThemeData = {};
    @State() seo: SeoView = emptySeo();

    head(): HeadValue {
        return this.seo.title ? seoHead(this.seo) : {};
    }

    async init() {
        const cms = this.c.get('cms');
        try {
            this.theme = await themeState(cms);
            const languages = await cms.languages();
            const links = await languageLinks(cms, { kind: 'home', locale: languages.default });
            const home = await homeView(cms, languages.default, pageNumber(this.c.req.query('page')), { comment: commentResult(this.c.req.query('comment')), user: this.user ? { name: this.user.name } : null });
            if (home.page && home.record) {
                this.mode = 'page';
                this.page = home.page;
                this.seo = await entrySeo(cms, this.c, cms.collection('pages'), home.record, { ...home.page, url: '/' }, links);
                this.data = await themeData(cms, this.theme, { kind: 'entry', collection: 'pages', template: home.page.template }, home.page, this.c.get('principal'), languages.default);
                return;
            }
            this.view = { ...this.view, ...home.view };
            this.data = await themeData(cms, this.theme, this.view, this.view, this.c.get('principal'), languages.default);
            this.seo = await homeSeo(cms, this.c, { url: '/', locale: languages.default, links, searchUrl: '/search' });
        } catch (error) {
            // Before setup, or while a migration is pending, content is unavailable.
            if (!isCmsError(error, 'CMS_UNAVAILABLE')) throw error;
            this.mode = 'unavailable';
            this.c.status(503);
        }
    }

    render() {
        if (this.mode === 'unavailable') return unavailable();
        const theme = siteTheme(this.theme);
        const helpers = themeHelpers(theme, { ...this.theme, data: { page: this.data } }, (path, exact) => this.isActive(path, exact));
        if (this.mode === 'page' && this.page) return siteContent(entryTemplate(theme, this.page.collection, this.page.template)(this.page, helpers));
        return siteContent(archiveTemplate(theme, this.view)(this.view, helpers));
    }
}
