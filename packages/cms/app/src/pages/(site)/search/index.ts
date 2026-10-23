import { Cossack, Page, State, type HeadValue } from '@cossackframework/core';
import type { ArchiveView, ThemeData } from '@cossackframework/cms';
import { searchEntries, themeData, themeState, type ThemeState } from '../../../cms/site';
import { archiveTemplate, siteContent, siteTheme, themeHelpers } from '../../../cms/site-view';

/** Search published entries of every collection on the site. */
@Page({ transport: 'http' })
export default class SearchPage extends Cossack {
    @State() view: ArchiveView = { kind: 'search', collection: null, taxonomy: null, title: '', description: '', entries: [], paging: { page: 1, pages: 1, base: '/search' }, query: '' };
    @State() theme: ThemeState = { name: null, options: {} };
    /** What the theme's loader for search returned. */
    @State() data: ThemeData = {};

    head(): HeadValue {
        return { title: this.view.query ? `${__('Search results for')} “${this.view.query}”` : __('Search'), meta: [{ tag: 'meta', attributes: { name: 'robots', content: 'noindex' } }] };
    }

    async init() {
        const cms = this.c.get('cms');
        const query = (this.c.req.query('q') ?? '').trim().slice(0, 200);
        this.theme = await themeState(cms).catch(() => this.theme);
        const locale = (await cms.languages()).default;
        this.view = { ...this.view, query, title: query ? `${__('Results for')} “${query}”` : __('Search'), entries: query ? await searchEntries(cms, query, locale) : [] };
        this.data = await themeData(cms, this.theme, this.view, this.view, this.c.get('principal'), locale);
    }

    render() {
        const theme = siteTheme(this.theme);
        return siteContent(archiveTemplate(theme, this.view)(this.view, themeHelpers(theme, { ...this.theme, data: { page: this.data } }, (path, exact) => this.isActive(path, exact))), this.theme);
    }
}
