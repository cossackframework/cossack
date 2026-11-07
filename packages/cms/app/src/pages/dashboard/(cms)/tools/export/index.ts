import { Cossack, Page, State, flash, flashed, type HeadValue } from '@cossackframework/core';
import { Card, CardBody } from '@cossackframework/ui';
import { html, component } from '@cossackframework/renderer';
import { isCmsError, isNetworkAdmin, isSameOriginPost, MAIN_SITE, PERMISSIONS } from '@cossackframework/cms';
import { requireAny } from '../../../../../cms/guards';
import { notice, pageHeader, shortDate } from '../../../../../cms/ui';
import { actionButton } from '../../../../../cms/network-view';

/** How this site may export its database: at once, or through a network admin's approval. */
type ExportAccess =
    | { kind: 'download' }
    | { kind: 'request' }
    | { kind: 'requested'; at: number }
    | { kind: 'approved'; until: number };

/**
 * Tools → Export: this site's database as a JSON file, or a `.romedb` file where the install
 * can make one. The main site, and sites the network lets export themselves, download at once;
 * other sites ask a network admin, then download for 7 days after the approval.
 */
@Page({ transport: 'http', middlewares: [requireAny(PERMISSIONS.manageSettings)] })
export default class ExportPage extends Cossack {
    @State() access: ExportAccess = { kind: 'download' };
    /** Whether this user may have this site's `.romedb` file. */
    @State() files = false;
    @State() message = '';
    @State() error = '';

    head(): HeadValue {
        return { title: 'Export' };
    }

    async init() {
        const site = this.c.get('site');
        const { allowed, request } = await this.c.get('network').exportAccess(site?.id ?? MAIN_SITE);
        this.access = allowed ? request?.expiresAt ? { kind: 'approved', until: request.expiresAt } : { kind: 'download' }
            : request ? { kind: 'requested', at: request.requestedAt } : { kind: 'request' };
        this.files = site?.id !== MAIN_SITE || isNetworkAdmin(this.c.get('principal'));
        this.message = flashed<string>('export.message') ?? '';
        this.error = flashed<string>('export.error') ?? '';
    }

    async post() {
        if (!isSameOriginPost(this.c.req.raw)) return this.c.text('Forbidden', 403);
        const action = String((await this.c.req.formData()).get('action') ?? '');
        const site = this.c.get('site');
        const network = this.c.get('network');
        try {
            if (!site || site.id === MAIN_SITE) throw new Error(__('This site downloads its export at once.'));
            if (action === 'request') {
                await network.requestExport(site.id, { principal: this.c.get('principal') });
                flash('export.message', __('Requested. A network admin will review it; you can download the export here once it is approved.'));
            } else if (action === 'withdraw') {
                await network.withdrawExport(site.id, { principal: this.c.get('principal') });
                flash('export.message', __('Request withdrawn.'));
            }
        } catch (error) {
            flash('export.error', isCmsError(error) || error instanceof Error ? (error as Error).message : __('The request could not be sent.'));
        }
        return this.redirect('/dashboard/tools/export');
    }

    render() {
        const download = html`<div class="flex flex-wrap gap-2">
            <a href="/api/cms/site-export" download class="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground no-underline">${__('Download export')}</a>
            ${this.files ? html`<a href="/api/cms/site-export?format=romedb" download data-database-file class="inline-flex items-center justify-center rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground no-underline hover:bg-muted">${__('Download database file')}</a>` : null}
        </div>`;
        const body = this.access.kind === 'download' ? html`<p class="text-sm text-muted-foreground">${__('One JSON file with every table of this site\'s database: content, settings, collections, terms, menus, comments, forms and members.')}</p>${download}`
            : this.access.kind === 'approved' ? html`<p class="text-sm text-muted-foreground">${__('A network admin approved the export.')} ${this.access.until ? `${__('Download it until')} ${shortDate(this.access.until)}.` : ''}</p>${download}`
            : this.access.kind === 'requested' ? html`<p class="text-sm text-muted-foreground">${__('Requested on')} ${shortDate(this.access.at)}. ${__('A network admin will review it; the download appears here once it is approved.')}</p>
                ${actionButton('withdraw', __('Withdraw request'))}`
            : html`<p class="text-sm text-muted-foreground">${__('This site belongs to a network: a network admin approves its export. Once approved, the download appears here for 7 days.')}</p>
                ${actionButton('request', __('Request export'))}`;
        return html`<div class="space-y-6">
            ${pageHeader(__('Export'), { description: __('Download this site\'s database to keep a copy or move the site.') })}
            ${this.message ? notice(this.message, 'success') : null}
            ${this.error ? notice(this.error, 'error') : null}
            ${component(Card, { class: 'max-w-2xl' }, component(CardBody, { class: 'space-y-4' }, html`${body}
                <p class="text-xs text-muted-foreground">${__('Sessions, passwords, second factors, application passwords and webhook secrets stay out. Media files are not included; their records are.')}</p>
                <p class="text-xs text-muted-foreground">${__('To move the site, import the file into a new install at its setup, or into a new site of a network from its page under Network → Sites.')}</p>
                ${this.files ? html`<p class="text-xs text-muted-foreground">${__('The database file is a .romedb file that a new install opens directly, for sites too large to import. It keeps the site\'s own accounts with their password hashes and authenticator secrets, so keep it private. Sessions, webhooks and pending work stay out.')}</p>` : null}`))}
        </div>`;
    }
}
