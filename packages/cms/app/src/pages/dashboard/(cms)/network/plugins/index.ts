import { Cossack, Page, State, flash, flashed, type HeadValue } from '@cossackframework/core';
import { Badge, Card, CardBody } from '@cossackframework/ui';
import { html, component } from '@cossackframework/renderer';
import { isCmsError, isSameOriginPost } from '@cossackframework/cms';
import type { NetworkPluginState } from '@cossackframework/cms/server';
import { artwork, notice, pageHeader } from '../../../../../cms/ui';
import { requireNetworkAdmin } from '../../../../../cms/guards';
import { network } from '../../../../../cms/network-ui';
import { actionButton } from '../../../../../cms/network-view';

interface NetworkPluginRow {
    name: string;
    version: string;
    description: string;
    logo: string | null;
    state: NetworkPluginState;
    /** What the manifest requests. */
    requests: string[];
    /** Requested since a network admin approved it; only for a network-active plugin. */
    unapproved: string[];
    problem: string;
}

const STATES: Record<NetworkPluginState, { label: string; variant: 'success' | 'secondary' | 'outline' }> = {
    network: { label: 'Network active', variant: 'success' },
    available: { label: 'Available', variant: 'secondary' },
    hidden: { label: 'Hidden', variant: 'outline' },
};

/**
 * Network → Plugins: one state per plugin for every site. Network active plugins run on every
 * site with the grants approved here; available ones are each site's choice; hidden ones are
 * not offered. Themes are under Network → Themes.
 */
@Page({ transport: 'http', middlewares: [requireNetworkAdmin()] })
export default class NetworkPlugins extends Cossack {
    @State() plugins: NetworkPluginRow[] = [];
    @State() message = '';
    @State() error = '';

    head(): HeadValue {
        return { title: 'Network plugins' };
    }

    async init() {
        const status = await network(this.c).main.status();
        this.plugins = status.plugins.filter(plugin => !plugin.themeOnly).map(plugin => ({
            name: plugin.name, version: plugin.version, description: plugin.description, logo: plugin.logo, state: plugin.network, requests: [...plugin.requests],
            unapproved: plugin.network === 'network' ? [...plugin.missing] : [],
            problem: plugin.reason?.startsWith('Invalid manifest') ? plugin.reason : '',
        }));
        this.message = flashed<string>('network.message') ?? '';
        this.error = flashed<string>('network.error') ?? '';
    }

    async post() {
        if (!isSameOriginPost(this.c.req.raw)) return this.c.text('Forbidden', 403);
        const form = await this.c.req.formData();
        const name = String(form.get('plugin') ?? '');
        const state = (['network', 'available', 'hidden'] as const).find(entry => entry === form.get('action'));
        try {
            if (!state) throw new Error('Choose a state.');
            const status = await network(this.c).setPluginState(name, state, { principal: this.c.get('principal') });
            flash('network.message', state === 'network' ? `${name}: ${status.active ? __('active on every site.') : status.reason ?? ''}` : `${name}: ${__(STATES[state].label).toLowerCase()}.`);
        } catch (error) {
            flash('network.error', isCmsError(error) ? error.message : `${name} could not be changed.`);
        }
        return this.redirect('/dashboard/network/plugins');
    }

    render() {
        const th = 'px-3 py-2 font-medium';
        return html`<div class="max-w-5xl space-y-6">
            ${pageHeader(__('Network plugins'), { description: __('Plugin code ships with the application. Choose for every site whether a plugin runs everywhere, is each site\'s choice, or stays hidden.') })}
            ${this.message ? notice(this.message, 'success') : null}
            ${this.error ? notice(this.error, 'error') : null}
            ${this.plugins.length ? component(Card, {}, component(CardBody, { class: 'p-0' }, html`<div class="overflow-x-auto"><table class="w-full text-sm">
                <thead><tr class="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th class=${th}>${__('Plugin')}</th><th class=${th}>${__('Requests')}</th><th class=${th}>${__('State')}</th><th class=${`${th} text-right`}>${__('Actions')}</th>
                </tr></thead>
                <tbody>${this.plugins.map(plugin => html`<tr data-plugin=${plugin.name} data-state=${plugin.state} class="border-b border-border last:border-0 align-top">
                    <td class="px-3 py-3"><div class="flex min-w-[12rem] items-center gap-3">
                        ${artwork('logo', plugin.logo, plugin.name, plugin.name)}
                        <div class="min-w-0">
                            <p class="truncate font-semibold text-foreground">${plugin.name}</p>
                            <p class="text-xs text-muted-foreground">${__('version')} ${plugin.version}</p>
                            ${plugin.description ? html`<p class="mt-1 text-xs text-muted-foreground">${plugin.description}</p>` : null}
                        </div>
                    </div></td>
                    <td class="px-3 py-3 text-xs text-muted-foreground">
                        ${plugin.requests.join(', ')}
                        ${plugin.unapproved.length ? html`<p class="mt-1 text-warning-text">${__('Not approved yet')}: ${plugin.unapproved.join(', ')}</p>` : null}
                        ${plugin.problem ? html`<p class="mt-1 text-destructive">${plugin.problem}</p>` : null}
                    </td>
                    <td class="px-3 py-3">${component(Badge, { variant: STATES[plugin.state].variant }, __(STATES[plugin.state].label))}</td>
                    <td class="px-3 py-3"><div class="flex flex-wrap justify-end gap-2">
                        ${plugin.state !== 'network' || plugin.unapproved.length ? actionButton('network', plugin.state === 'network' ? __('Approve and keep active') : __('Network activate'), { plugin: plugin.name }) : null}
                        ${plugin.state !== 'available' ? actionButton('available', plugin.state === 'network' ? __('Network deactivate') : __('Make available'), { plugin: plugin.name }) : null}
                        ${plugin.state !== 'hidden' ? actionButton('hidden', __('Hide'), { plugin: plugin.name }, { danger: true }) : null}
                    </div></td>
                </tr>`)}</tbody></table></div>`)) : html`<p class="text-sm text-muted-foreground">${__('No plugins. Render one with')} <code>cossack add plugin</code>.</p>`}
            <p class="text-xs text-muted-foreground">${__('Network activate approves everything the plugin requests, for every site; an upgrade that requests more waits here. Each site migrates it when it next loads. Network deactivate leaves it to each site again, with the site\'s own grant.')}</p>
        </div>`;
    }
}
