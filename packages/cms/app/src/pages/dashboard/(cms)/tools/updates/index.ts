import { Cossack, Page, State, flash, flashed, type HeadValue } from '@cossackframework/core';
import { Badge, Button, Card, CardBody, CardHeader } from '@cossackframework/ui';
import { html, component } from '@cossackframework/renderer';
import { ANONYMOUS, isSameOriginPost, type Principal } from '@cossackframework/cms';
import { defineServerMiddleware } from '@cossackframework/core';
import { networkFor, updateSettings, type CmsBindings } from '../../../../../cms/index';
import { clearRequest, requestUpdate, updateHook, updateStatus, type UpdateStatus } from '../../../../../cms/updates';
import { managesUpdates } from '../../../../../dashboard/access';
import { notice, pageHeader, shortDate } from '../../../../../cms/ui';

/** Holders of the updates permission on the main site; in a network, its administrators. */
const requireUpdates = defineServerMiddleware(async (c, next) => {
    if (await managesUpdates(c, c.get('principal') ?? ANONYMOUS)) { await next(); return; }
    return c.redirect('/dashboard');
});

const EMPTY: UpdateStatus = { installed: '', checking: true, checkedAt: null, available: null, error: '', request: null, hook: false, progressUrl: null };

/**
 * Tools → Updates: the installed version, the latest one the update server named, and a button
 * that asks the project's pipeline to update the site. A running site cannot change its own
 * code: the pipeline runs `cossack upgrade`, and the project's deploy ships the result.
 */
@Page({ transport: 'http', middlewares: [requireUpdates] })
export default class UpdatesPage extends Cossack {
    @State() status: UpdateStatus = EMPTY;
    @State() message = '';
    @State() error = '';

    head(): HeadValue {
        return { title: 'Updates' };
    }

    async init() {
        const env = this.c.env as CmsBindings;
        this.status = await updateStatus(networkFor(env), updateSettings(env), updateHook(env));
        this.message = flashed<string>('updates.message') ?? '';
        this.error = flashed<string>('updates.error') ?? '';
    }

    async post() {
        if (!isSameOriginPost(this.c.req.raw)) return this.c.text('Forbidden', 403);
        const form = await this.c.req.formData();
        const action = String(form.get('action') ?? '');
        const env = this.c.env as CmsBindings;
        const network = networkFor(env);
        const principal: Principal = this.c.get('principal') ?? ANONYMOUS;
        const by = principal.kind === 'user' ? principal.id : 'system';
        try {
            if (action === 'update') {
                // An older build cannot open the database after the update: the person confirms a backup first.
                if (form.get('backup') !== 'yes') throw new Error(__('Confirm that you have a backup first.'));
                const request = await requestUpdate(network, updateSettings(env), updateHook(env), by);
                await this.c.get('cms').audit.record({ actor: by, action: 'request-update', resource: 'cms/updates', recordId: request.version }).catch(() => undefined);
                flash('updates.message', `${__('Update requested: version')} ${request.version}.`);
            } else if (action === 'clear') {
                await clearRequest(network);
                flash('updates.message', __('The request was cleared. You can ask again.'));
            } else throw new Error(__('Unknown action.'));
        } catch (error) {
            flash('updates.error', error instanceof Error ? error.message : __('The update could not be requested.'));
        }
        return this.redirect('/dashboard/tools/updates');
    }

