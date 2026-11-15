import { Client, Cossack, Page, Server, State, type HeadValue } from '@cossackframework/core';
import { Button, Card, CardBody, CardHeader, SegmentBar } from '@cossackframework/ui';
import { html, component } from '@cossackframework/renderer';
import { formatBytes, PERMISSIONS, type MediaKind } from '@cossackframework/cms';
import type { FileSummary } from '@cossackframework/cms/server';
import { requireAny } from '../../../../../cms/guards';
import { notice, pageHeader } from '../../../../../cms/ui';
import { timeAgo } from '../../../../../dashboard/time-ago';

/** The summary is kept a day: counting a large library takes a while, and the totals move slowly. */
const DAY = 24 * 60 * 60_000;
const KEY = 'cms:files:summary';
const KIND_LABELS: Readonly<Record<MediaKind, string>> = { image: 'Images', video: 'Video', audio: 'Audio', document: 'Documents', archive: 'Archives' };

/** Files → Summary: how much the library holds, by kind, and the resized copies of images. */
@Page({ transport: 'http', middlewares: [requireAny(PERMISSIONS.upload, PERMISSIONS.manageMedia)] })
export default class FilesSummary extends Cossack {
    @State() summary: FileSummary | null = null;
    /** When the summary was counted, and when the page was rendered, for "3 hours ago". */
    @State() at = 0;
    @State() now = 0;
    @State() error = '';
    @State() refreshing = false;

    head(): HeadValue {
        return { title: 'Files summary' };
    }

    async init() {
        await this.load(false);
    }

    @Server()
    async load(fresh: boolean) {
        const cms = this.c.get('cms');
        this.error = '';
        if (!cms.files) { this.error = __('File storage is not configured.'); return; }
        try {
            const files = cms.files;
            const entry = await cms.cache.remember(KEY, DAY, () => files.summary(), { fresh });
            this.summary = entry.value;
            this.at = entry.at;
            this.now = Date.now();
        } catch { this.error = __('The summary could not be counted.'); }
    }

    @Client()
    async refresh() {
        this.refreshing = true;
        try { await this.load(true); } finally { this.refreshing = false; }
    }

    render() {
        const summary = this.summary;
        const refresh = component(Button, { type: 'button', variant: 'outline', size: 'sm', disabled: this.refreshing, '@click': () => this.refresh() }, this.refreshing ? __('Counting…') : __('Refresh'));
        return html`<div class="max-w-3xl space-y-6">
            ${pageHeader(__('Files summary'), { description: __('How much the library holds. Counted once a day; Refresh counts again now.'), actions: refresh })}
            ${this.error ? notice(this.error, 'error') : null}
            ${summary ? html`
                <dl class="grid gap-4 sm:grid-cols-3">
                    ${[[__('Files'), String(summary.files)], [__('Total size'), formatBytes(summary.bytes)], [__('Resized copies'), `${summary.variants.files} · ${formatBytes(summary.variants.bytes)}`]].map(([label, value]) => html`
                        <div class="rounded-lg border border-border bg-card p-4"><dt class="text-xs uppercase tracking-wide text-muted-foreground">${label}</dt><dd class="mt-1 text-2xl font-semibold tabular-nums text-foreground">${value}</dd></div>`)}
                </dl>
                ${component(Card, {}, html`
                    ${component(CardHeader, {}, html`<h2 class="text-base font-semibold text-foreground">${__('Size by kind')}</h2>`)}
                    ${component(CardBody, {}, summary.kinds.length ? component(SegmentBar, { label: __('Size by kind'), items: summary.kinds.map(entry => ({
                        id: entry.kind, label: `${__(KIND_LABELS[entry.kind])} (${entry.files})`, value: entry.bytes, valueText: formatBytes(entry.bytes),
                    })) }) : html`<p class="text-sm text-muted-foreground">${__('The library is empty.')}</p>`)}
                `)}
                <p class="text-xs text-muted-foreground">${__('Counted')} <time datetime=${new Date(this.at).toISOString()} title=${new Date(this.at).toISOString().slice(0, 16).replace('T', ' ')}>${timeAgo(new Date(this.at).toISOString(), this.now)}</time>.</p>
            ` : null}
        </div>`;
    }
}
