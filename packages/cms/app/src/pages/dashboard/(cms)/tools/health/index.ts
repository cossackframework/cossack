import { Cossack, Page, State, Server, Client, type HeadValue } from '@cossackframework/core';
import { Badge, Button, Card, CardBody, CardHeader, toast } from '@cossackframework/ui';
import { html, component, type TemplateResult } from '@cossackframework/renderer';
import { ANONYMOUS, ARTICLE_TYPES, CRAWLER_GROUPS, isCmsError, PERMISSIONS, recordTitle, type FieldFilter } from '@cossackframework/cms';
import type { CrawlerVisits, NotFoundRow } from '@cossackframework/cms/server';
import { requireAny } from '../../../../../cms/guards';
import { siteOrigin } from '../../../../../cms/seo';
import { notice, pageHeader, shortDate } from '../../../../../cms/ui';

interface Finding { id: string; tone: 'ok' | 'warn' | 'info'; title: string; detail: string; href?: string; items?: { title: string; href: string }[] }

const KINDS = ['entry', 'archive', 'home', 'term', 'author', 'search', 'markdown', 'llms', 'sitemap', 'robots', 'feed', 'not-found'] as const;
const GROUP_LABELS: Record<string, string> = Object.fromEntries(CRAWLER_GROUPS.map(group => [group.id, group.label]));

/**
 * How the site stands with search and answer engines: what crawlers fetched in the last two
 * weeks, which paths visitors miss, and content that is not ready (no summary, hidden entries
 * that are linked, authors without a profile), with the settings that matter.
 */
@Page({ transport: 'http', middlewares: [requireAny(PERMISSIONS.manageSettings, PERMISSIONS.manageRedirects)] })
export default class HealthPage extends Cossack {
    @State() visits: CrawlerVisits[] = [];
    @State() missing: NotFoundRow[] = [];
    @State() findings: Finding[] = [];
    @State() days = 14;
    @State() error = '';

    head(): HeadValue {
        return { title: __('Health') };
    }

    async init() {
        await this.load();
    }

    @Server()
    async load() {
        const cms = this.c.get('cms');
        try {
            this.visits = await cms.traffic.visits(this.days);
            this.missing = await cms.traffic.notFound({ limit: 50 });
            this.findings = await this.inspect();
        } catch (error) {
            if (!isCmsError(error)) throw error;
            this.error = error.message;
        }
    }

