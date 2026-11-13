import { Cossack, Page, State, flash, flashed, type HeadValue } from '@cossackframework/core';
import { Badge, Card, CardBody } from '@cossackframework/ui';
import { html, component } from '@cossackframework/renderer';
import { isCmsError, isSameOriginPost } from '@cossackframework/cms';
import { artwork, notice, pageHeader } from '../../../../../cms/ui';
import { requireNetworkAdmin } from '../../../../../cms/guards';
import { network } from '../../../../../cms/network-ui';
import { actionButton } from '../../../../../cms/network-view';

interface NetworkThemeRow {
    name: string;
    label: string;
    version: string;
    description: string;
    logo: string | null;
    hidden: boolean;
    problems: string[];
}

/** Network → Themes: which themes sites may choose under Appearance. */
@Page({ transport: 'http', middlewares: [requireNetworkAdmin()] })
export default class NetworkThemes extends Cossack {
    @State() themes: NetworkThemeRow[] = [];
    @State() message = '';
    @State() error = '';

    head(): HeadValue {
        return { title: 'Network themes' };
    }

    async init() {
        const net = network(this.c);
        const hidden = (await net.policy()).hiddenThemes;
        this.themes = net.main.themes().map(theme => ({
            name: theme.name, label: theme.label, version: theme.version, description: theme.description, logo: theme.logo, hidden: hidden.has(theme.name), problems: [...theme.problems],
        }));
        this.message = flashed<string>('network.message') ?? '';
        this.error = flashed<string>('network.error') ?? '';
    }

    async post() {
        if (!isSameOriginPost(this.c.req.raw)) return this.c.text('Forbidden', 403);
        const form = await this.c.req.formData();
        const name = String(form.get('theme') ?? '');
        const state = (['available', 'hidden'] as const).find(entry => entry === form.get('action'));
        try {
            if (!state) throw new Error('Choose a state.');
            await network(this.c).setThemeState(name, state, { principal: this.c.get('principal') });
            flash('network.message', state === 'hidden' ? `${name}: ${__('hidden from every site.')}` : `${name}: ${__('available to every site.')}`);
        } catch (error) {
            flash('network.error', isCmsError(error) ? error.message : `${name} could not be changed.`);
        }
        return this.redirect('/dashboard/network/themes');
    }

    render() {
        const th = 'px-3 py-2 font-medium';
        return html`<div class="max-w-5xl space-y-6">
            ${pageHeader(__('Network themes'), { description: __('Sites choose their theme under Appearance from the themes available here. A site whose theme is hidden falls back to another.') })}
            ${this.message ? notice(this.message, 'success') : null}
            ${this.error ? notice(this.error, 'error') : null}
            ${this.themes.length ? component(Card, {}, component(CardBody, { class: 'p-0' }, html`<div class="overflow-x-auto"><table class="w-full text-sm">
                <thead><tr class="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th class=${th}>${__('Theme')}</th><th class=${th}>${__('State')}</th><th class=${`${th} text-right`}>${__('Actions')}</th>
                </tr></thead>
                <tbody>${this.themes.map(theme => html`<tr data-theme=${theme.name} data-state=${theme.hidden ? 'hidden' : 'available'} class="border-b border-border last:border-0 align-top">
                    <td class="px-3 py-3"><div class="flex min-w-[12rem] items-center gap-3">
                        ${artwork('logo', theme.logo, theme.label, theme.name)}
                        <div class="min-w-0">
                            <p class="truncate font-semibold text-foreground">${theme.label}</p>
                            <p class="text-xs text-muted-foreground">${theme.name} · ${__('version')} ${theme.version}</p>
                            ${theme.problems.length ? html`<p class="mt-1 text-xs text-destructive">${theme.problems.join(' ')}</p>` : null}
                        </div>
                    </div></td>
                    <td class="px-3 py-3">${component(Badge, { variant: theme.hidden ? 'outline' : 'secondary' }, theme.hidden ? __('Hidden') : __('Available'))}</td>
                    <td class="px-3 py-3"><div class="flex justify-end gap-2">
                        ${theme.hidden ? actionButton('available', __('Make available'), { theme: theme.name }) : actionButton('hidden', __('Hide'), { theme: theme.name }, { danger: true })}
                    </div></td>
                </tr>`)}</tbody></table></div>`)) : html`<p class="text-sm text-muted-foreground">${__('No themes. Copy src/plugins/default-theme to start one.')}</p>`}
        </div>`;
    }
}
