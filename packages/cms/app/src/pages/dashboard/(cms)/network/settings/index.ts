import { Cossack, Page, State, flash, flashed, type HeadValue } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';
import { isCmsError, isSameOriginPost } from '@cossackframework/cms';
import { CONTROL, notice, pageHeader } from '../../../../../cms/ui';
import { requireNetworkAdmin } from '../../../../../cms/guards';
import { network } from '../../../../../cms/network-ui';
import { field, SUBMIT } from '../../../../../cms/network-view';

/** Network → Settings: the network's name, the address new sites start at, and what they start with. */
@Page({ transport: 'http', middlewares: [requireNetworkAdmin()] })
export default class NetworkSettings extends Cossack {
    @State() name = '';
    @State() suffix = '';
    @State() fallback = '';
    @State() defaultTheme = '';
    @State() defaultPlugins: string[] = [];
    @State() defaultLanguage = '';
    /** Themes and plugins sites may use: those the network does not hide or already runs everywhere. */
    @State() themes: { name: string; label: string }[] = [];
    @State() plugins: string[] = [];
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
        this.defaultTheme = settings.defaultTheme;
        this.defaultPlugins = [...settings.defaultPlugins];
        this.defaultLanguage = settings.defaultLanguage;
        const hidden = (await net.policy()).hiddenThemes;
        this.themes = net.main.themes().filter(theme => !theme.problems.length && !hidden.has(theme.name)).map(theme => ({ name: theme.name, label: theme.label }));
        this.plugins = (await net.main.status()).plugins.filter(plugin => !plugin.themeOnly && plugin.network === 'available').map(plugin => plugin.name);
        this.message = flashed<string>('network.message') ?? '';
        this.error = flashed<string>('network.error') ?? '';
    }

    async post() {
        if (!isSameOriginPost(this.c.req.raw)) return this.c.text('Forbidden', 403);
        const form = await this.c.req.formData();
        try {
            await network(this.c).saveSettings({
                name: String(form.get('name') ?? ''), subdomainSuffix: String(form.get('subdomainSuffix') ?? '').trim(),
                defaultTheme: String(form.get('defaultTheme') ?? ''), defaultPlugins: form.getAll('defaultPlugins').map(String), defaultLanguage: String(form.get('defaultLanguage') ?? '').trim().toLowerCase(),
            }, { principal: this.c.get('principal') });
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
                <fieldset class="space-y-4 border-t border-border pt-4">
                    <legend class="pt-4 text-sm font-semibold text-foreground">${__('New sites')}</legend>
                    <div class="space-y-1.5">
                        <label for="network-defaultTheme" class="block text-sm font-medium text-foreground">${__('Theme')}</label>
                        <select id="network-defaultTheme" name="defaultTheme" class=${CONTROL}>
                            <option value="" ?selected=${!this.defaultTheme}>${__('The first available theme')}</option>
                            ${this.themes.map(theme => html`<option value=${theme.name} ?selected=${theme.name === this.defaultTheme}>${theme.label}</option>`)}
                        </select>
                    </div>
                    ${this.plugins.length ? html`<div class="space-y-1.5">
                        <p class="text-sm font-medium text-foreground">${__('Plugins enabled on new sites')}</p>
                        ${this.plugins.map(name => html`<label class="flex items-center gap-2 text-sm text-foreground"><input type="checkbox" name="defaultPlugins" value=${name} ?checked=${this.defaultPlugins.includes(name)} class="size-4 accent-primary"> ${name}</label>`)}
                        <p class="text-xs text-muted-foreground">${__('Network active plugins run on every site already.')}</p>
                    </div>` : null}
                    ${field('defaultLanguage', __('Language'), { value: this.defaultLanguage, placeholder: 'en', hint: __('A language code, such as en, fr or pt-br. Add site can choose another.') })}
                </fieldset>
                <button type="submit" class=${SUBMIT}>${__('Save')}</button>
            </form>
        </div>`;
    }
}
