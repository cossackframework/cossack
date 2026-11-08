import { Cossack, Page, State, flash, flashed, type HeadValue } from '@cossackframework/core';
import { settingsSectionHref } from '../../../../../cms/settings-search';
import { Badge, Card, CardBody, CardHeader } from '@cossackframework/ui';
import { html, component } from '@cossackframework/renderer';
import { cacheHoldSeconds, cachePurge, isCmsError, isSameOriginPost, PERMISSIONS, type CacheHold } from '@cossackframework/cms';
import type { PurgeRecord } from '@cossackframework/cms/server';
import { requireAny } from '../../../../../cms/guards';
import { notice, pageHeader, shortDate } from '../../../../../cms/ui';
import { actionButton } from '../../../../../cms/network-view';

/**
 * Tools → Cache: what the caches in front of the site are told (Settings → Cache), which
 * purgers changes reach, the last purges run from this process, and a button that purges every
 * page, for a change made outside the CMS.
 */
@Page({ transport: 'http', middlewares: [requireAny(PERMISSIONS.manageSettings)] })
export default class CachePage extends Cossack {
    @State() hold: CacheHold = 'auto';
    @State() seconds = 0;
    /** The purgers the application configured, and the plugins with a `cms.cache.purge` handler. */
    @State() purgers: string[] = [];
    @State() plugins: string[] = [];
    @State() recent: PurgeRecord[] = [];
    @State() message = '';
    @State() error = '';

    head(): HeadValue {
        return { title: 'Cache' };
    }

    async init() {
        const cms = this.c.get('cms');
        this.hold = await cms.settings.get('cache.hold');
        this.seconds = cacheHoldSeconds(this.hold, { purging: cms.purge.configured });
        this.purgers = cms.purge.purgers.map(purger => purger.name);
        this.plugins = [...new Set(cms.hooks.handlers(cachePurge).map(handler => handler.plugin).filter(plugin => !plugin.startsWith('cms-purge-')))];
        this.recent = cms.purge.recent;
        this.message = flashed<string>('cache.message') ?? '';
        this.error = flashed<string>('cache.error') ?? '';
    }

    /** Purge every page now: queued like any purge, then the outbox is run so the result shows at once. */
    async post() {
        if (!isSameOriginPost(this.c.req.raw)) return this.c.text('Forbidden', 403);
        const action = String((await this.c.req.formData()).get('action') ?? '');
        const cms = this.c.get('cms');
        try {
            if (action !== 'purge') throw new Error(__('Unknown action.'));
            const event = await cms.purge.everything('manual');
            await cms.outbox.dispatch({ limit: 10 });
            const failed = cms.purge.recent.filter(record => record.eventId === event.eventId && !record.ok);
            if (failed.length) flash('cache.error', `${failed[0]!.purger}: ${failed[0]!.message}`);
            else flash('cache.message', cms.purge.configured || this.plugins.length ? __('Purged every page of the site.') : __('Queued. No purger is set up, so nothing was told; pages refresh when their hold ends.'));
        } catch (error) {
            flash('cache.error', isCmsError(error) || error instanceof Error ? (error as Error).message : __('The purge could not be queued.'));
        }
        return this.redirect('/dashboard/tools/cache');
    }

    render() {
        const hold = this.seconds === 0 ? __('Pages are not held: every request reaches the site.')
            : this.seconds >= 86_400 ? `${__('Pages may be held for')} ${Math.round(this.seconds / 86_400)} ${__('day(s)')}.`
            : this.seconds >= 3_600 ? `${__('Pages may be held for')} ${Math.round(this.seconds / 3_600)} ${__('hour(s)')}.`
            : `${__('Pages may be held for')} ${Math.round(this.seconds / 60)} ${__('minute(s)')}.`;
        const purgers = [...this.purgers, ...this.plugins];
        return html`<div class="space-y-6">
            ${pageHeader(__('Cache'), { description: __('What the caches in front of the site are told, and the purges that keep them current.') })}
            ${this.message ? notice(this.message, 'success') : null}
            ${this.error ? notice(this.error, 'error') : null}
            <div class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
                <div class="space-y-6">
                    ${component(Card, {}, html`${component(CardHeader, {}, html`<h2 class="text-base font-semibold text-foreground">${__('Recent purges')}</h2>`)}
                    ${component(CardBody, { class: 'p-0' }, this.recent.length ? html`<ul class="divide-y divide-border" data-testid="recent-purges">${this.recent.map(record => html`<li class="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                        <span><code>${record.reason}</code> <span class="text-muted-foreground">· ${shortDate(record.at)} · ${record.purger} · ${record.tags.length} ${__('tag(s)')}${record.urls.length ? `, ${record.urls.length} ${__('URL(s)')}` : ''}</span>
                            ${record.message ? html`<span class="block text-xs text-destructive">${record.message}</span>` : null}</span>
                        ${component(Badge, { variant: record.ok ? 'success' : 'destructive' }, record.ok ? __('Purged') : __('Failed'))}
                    </li>`)}</ul>` : html`<p class="px-4 py-6 text-sm text-muted-foreground">${purgers.length ? __('No purges from this process yet. Publishing or changing an entry, a menu, a setting or the theme purges the pages it touched.') : __('No purger is set up. Set CLOUDFLARE_API_TOKEN (Zone → Cache Purge and Zone → Zone Read) to purge Cloudflare when pages change, or add a plugin with a cms.cache.purge handler for another CDN.')}</p>`)}`)}
                </div>
                <aside class="space-y-4">
                    ${component(Card, {}, component(CardBody, { class: 'space-y-3' }, html`<h2 class="text-base font-semibold text-foreground">${__('Hold')}</h2>
                        <p class="text-sm text-muted-foreground" data-testid="cache-hold">${hold}</p>
                        <p class="text-xs text-muted-foreground">${__('Anonymous pages say so in Cache-Control; a signed-in user\'s page, Live Edit, previews and protected entries are never held. Change it under')} <a href=${settingsSectionHref('cache')} class="text-primary hover:underline">${__('Settings → Cache')}</a>.</p>
                        <p class="text-xs text-muted-foreground">${__('On Cloudflare, add one cache rule for the site: cache everything, using the origin\'s Cache-Control. Crawler counts on Health then see only the requests the cache passes on.')}</p>`))}
                    ${component(Card, {}, component(CardBody, { class: 'space-y-3' }, html`<h2 class="text-base font-semibold text-foreground">${__('Purgers')}</h2>
                        ${purgers.length ? html`<ul class="space-y-1 text-sm text-foreground" data-testid="purgers">${purgers.map(name => html`<li><code>${name}</code></li>`)}</ul>` : html`<p class="text-sm text-muted-foreground">${__('None.')}</p>`}
                        <p class="text-xs text-muted-foreground">${__('Changes purge the pages they touched by themselves. Purge everything after a change made outside the CMS, such as a deploy.')}</p>
                        ${actionButton('purge', __('Purge everything'))}`))}
                </aside>
            </div>
        </div>`;
    }
}
