import { Cossack, Page, State, flash, flashed, type HeadValue } from '@cossackframework/core';
import { Card, CardBody } from '@cossackframework/ui';
import { html, component } from '@cossackframework/renderer';
import { isCmsError, isSameOriginPost, NETWORK_ADMIN } from '@cossackframework/cms';
import { notice, pageHeader } from '../../../../../../cms/ui';
import { requireNetworkAdmin } from '../../../../../../cms/guards';
import { network } from '../../../../../../cms/network-ui';
import { field, submitButton } from '../../../../../../cms/network-view';

interface NewAccountForm { name: string; email: string; admin: boolean }

/** Add account: a person who signs in to the network. Sites are added on the account's page. */
@Page({ transport: 'http', middlewares: [requireNetworkAdmin()] })
export default class NewNetworkUser extends Cossack {
    @State() form: NewAccountForm = { name: '', email: '', admin: false };
    @State() error = '';

    head(): HeadValue {
        return { title: 'Add account' };
    }

    async init() {
        // A failed attempt comes back with what was typed, except the password.
        this.form = flashed<NewAccountForm>('network.account') ?? this.form;
        this.error = flashed<string>('network.error') ?? '';
    }

    async post() {
        if (!isSameOriginPost(this.c.req.raw)) return this.c.text('Forbidden', 403);
        const data = await this.c.req.formData();
        const value = (name: string) => String(data.get(name) ?? '').trim();
        const form: NewAccountForm = { name: value('name'), email: value('email'), admin: data.get('admin') === 'on' };
        try {
            const account = await network(this.c).main.accounts.create({ email: form.email, name: form.name || form.email.split('@')[0]!, password: String(data.get('password') ?? ''),
                ...(form.admin ? { networkRole: NETWORK_ADMIN } : {}) });
            flash('network.message', `${account.name} ${__('can sign in now. Add them to sites below.')}`);
            return this.redirect(`/dashboard/network/users/${account.id}`);
        } catch (error) {
            flash('network.error', isCmsError(error) ? error.message : __('The account could not be added.'));
            flash('network.account', form);
            return this.redirect('/dashboard/network/users/new');
        }
    }

    render() {
        return html`<div class="space-y-6">
            ${pageHeader(__('Add account'), {
                description: __('A person who signs in once, on this host, for every site they are a member of.'),
                actions: html`<a href="/dashboard/network/users" class="text-sm text-muted-foreground hover:text-foreground">← ${__('Users')}</a>`,
            })}
            ${this.error ? notice(this.error, 'error') : null}
            ${component(Card, { class: 'max-w-xl' }, component(CardBody, {}, html`
                <form method="post" class="space-y-4">
                    ${field('name', __('Name'), { value: this.form.name })}
                    ${field('email', __('Email'), { type: 'email', value: this.form.email, required: true })}
                    ${field('password', __('Password'), { type: 'password', required: true, hint: __('At least 8 characters.') })}
                    <label class="flex items-start gap-2 text-sm text-foreground"><input type="checkbox" name="admin" class="mt-0.5 size-4 accent-primary" ?checked=${this.form.admin}>
                        <span><span class="font-medium">${__('Network admin')}</span><span class="block text-xs text-muted-foreground">${__('Runs every site and the network dashboard.')}</span></span></label>
                    <div class="flex items-center gap-2">
                        ${submitButton(__('Add account'))}
                        <a href="/dashboard/network/users" class="inline-flex items-center justify-center rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground no-underline hover:bg-muted">${__('Cancel')}</a>
                    </div>
                </form>`))}
        </div>`;
    }
}
