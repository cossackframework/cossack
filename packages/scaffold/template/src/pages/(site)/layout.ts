import { Cossack, Page, State, type HeadContext, type HeadValue } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';
import type { SiteView } from '@cossackframework/cms';
import { languageLinks, siteView, themeState, type ThemeState } from '../../cms/site';
import { siteTheme, themeHelpers } from '../../cms/site-view';

/** The public site's frame, drawn by the active theme's layout, in the page's language. */
@Page({ transport: 'http' })
export default class SiteLayout extends Cossack {
    @State() site: SiteView & { noindex: boolean } = { title: '', tagline: '', blog: null, menus: {}, noindex: false, locale: 'en', languages: [], searchUrl: '/search', homeUrl: '/' };
    @State() theme: ThemeState = { name: null, options: {} };

    /** Pages set their own titles; the site title is the fallback. */
    head(context: HeadContext): HeadValue {
        return {
            title: context.title || this.site.title,
            meta: [
                ...(this.site.noindex ? [{ tag: 'meta', attributes: { name: 'robots', content: 'noindex, nofollow' } }] : []),
                { tag: 'meta', attributes: { property: 'og:site_name', content: this.site.title } },
            ],
            links: this.site.blog ? [{ tag: 'link', attributes: { rel: 'alternate', type: 'application/rss+xml', title: this.site.title, href: '/feed' } }] : [],
        };
    }

    async init() {
        const cms = this.c.get('cms');
        try {
            this.theme = await themeState(cms);
            const languages = await cms.languages();
            // The catch-all route resolves its path first; other routes are in the default language.
            const resolved = this.c.get('cms.site');
            const page = resolved && 'locale' in resolved ? resolved : { kind: this.c.req.path === '/' ? 'home' as const : 'search' as const, locale: languages.default };
            this.site = await siteView(cms, this.theme, { locale: page.locale, languages: await languageLinks(cms, page) });
        } catch { this.site = { ...this.site, title: config('app.name') }; }
    }

    render() {
        const theme = siteTheme(this.theme.name);
        return theme.layout(this.site, html`${this.children}`, themeHelpers(theme, this.theme.options, (path, exact) => this.isActive(path, exact)));
    }
}
