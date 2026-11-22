import { Cossack, Page, Server, State, type HeadValue } from '@cossackframework/core';
import { Badge, Button, Card, CardBody } from '@cossackframework/ui';
import { html, component } from '@cossackframework/renderer';
import { approveRegistration, deleteRegistration, registrationApproval, registrations, type Registration } from '#app/auth';
import { guard } from '#app/services/rbac';
import { timeAgo } from '#app/dashboard/time-ago';
import { notice, pageHeader } from '@cossackframework/ui/blocks';

/**
 * Users → Registrations: the accounts that wait before they can sign in, for their email's
 * confirmation or for an administrator's approval (src/dashboard.config.ts: `registration`).
 * Approve one to let them sign in (they get an email), or delete it.
 */
@Page({ transport: 'http', middlewares: [guard.requireRole('admin')] })
export default class RegistrationsPage extends Cossack {
    @State() waiting: Registration[] = [];
    @State() required = false;
    @State() message = '';
    @State() error = '';
    /** The request's time, so the server and the browser render the same ages. */
    @State() now = 0;

    head(): HeadValue {
        return { title: 'Registrations' };
    }

    async init() {
        this.now = Date.now();
        this.required = await registrationApproval();
        this.waiting = await registrations();
    }

    @Server()
    async approve(id: string) {
        this.message = ''; this.error = '';
        if (await approveRegistration(String(id))) this.message = 'Approved. They can sign in now and got an email saying so.';
        else this.error = 'This account does not wait for approval.';
        this.waiting = await registrations();
    }

    @Server()
    async remove(id: string) {
        this.message = ''; this.error = '';
        if (await deleteRegistration(String(id))) this.message = 'Deleted the account.';
        else this.error = 'This account does not wait any more.';
        this.waiting = await registrations();
    }

    render() {
        return html`<div class="space-y-6">
            ${pageHeader(__('Registrations'), { description: __('New accounts that wait before they can sign in.') })}
            ${this.message ? notice(this.message, 'success') : null}
            ${this.error ? notice(this.error, 'error') : null}
            ${!this.required ? notice(__('The project does not ask for approval now: new accounts are active once their email is confirmed. Accounts below still wait.'), 'info') : null}
            ${component(Card, {}, component(CardBody, { class: 'p-0' }, this.waiting.length ? html`<ul class="divide-y divide-border" data-testid="registrations">${this.waiting.map(entry => html`<li class="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                <span><span class="font-medium text-foreground">${entry.name}</span> <span class="text-muted-foreground">${entry.email}</span>
                    <span class="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">${__('Registered')} ${timeAgo(new Date(entry.createdAt).toISOString(), this.now)}
                        ${entry.verified ? component(Badge, { variant: 'secondary' }, __('Email confirmed')) : component(Badge, { variant: 'outline' }, __('Email not confirmed yet'))}</span></span>
                <span class="flex gap-2">
                    ${entry.verified ? component(Button, { size: 'sm', '@click': () => this.approve(entry.id) }, __('Approve')) : null}
                    ${component(Button, { size: 'sm', variant: 'outline', '@click': () => this.remove(entry.id) }, __('Delete'))}
                </span>
            </li>`)}</ul>` : html`<p class="px-4 py-6 text-sm text-muted-foreground">${__('No account waits.')}</p>`))}
        </div>`;
    }
}
