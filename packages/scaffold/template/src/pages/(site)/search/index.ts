import { Cossack, Page, State, type HeadValue } from '@cossackframework/core';
import type { ArchiveView } from '@cossackframework/cms';
import { searchEntries, themeState, type ThemeState } from '../../../cms/site';
import { siteTheme, themeHelpers } from '../../../cms/site-view';

/** Search published entries of every collection on the site. */
@Page({ transport: 'http' })
export default class SearchPage extends Cossack {
    @State() view: ArchiveView = { kind: 'search', title: '', description: '', entries: [], paging: { page: 1, pages: 1, base: '/search' }, query: '' };
    @State() theme: ThemeState = { name: null, options: {} };

    head(): HeadValue {
        return { title: this.view.query ? `${__('Search results for')} “${this.view.query}”` : __('Search'), meta: [{ tag: 'meta', attributes: { name: 'robots', content: 'noindex' } }] };
    }

    async init() {
        const cms = this.c.get('cms');
        const query = (this.c.req.query('q') ?? '').trim().slice(0, 200);
        this.theme = await themeState(cms).catch(() => this.theme);
        this.view = { ...this.view, query, title: query ? `${__('Results for')} “${query}”` : __('Search'), entries: query ? await searchEntries(cms, query, (await cms.languages()).default) : [] };
    }

    render() {
        const theme = siteTheme(this.theme.name);
        return (theme.search ?? theme.archive)(this.view, themeHelpers(theme, this.theme.options, (path, exact) => this.isActive(path, exact)));
    }
}
