import { Cossack, Page, State, flash, flashed, type HeadValue } from '@cossackframework/core';
import { Badge, Card, CardBody, CardHeader } from '@cossackframework/ui';
import { html, component } from '@cossackframework/renderer';
import { isCmsError, isSameOriginPost, PERMISSIONS } from '@cossackframework/cms';
import type { ScheduleRow } from '@cossackframework/cms/server';
import { requireAny } from '../../../../../cms/guards';
import { notice, pageHeader, shortDate } from '../../../../../cms/ui';
import { actionButton } from '../../../../../cms/network-view';

interface Waiting { id: string; topic: string; attempts: number; availableAt: number; plugins: string[] | null }
interface Dead { id: string; topic: string; attempts: number; at: number; plugins: string[] }

/**
 * Tools → Jobs: the outbox (after-commit events, webhooks' sources, cache purges, plugin jobs)
 * as it stands: what waits, what failed for good and for which plugins, and the plugins'
 * schedules with their next time. Retry or drop a failed event; run the queue now.
 */
@Page({ transport: 'http', middlewares: [requireAny(PERMISSIONS.manageSettings)] })
export default class JobsPage extends Cossack {
    @State() waiting: Waiting[] = [];
    @State() dead: Dead[] = [];
    @State() schedules: ScheduleRow[] = [];
    @State() message = '';
    @State() error = '';

    head(): HeadValue {
        return { title: 'Jobs' };
    }

    async init() {
        const cms = this.c.get('cms');
        this.waiting = await cms.outbox.pending({ limit: 100 });
        this.dead = await cms.outbox.deadLettered({ limit: 100 });
        this.schedules = await cms.schedules.list();
        this.message = flashed<string>('jobs.message') ?? '';
        this.error = flashed<string>('jobs.error') ?? '';
    }

    async post() {
        if (!isSameOriginPost(this.c.req.raw)) return this.c.text('Forbidden', 403);
        const form = await this.c.req.formData();
        const action = String(form.get('action') ?? '');
        const id = String(form.get('id') ?? '');
        const cms = this.c.get('cms');
        try {
            if (action === 'run') {
                await cms.schedules.tick();
                const report = await cms.outbox.dispatch({ limit: 100 });
                await cms.webhooks.dispatch({ limit: 50 });
                flash('jobs.message', `${__('Ran the queue:')} ${report.delivered.length} ${__('delivered')}, ${report.retrying.length} ${__('retrying')}, ${report.deadLettered.length} ${__('given up')}.`);
            } else if (action === 'retry') {
                flash(await cms.outbox.retry(id) ? 'jobs.message' : 'jobs.error', await cms.outbox.retry(id) || true ? __('Queued again; it runs on the next pass.') : __('Nothing to retry.'));
            } else if (action === 'remove') {
                flash(await cms.outbox.remove(id) ? 'jobs.message' : 'jobs.error', __('Removed.'));
            } else throw new Error(__('Unknown action.'));
        } catch (error) {
            flash('jobs.error', isCmsError(error) || error instanceof Error ? (error as Error).message : __('The action failed.'));
        }
        return this.redirect('/dashboard/tools/jobs');
    }

    render() {
        const topic = (name: string) => name === 'plugin.job' ? __('Plugin job') : name === 'cache.purge' ? __('Cache purge') : name === 'form.submitted' ? __('Form submission') : __('Content change');
        const row = (entry: { id: string; topic: string; attempts: number; plugins: string[] | null }, when: string, actions: unknown) => html`<li class="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm" data-job=${entry.id}>
            <span><span class="font-medium text-foreground">${topic(entry.topic)}</span> <code class="text-xs text-muted-foreground">${entry.id.length > 60 ? `${entry.id.slice(0, 57)}…` : entry.id}</code>
                <span class="block text-xs text-muted-foreground">${when} · ${entry.attempts} ${__('attempt(s)')}${entry.plugins?.length ? html` · ${__('waiting on')} ${entry.plugins.join(', ')}` : null}</span></span>
            <span class="flex gap-2">${actions}</span></li>`;
        return html`<div class="space-y-6">
            ${pageHeader(__('Jobs'), { description: __('Background work: content events on their way to plugins and webhooks, cache purges, plugin jobs and schedules.') })}
            ${this.message ? notice(this.message, 'success') : null}
            ${this.error ? notice(this.error, 'error') : null}
            <div class="flex flex-wrap gap-2">${actionButton('run', __('Run the queue now'))}</div>
            ${component(Card, {}, html`${component(CardHeader, {}, html`<h2 class="text-base font-semibold text-foreground">${__('Waiting')} ${component(Badge, { variant: 'secondary' }, String(this.waiting.length))}</h2>`)}
                ${component(CardBody, { class: 'p-0' }, this.waiting.length ? html`<ul class="divide-y divide-border" data-testid="jobs-waiting">${this.waiting.map(entry => row(entry, `${__('due')} ${shortDate(entry.availableAt)}`,
                    html`${actionButton('retry', __('Run now'), { id: entry.id })}${actionButton('remove', __('Drop'), { id: entry.id }, { danger: true })}`))}</ul>`
                    : html`<p class="px-4 py-6 text-sm text-muted-foreground">${__('Nothing is waiting.')}</p>`)}`)}
            ${component(Card, {}, html`${component(CardHeader, {}, html`<h2 class="text-base font-semibold text-foreground">${__('Given up')} ${component(Badge, { variant: this.dead.length ? 'destructive' : 'secondary' }, String(this.dead.length))}</h2>
                <p class="text-sm text-muted-foreground">${__('Events that failed ten times for the plugins listed. Retry once the plugin is fixed, or drop them.')}</p>`)}
                ${component(CardBody, { class: 'p-0' }, this.dead.length ? html`<ul class="divide-y divide-border" data-testid="jobs-dead">${this.dead.map(entry => row(entry, `${__('gave up')} ${shortDate(entry.at)}`,
                    html`${actionButton('retry', __('Retry'), { id: entry.id })}${actionButton('remove', __('Drop'), { id: entry.id }, { danger: true })}`))}</ul>`
                    : html`<p class="px-4 py-6 text-sm text-muted-foreground">${__('Nothing failed for good.')}</p>`)}`)}
            ${component(Card, {}, html`${component(CardHeader, {}, html`<h2 class="text-base font-semibold text-foreground">${__('Schedules')}</h2>
                <p class="text-sm text-muted-foreground">${__('Jobs the clock queues for active plugins, from their manifests.')}</p>`)}
                ${component(CardBody, { class: 'p-0' }, this.schedules.length ? html`<ul class="divide-y divide-border" data-testid="jobs-schedules">${this.schedules.map(schedule => html`<li class="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
                    <span><span class="font-medium text-foreground">${schedule.plugin}</span> · ${schedule.name} <code class="text-xs text-muted-foreground">${schedule.cron}</code></span>
                    <span class="text-xs text-muted-foreground">${__('next')} ${shortDate(schedule.nextAt)}${schedule.lastAt ? html` · ${__('last')} ${shortDate(schedule.lastAt)}` : null}</span></li>`)}</ul>`
                    : html`<p class="px-4 py-6 text-sm text-muted-foreground">${__('No plugin declares a schedule.')}</p>`)}`)}
        </div>`;
    }
}
