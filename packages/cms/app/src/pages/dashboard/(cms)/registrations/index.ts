import { Cossack, Page, State, flash, flashed, type HeadValue } from '@cossackframework/core';
import { Badge, Card, CardBody } from '@cossackframework/ui';
import { html, component } from '@cossackframework/renderer';
import { isCmsError, isSameOriginPost, PERMISSIONS } from '@cossackframework/cms';
import { approveRegistration } from '../../../../auth';
import { requireAny } from '../../../../cms/guards';
import { notice, pageHeader, shortDate } from '../../../../cms/ui';
import { actionButton } from '../../../../cms/network-view';

interface Waiting { id: string; name: string; email: string; verified: boolean; createdAt: number }

/**
 * Users → Registrations: the accounts that wait for an administrator's approval, when Settings →
 * General asks for it. Approve one to let them sign in (they get an email), or delete it.
 */
@Page({ transport: 'http', middlewares: [requireAny(PERMISSIONS.manageUsers)] })
export default class RegistrationsPage extends Cossack {
    @State() waiting: Waiting[] = [];
    @State() required = false;
    @State() message = '';
    @State() error = '';

    head(): HeadValue {
        return { title: 'Registrations' };
    }

    async init() {
        const cms = this.c.get('cms');
        this.required = await cms.settings.get('general.approveRegistrations');
        this.waiting = (await cms.users.registrations({ limit: 200 })).map(({ user, verified, createdAt }) => ({ id: user.id, name: user.name, email: user.email, verified, createdAt }));
        this.message = flashed<string>('registrations.message') ?? '';
        this.error = flashed<string>('registrations.error') ?? '';
    }

    async post() {
        if (!isSameOriginPost(this.c.req.raw)) return this.c.text('Forbidden', 403);
        const form = await this.c.req.formData();
        const action = String(form.get('action') ?? '');
        const id = String(form.get('id') ?? '');
        const cms = this.c.get('cms');
        try {
            if (!(await cms.users.awaitingApproval(id))) throw new Error(__('This account does not wait for approval.'));
            if (action === 'approve') {
                await approveRegistration(id, new URL(this.c.req.url).origin);
                flash('registrations.message', __('Approved. They can sign in now and got an email saying so.'));
            } else if (action === 'delete') {
                await cms.users.delete(id);
                flash('registrations.message', __('Deleted the account.'));
            } else throw new Error(__('Unknown action.'));
        } catch (error) {
            flash('registrations.error', isCmsError(error) || error instanceof Error ? (error as Error).message : __('The action failed.'));
        }
        return this.redirect('/dashboard/registrations');
    }

    render() {
        return html`<div class="space-y-6">
            ${pageHeader(__('Registrations'), { description: __('New accounts that wait for approval before they can sign in.') })}
            ${this.message ? notice(this.message, 'success') : null}
            ${this.error ? notice(this.error, 'error') : null}
            ${!this.required ? notice(__('Settings → General does not ask for approval now: new accounts are active at once. Accounts below still wait.'), 'info') : null}
            ${component(Card, {}, component(CardBody, { class: 'p-0' }, this.waiting.length ? html`<ul class="divide-y divide-border" data-testid="registrations">${this.waiting.map(entry => html`<li class="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm" data-registration=${entry.id}>
                <span><span class="font-medium text-foreground">${entry.name}</span> <span class="text-muted-foreground">${entry.email}</span>
                    <span class="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">${__('Registered')} ${shortDate(entry.createdAt)}
                        ${entry.verified ? component(Badge, { variant: 'secondary' }, __('Email confirmed')) : component(Badge, { variant: 'outline' }, __('Email not confirmed yet'))}</span></span>
                <span class="flex gap-2">${entry.verified ? actionButton('approve', __('Approve'), { id: entry.id }) : null}${actionButton('delete', __('Delete'), { id: entry.id }, { danger: true })}</span>
            </li>`)}</ul>` : html`<p class="px-4 py-6 text-sm text-muted-foreground">${__('No account waits for approval.')}</p>`))}
        </div>`;
    }
}
