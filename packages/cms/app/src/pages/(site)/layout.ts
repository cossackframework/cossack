import { Cossack, Page, State, type HeadContext, type HeadTag, type HeadValue } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';
import type { SiteView, ThemeData } from '@cossackframework/cms';
import { languageLinks, siteView, themeData, themeState, type ThemeState } from '../../cms/site';
import { siteTheme, themeHelpers } from '../../cms/site-view';

/** The public site's frame, drawn by the active theme's layout, in the page's language. */
@Page({ transport: 'http' })
export default class SiteLayout extends Cossack {
    @State() site: SiteView & { noindex: boolean } = { title: '', tagline: '', blog: null, menus: {}, noindex: false, locale: 'en', languages: [], searchUrl: '/search', homeUrl: '/', areas: {}, template: null };
    @State() theme: ThemeState = { name: null, options: {} };
    /** What the theme's `layout` loader returned. */
    @State() data: ThemeData = {};
    /** Settings → General: the site icon for tabs and the app icon for home screens, as URLs; empty for the application's own. */
    @State() icons: { favicon: string; appIcon: string } = { favicon: '', appIcon: '' };

    /**
     * Pages set their own titles; the site title is the fallback. The theme's head template
     * adds stylesheets, fonts and meta under the page's own: a page's title and meta win.
     */
    head(context: HeadContext): HeadValue {
        const theme = siteTheme(this.theme);
        const contributed = theme.head?.(this.site, themeHelpers(theme, { ...this.theme, data: { layout: this.data } }, () => false)) ?? {};
        const key = (tag: HeadTag) => String(tag.attributes?.name ?? tag.attributes?.property ?? '');
        const taken = new Set(context.meta.map(key).filter(Boolean));
        return {
            title: context.title || contributed.title || this.site.title,
            ...(contributed.description && !context.description ? { description: contributed.description } : {}),
            ...(contributed.image && !context.image ? { image: contributed.image } : {}),
            meta: [
                ...(contributed.meta ?? []).filter(tag => !taken.has(key(tag))),
                ...(this.site.noindex ? [{ tag: 'meta', attributes: { name: 'robots', content: 'noindex, nofollow' } }] : []),
                { tag: 'meta', attributes: { property: 'og:site_name', content: this.site.title } },
            ],
            links: [...(contributed.links ?? []), ...(this.site.blog ? [{ tag: 'link', attributes: { rel: 'alternate', type: 'application/rss+xml', title: this.site.title, href: '/feed' } }] : []), ...this.iconLinks()],
            ...(contributed.scripts ? { scripts: contributed.scripts } : {}),
            // The site's Additional CSS, checked on save, after the theme's own tags.
            tags: [...(contributed.tags ?? []), ...(this.theme.customCss ? [{ tag: 'style', attributes: { 'data-cms-custom-css': '' }, children: this.theme.customCss }] : [])],
        };
    }

    /** The site icon for tabs, the app icon for home screens, and the manifest that lists it. */
    private iconLinks(): HeadTag[] {
        const { favicon, appIcon } = this.icons;
        const resized = (url: string, size: number) => url.startsWith('/media/') ? `${url}?w=${size}&h=${size}` : url;
        return [
            ...(favicon ? [{ tag: 'link', attributes: { rel: 'icon', href: favicon, ...(/\.svg(?:$|[?#])/i.test(favicon) ? { type: 'image/svg+xml' } : {}) } }] : []),
            ...(appIcon ? [{ tag: 'link', attributes: { rel: 'apple-touch-icon', sizes: '180x180', href: resized(appIcon, 180) } }, { tag: 'link', attributes: { rel: 'manifest', href: '/manifest.webmanifest' } }] : []),
        ];
    }

    async init() {
        const cms = this.c.get('cms');
        try {
            this.theme = await themeState(cms);
            const settings = await cms.settings.all();
            this.icons = { favicon: settings['general.favicon'], appIcon: settings['general.appIcon'] };
            const languages = await cms.languages();
            // The catch-all route resolves its path first; other routes are in the default language.
            const resolved = this.c.get('cms.site');
            const page = resolved && 'locale' in resolved ? resolved : { kind: this.c.req.path === '/' ? 'home' as const : 'search' as const, locale: languages.default };
            const template = resolved?.kind === 'entry' && typeof resolved.record.template === 'string' && resolved.record.template ? resolved.record.template : null;
            this.site = await siteView(cms, this.theme, { locale: page.locale, languages: await languageLinks(cms, page), template, forms: { query: this.c.req.query(), principal: this.c.get('principal'), url: this.c.req.path } });
            this.data = await themeData(cms, this.theme, 'layout', this.site, this.c.get('principal'), page.locale);
        } catch { this.site = { ...this.site, title: config('app.name') }; }
    }

    render() {
        const theme = siteTheme(this.theme);
        return theme.layout(this.site, html`${this.children}`, themeHelpers(theme, { ...this.theme, data: { layout: this.data } }, (path, exact) => this.isActive(path, exact)));
    }
}