    /** Content and settings findings, worst first. */
    private async inspect(): Promise<Finding[]> {
        const cms = this.c.get('cms');
        const settings = await cms.settings.all();
        const findings: Finding[] = [];
        const origin = siteOrigin(this.c);
        if (settings['reading.discourageSearchEngines']) findings.push({ id: 'hidden', tone: 'warn', title: __('The site is hidden from search engines'), detail: __('Settings → Reading asks every engine to stay away; nothing below matters until that is off.'), href: '/dashboard/settings/reading' });
        if (!env('APP_URL', '')) findings.push({ id: 'app-url', tone: 'warn', title: __('APP_URL is not set'), detail: `${__('Canonical URLs, structured data and IndexNow pings use the request\'s origin instead; set APP_URL to the public address')} (${origin}).` });
        if (!settings['seo.logo']) findings.push({ id: 'logo', tone: 'info', title: __('No publisher logo'), detail: __('Settings → SEO → Logo gives the Organization node an image; engines show it next to the site in results and answers.'), href: '/dashboard/settings/seo' });
        if (!settings['seo.sameAs'].trim()) findings.push({ id: 'same-as', tone: 'info', title: __('No publisher profiles'), detail: __('Settings → SEO → Profiles tells engines which entity publishes the site (social accounts, Wikidata).'), href: '/dashboard/settings/seo' });
        if (!settings['indexnow.enabled']) findings.push({ id: 'indexnow', tone: 'info', title: __('IndexNow is off'), detail: __('Turn it on under Settings → IndexNow so Bing, Yandex and the answers built on them learn of changes within minutes.'), href: '/dashboard/settings/indexnow' });
        if (!settings['crawlers.allowSearch']) findings.push({ id: 'search-blocked', tone: 'warn', title: __('Search engines are blocked in robots.txt'), detail: __('Settings → Crawlers turns Googlebot and Bingbot away, which also removes the site from AI Overviews and Copilot.'), href: '/dashboard/settings/crawlers' });
        if (!settings['crawlers.allowAiSearch']) findings.push({ id: 'ai-search-blocked', tone: 'info', title: __('AI search crawlers are blocked'), detail: __('ChatGPT search, Claude and Perplexity cannot cite the site. Intended? Then this is fine.'), href: '/dashboard/settings/crawlers' });
        findings.push({ id: 'cdn', tone: 'info', title: __('Behind Cloudflare? Check its AI bot settings'), detail: __('New Cloudflare zones block AI crawlers by default. The block covers AI search crawlers too, and some rules catch search engines; robots.txt cannot override it. Review Security → Bots in the Cloudflare dashboard.') });

        const collections = cms.collections().filter(collection => typeof collection.path === 'string' && collection.publishable !== false && !collection.managed);
        const noSummary: { title: string; href: string }[] = [];
        const hiddenLinked: { title: string; href: string }[] = [];
        const noDescription: { title: string; href: string }[] = [];
        let published = 0;
        for (const collection of collections) {
            const where: { [field: string]: FieldFilter } = { status: 'published' };
            const page = await cms.resource(`cms/${collection.name}`).list({ where, limit: 100, order: { field: 'publishedAt', direction: 'desc' } }, { principal: ANONYMOUS }).catch(() => ({ records: [] }));
            const article = ARTICLE_TYPES.has(collection.schema?.type ?? 'WebPage');
            for (const record of page.records) {
                published++;
                const href = `/dashboard/content/${collection.name}/${record.id}`;
                const seo = (record.seo ?? {}) as { description?: string; noindex?: boolean; cornerstone?: boolean };
                if (article && !(typeof record.summary === 'string' && record.summary.trim())) noSummary.push({ title: recordTitle(record, 'title'), href });
                if (!seo.description && !(typeof record.summary === 'string' && record.summary.trim()) && !record.excerpt) noDescription.push({ title: recordTitle(record, 'title'), href });
                if (seo.noindex && seo.cornerstone) hiddenLinked.push({ title: recordTitle(record, 'title'), href });
            }
        }
        if (noSummary.length) findings.push({ id: 'summary', tone: 'warn', title: `${noSummary.length} ${noSummary.length === 1 ? __('article has no summary') : __('articles have no summary')}`, detail: __('The summary is the answer engines quote and the meta description falls back to. Add one in each entry\'s Search and sharing box.'), items: noSummary.slice(0, 10) });
        if (noDescription.length) findings.push({ id: 'description', tone: 'info', title: `${noDescription.length} ${noDescription.length === 1 ? __('entry has nothing to describe it') : __('entries have nothing to describe them')}`, detail: __('No meta description, summary or excerpt: engines choose a passage themselves.'), items: noDescription.slice(0, 10) });
        if (hiddenLinked.length) findings.push({ id: 'hidden-cornerstone', tone: 'warn', title: `${hiddenLinked.length} ${__('cornerstone entries are hidden from search engines')}`, detail: __('They are marked noindex and cornerstone at once; one of the two is wrong.'), items: hiddenLinked });
        if (settings['seo.authorPages']) {
            const authors = await cms.users.authors({ limit: 200 });
            const bare = authors.filter(user => !(typeof user.meta.bio === 'string' && user.meta.bio.trim()));
            if (authors.length && bare.length) findings.push({ id: 'authors', tone: 'info', title: `${bare.length} ${bare.length === 1 ? __('author has no bio') : __('authors have no bio')}`, detail: __('Author pages and Person nodes show the bio, job title, website and profiles from each user\'s Public profile.'), items: bare.slice(0, 10).map(user => ({ title: user.name, href: '/dashboard/profile/public' })) });
        }
        if (published && !noSummary.length && !hiddenLinked.length) findings.push({ id: 'content-ok', tone: 'ok', title: __('Content is ready'), detail: `${published} ${__('published entries read; every article has a summary.')}` });
        return findings.sort((a, b) => ['warn', 'info', 'ok'].indexOf(a.tone) - ['warn', 'info', 'ok'].indexOf(b.tone));
    }

    @Client()
    async forget(path: string) {
        await this.forgetMissing(path);
        toast.success(__('Removed from the list.'));
    }

    @Server()
    async forgetMissing(path: string) {
        await this.c.get('cms').traffic.forgetNotFound(path);
        this.missing = this.missing.filter(row => row.path !== path);
    }

    private crawlerTable(): TemplateResult {
        if (!this.visits.length) return html`<p class="text-sm text-muted-foreground">${__('No known crawler fetched the site in this period. Crawlers are counted by their user agent; browsers are not.')}</p>`;
        const kinds = KINDS.filter(kind => this.visits.some(visit => visit.byKind[kind]));
        return html`<div class="overflow-x-auto"><table class="w-full text-sm">
            <thead><tr class="text-left text-xs uppercase text-muted-foreground"><th class="py-1 pr-3 font-medium">${__('Crawler')}</th><th class="py-1 pr-3 font-medium">${__('Total')}</th>${kinds.map(kind => html`<th class="py-1 pr-3 font-medium">${kind}</th>`)}<th class="py-1 font-medium">${__('Last seen')}</th></tr></thead>
            <tbody>${this.visits.map(visit => html`<tr class="border-t border-border">
                <td class="py-1.5 pr-3"><span class="text-foreground">${visit.agent}</span> <span class="text-xs text-muted-foreground">${GROUP_LABELS[visit.group] ?? visit.group}</span></td>
                <td class="py-1.5 pr-3 tabular-nums font-medium text-foreground">${visit.total}</td>
                ${kinds.map(kind => html`<td class="py-1.5 pr-3 tabular-nums text-muted-foreground">${visit.byKind[kind] ?? '—'}</td>`)}
                <td class="py-1.5 text-muted-foreground">${visit.lastDay}</td></tr>`)}</tbody></table></div>`;
    }