    render() {
        const { status } = this;
        const available = status.available;
        return html`<div class="space-y-6">
            ${pageHeader(__('Updates'), { description: __('The version this site runs, and the latest one.') })}
            ${this.message ? notice(this.message, 'success') : null}
            ${this.error ? notice(this.error, 'error') : null}
            <div class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
                <div class="space-y-6">
                    ${component(Card, {}, html`${component(CardHeader, {}, html`<h2 class="text-base font-semibold text-foreground">${__('Versions')}</h2>`)}
                    ${component(CardBody, { class: 'space-y-3 text-sm' }, html`
                        <p data-testid="installed-version">${__('Installed')}: <strong>${status.installed}</strong></p>
                        ${available ? html`<p data-testid="latest-version">${__('Latest')}: <strong>${available.latest}</strong>
                            ${available.security ? component(Badge, { variant: 'destructive' }, __('Security fix')) : component(Badge, { variant: 'secondary' }, __('Update available'))}
                            ${available.published ? html`<span class="text-muted-foreground"> · ${shortDate(available.published)}</span>` : null}</p>
                            ${available.notes ? html`<p><a class="text-primary underline" href=${available.notes} rel="noreferrer noopener" target="_blank">${__('Release notes')}</a></p>` : null}
                            ${available.hostTemplate ? html`<p class="text-muted-foreground">${__('This update also changes files in the project. cossack upgrade merges them with your edits.')}</p>` : null}`
                        : html`<p class="text-muted-foreground" data-testid="latest-version">${!status.checking ? __('This site does not ask for new versions (updates.check is off in src/cms.config.ts).')
                            : status.checkedAt ? __('This is the latest version.') : __('No answer from the update server yet. The site asks once a day.')}</p>`}
                        ${status.checkedAt ? html`<p class="text-xs text-muted-foreground">${__('Last checked')} ${shortDate(status.checkedAt)}${status.error ? html` · ${status.error}` : null}</p>` : null}`)}`)}
                    ${available ? component(Card, {}, html`${component(CardHeader, {}, html`<h2 class="text-base font-semibold text-foreground">${__('Update this site')}</h2>`)}
                    ${component(CardBody, { class: 'space-y-3 text-sm' }, status.request ? html`
                        <p data-testid="update-requested">${__('Update requested: version')} <strong>${status.request.version}</strong> · ${shortDate(status.request.requestedAt)}</p>
                        <p class="text-muted-foreground">${__('The project\'s pipeline runs cossack upgrade, and the site shows the new version after its next deploy.')}
                            ${status.progressUrl ? html` <a class="text-primary underline" href=${status.progressUrl} rel="noreferrer noopener" target="_blank">${__('See its progress')}</a>.` : null}</p>
                        <form method="post"><input type="hidden" name="action" value="clear">${component(Button, { type: 'submit', size: 'sm', variant: 'outline' }, __('Request again'))}</form>`
                    : status.hook ? html`
                        <p class="text-muted-foreground">${__('The button asks the project\'s pipeline to run cossack upgrade. The pipeline tests the result and opens a pull request, or deploys it, as the project set it up.')}</p>
                        <p class="text-muted-foreground">${__('Take a backup first. The update may change the database, and an older build cannot open it afterwards: going back means restoring the backup together with the older code.')}
                            <a class="text-primary underline" href="/dashboard/tools/export">${__('Tools → Export')}</a></p>
                        <form method="post" class="space-y-3">
                            <input type="hidden" name="action" value="update">
                            <label class="flex items-start gap-2"><input type="checkbox" name="backup" value="yes" required class="mt-1"><span>${__('I have a backup of this site\'s content.')}</span></label>
                            ${component(Button, { type: 'submit' }, `${__('Update to')} ${available.latest}`)}
                        </form>`
                    : html`
                        <p>${__('Run this in the project, then deploy:')}</p>
                        <pre class="rounded-md bg-muted px-3 py-2 text-xs"><code>pnpm cossack upgrade</code></pre>
                        <p class="text-muted-foreground">${__('To update from this page, give the site an update hook: CMS_UPDATE_HOOK_URL and CMS_UPDATE_HOOK_TOKEN in its environment. See docs/cms/updates.md.')}</p>`)}`) : null}
                </div>
                <aside class="space-y-4">
                    ${component(Card, {}, component(CardBody, { class: 'space-y-3' }, html`<h2 class="text-base font-semibold text-foreground">${__('How it works')}</h2>
                        <p class="text-xs text-muted-foreground">${__('Once a day the site asks the update server which version is the latest. It sends its own version and channel, and nothing about the site.')}</p>
                        <p class="text-xs text-muted-foreground">${__('The CMS is a package of the project. An update changes the project\'s dependencies, so it goes through the project\'s own pipeline, never around it.')}</p>`))}
                </aside>
            </div>
        </div>`;
    }
}
