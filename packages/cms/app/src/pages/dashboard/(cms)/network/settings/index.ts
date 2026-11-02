import { Cossack, Page, State, flash, flashed, type HeadValue } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';
import { isCmsError, isSameOriginPost } from '@cossackframework/cms';
import { notice, pageHeader } from '../../../../../cms/ui';
import { field, network, requireNetworkAdmin, SUBMIT } from '../../../../../cms/network-ui';

/** Network → Settings: the network's name and the address new sites start at. */
@Page({ transport: 'http', middlewares: [requireNetworkAdmin()] })
export default class NetworkSettings extends Cossack {
    @State() name = '';
    @State() suffix = '';
    @State() fallback = '';
    @State() message = '';
    @State() error = '';

    head(): HeadValue {
        return { title: 'Network settings' };
    }

    async init() {
        const net = network(this.c);
        const settings = await net.settings();
        this.name = settings.name;
        this.suffix = settings.subdomainSuffix;
        this.fallback = net.subdomainSuffix;
        this.message = flashed<string>('network.message') ?? '';
        this.error = flashed<string>('network.error') ?? '';
    }

    async post() {
        if (!isSameOriginPost(this.c.req.raw)) return this.c.text('Forbidden', 403);
        const form = await this.c.req.formData();
        try {
            await network(this.c).saveSettings({ name: String(form.get('name') ?? ''), subdomainSuffix: String(form.get('subdomainSuffix') ?? '').trim() }, { principal: this.c.get('principal') });
            flash('network.message', __('Saved.'));
        } catch (error) {
            flash('network.error', isCmsError(error) ? error.message : 'The settings could not be saved.');
        }
        return this.redirect('/dashboard/network/settings');
    }

    render() {
        return html`<div class="max-w-xl space-y-6">
            ${pageHeader(__('Network settings'))}
            ${this.message ? notice(this.message, 'success') : null}
            ${this.error ? notice(this.error, 'error') : null}
            <form method="post" class="space-y-4">
                ${field('name', __('Network name'), { value: this.name, hint: __('Shown on the network dashboard.') })}
                ${field('subdomainSuffix', __('Addresses of new sites'), { value: this.suffix, placeholder: this.fallback, hint: `${__('New sites start at a subdomain of this domain, such as blog.')}${this.suffix || this.fallback || 'example.com'}. ${__('Point a wildcard DNS record at the network.')}` })}
                <button type="submit" class=${SUBMIT}>${__('Save')}</button>
            </form>
        </div>`;
    }
}