    render() {
        const tone = (value: Finding['tone']) => value === 'ok' ? 'bg-emerald-500' : value === 'warn' ? 'bg-amber-500' : 'bg-sky-500';
        return html`<div class="space-y-6">
            ${pageHeader(__('Health'), { description: __('How the site stands with search and answer engines: what they fetch, what visitors miss, and what to fix.') })}
            ${this.error ? notice(this.error, 'error') : null}
            ${component(Card, {}, html`
                ${component(CardHeader, {}, html`<h2 class="text-base font-semibold text-foreground">${__('Findings')}</h2>`)}
                ${component(CardBody, {}, html`<ul class="divide-y divide-border">${this.findings.map(finding => html`<li class="flex gap-3 py-3">
                    <span class=${`mt-1.5 inline-block size-2.5 shrink-0 rounded-full ${tone(finding.tone)}`} aria-hidden="true"></span>
                    <div class="min-w-0 space-y-1">
                        <p class="text-sm font-medium text-foreground">${finding.href ? html`<a href=${finding.href} class="text-foreground hover:text-primary">${finding.title}</a>` : finding.title}</p>
                        <p class="text-sm text-muted-foreground">${finding.detail}</p>
                        ${finding.items?.length ? html`<p class="text-sm">${finding.items.map((item, index) => html`${index ? ', ' : ''}<a href=${item.href} class="text-primary hover:underline">${item.title}</a>`)}</p>` : null}
                    </div></li>`)}</ul>`)}`)}
            ${component(Card, {}, html`
                ${component(CardHeader, {}, html`<div class="flex flex-wrap items-center justify-between gap-2"><h2 class="text-base font-semibold text-foreground">${__('Crawler visits')} <span class="text-sm font-normal text-muted-foreground">${__('last')} ${this.days} ${__('days')}</span></h2>
                    <div class="flex gap-1">${[7, 14, 30, 90].map(days => component(Button, { type: 'button', size: 'sm', variant: days === this.days ? 'default' : 'outline', '@click': () => { this.days = days; void this.load(); } }, `${days}d`))}</div></div>
                    <p class="text-sm text-muted-foreground">${__('Which engines fetch the site, and what: entries, archives, the sitemap, llms.txt, Markdown. If an AI search crawler never shows, check robots.txt and the CDN; if it fetches llms.txt or Markdown, those surfaces are read.')}</p>`)}
                ${component(CardBody, {}, this.crawlerTable())}`)}
            ${component(Card, {}, html`
                ${component(CardHeader, {}, html`<h2 class="text-base font-semibold text-foreground">${__('Missing pages')} <span class="text-sm font-normal text-muted-foreground">(${this.missing.length})</span></h2>
                    <p class="text-sm text-muted-foreground">${__('Paths that answered 404 to readers or crawlers, most hit first. Redirect the ones that used to be pages.')}</p>`)}
                ${component(CardBody, {}, this.missing.length ? html`<table class="w-full text-sm">
                    <thead><tr class="text-left text-xs uppercase text-muted-foreground"><th class="py-1 pr-3 font-medium">${__('Path')}</th><th class="py-1 pr-3 font-medium">${__('Hits')}</th><th class="py-1 pr-3 font-medium">${__('Last')}</th><th class="py-1 pr-3 font-medium">${__('From')}</th><th class="py-1 font-medium"></th></tr></thead>
                    <tbody>${this.missing.map(row => html`<tr class="border-t border-border">
                        <td class="py-1.5 pr-3"><code class="rounded bg-muted px-1.5 py-0.5 text-xs text-foreground">${row.path}</code></td>
                        <td class="py-1.5 pr-3 tabular-nums">${row.hits}</td><td class="py-1.5 pr-3 text-muted-foreground">${shortDate(row.lastHitAt)}</td>
                        <td class="max-w-48 truncate py-1.5 pr-3 text-xs text-muted-foreground" title=${row.referrer}>${row.referrer ? new URL(row.referrer).host : '—'}</td>
                        <td class="py-1.5 text-right whitespace-nowrap"><a href=${`/dashboard/tools/redirects?source=${encodeURIComponent(row.path)}`} class="text-primary hover:underline">${__('Redirect')}</a>
                            <button type="button" class="ml-3 text-muted-foreground hover:text-foreground bg-transparent border-none p-0 cursor-pointer" @click=${() => this.forget(row.path)}>${__('Dismiss')}</button></td></tr>`)}</tbody></table>`
                    : html`<p class="text-sm text-muted-foreground">${__('Nothing missed yet.')}</p>`)}`)}
            ${component(Badge, { variant: 'secondary' }, `${__('Counted since the upgrade that added this page; older visits are not known.')}`)}
        </div>`;
    }
}
