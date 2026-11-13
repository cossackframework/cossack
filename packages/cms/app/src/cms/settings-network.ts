/**
 * The Network section of the main site's Settings page, for network admins: whether the install
 * runs a network of sites, and what new sites start with. It saves through the network, not the
 * site's settings document.
 */
import { Client, ClientState, Component, Cossack } from '@cossackframework/core';
import { Checkbox, Field, Input, NativeSelect } from '@cossackframework/ui';
import { html, type TemplateResult, component } from '@cossackframework/renderer';
import { isCmsError, type Principal } from '@cossackframework/cms';
import type { CmsNetwork, NetworkSettings, SiteExportPolicy } from '@cossackframework/cms/server';
import type { SettingsDraft } from './settings-draft';
import { notice } from './ui';

export interface NetworkSettingsInput {
    enabled: boolean;
    name: string;
    subdomainSuffix: string;
    defaultTheme: string;
    defaultPlugins: string[];
    defaultLanguage: string;
    siteExports: SiteExportPolicy;
}
export interface NetworkSettingsData extends NetworkSettingsInput {
    /** What new sites' addresses end with while `subdomainSuffix` is empty. */
    fallbackSuffix: string;
    /** Themes and plugins new sites may start with: those the network neither hides nor runs everywhere. */
    themes: { name: string; label: string }[];
    plugins: string[];
    /** Whether this install opens and creates site databases. */
    canAddSites: boolean;
    /** Added sites that answer while the network is on: active or archived. */
    sites: number;
}
export interface NetworkSettingsResult { data: NetworkSettingsData | null; error: string; fields: Record<string, string> }

export async function loadNetworkSettings(network: CmsNetwork): Promise<NetworkSettingsData> {
    const [settings, enabled, policy, status, active, archived] = await Promise.all([
        network.settings(), network.enabled(), network.policy(), network.main.status(),
        network.sites.list({ status: 'active', limit: 1 }), network.sites.list({ status: 'archived', limit: 1 }),
    ]);
    return {
        enabled, name: settings.name, subdomainSuffix: settings.subdomainSuffix, defaultTheme: settings.defaultTheme,
        defaultPlugins: [...settings.defaultPlugins], defaultLanguage: settings.defaultLanguage, siteExports: settings.siteExports, fallbackSuffix: network.subdomainSuffix,
        themes: network.main.themes().filter(theme => !theme.problems.length && !policy.hiddenThemes.has(theme.name)).map(theme => ({ name: theme.name, label: theme.label })),
        plugins: status.plugins.filter(plugin => !plugin.themeOnly && !plugin.unrestricted && plugin.network === 'available').map(plugin => plugin.name),
        canAddSites: network.canAddSites, sites: active.total + archived.total,
    };
}

/** Called by the authorized page; the network also checks that the principal is a network admin. */
export async function saveNetworkSettings(network: CmsNetwork, principal: Principal, input: NetworkSettingsInput): Promise<NetworkSettingsResult> {
    const text = (value: unknown) => typeof value === 'string';
    if (!input || typeof input.enabled !== 'boolean' || ![input.name, input.subdomainSuffix, input.defaultTheme, input.defaultLanguage].every(text)
        || !Array.isArray(input.defaultPlugins) || !input.defaultPlugins.every(text) || (input.siteExports !== 'request' && input.siteExports !== 'self')) return { data: null, error: __('The network settings are invalid.'), fields: {} };
    try {
        if (input.enabled !== await network.enabled()) await network.setEnabled(input.enabled, { principal });
        const patch: Partial<NetworkSettings> = {
            name: input.name, subdomainSuffix: input.subdomainSuffix.trim(), defaultTheme: input.defaultTheme,
            defaultPlugins: input.defaultPlugins, defaultLanguage: input.defaultLanguage.trim().toLowerCase(), siteExports: input.siteExports,
        };
        const saved = await network.settings();
        // Turning the network on or off leaves the rest alone, even when a stored value went stale.
        if (Object.entries(patch).some(([key, value]) => JSON.stringify(value) !== JSON.stringify(saved[key as keyof NetworkSettings]))) await network.saveSettings(patch, { principal });
        return { data: await loadNetworkSettings(network), error: '', fields: {} };
    } catch (error) {
        return { data: null, error: isCmsError(error) ? error.message : __('The network settings could not be saved.'), fields: isCmsError(error) ? { ...error.fields } : {} };
    }
}

export const networkDraft = (data: NetworkSettingsData): NetworkSettingsInput => ({
    enabled: data.enabled, name: data.name, subdomainSuffix: data.subdomainSuffix, defaultTheme: data.defaultTheme,
    defaultPlugins: [...data.defaultPlugins], defaultLanguage: data.defaultLanguage, siteExports: data.siteExports,
});

export type NetworkSettingsProps = {
    draft: SettingsDraft;
    initial: NetworkSettingsData;
    /** Matching search entries, as `network.<field>`; every field when absent. */
    fields?: readonly string[];
    /** Field problems from the last save, by field name. */
    errors?: Readonly<Record<string, string>>;
};

@Component()
export class NetworkSettingsForm extends Cossack {
    declare props: NetworkSettingsProps;
    @ClientState() private revision = 0;
    private unsubscribe?: () => void;

    onMount() {
        this.props.draft.initializeSection('network', networkDraft(this.props.initial));
        this.unsubscribe = this.props.draft.subscribe(() => { this.revision++; });
    }

    onCleanup() { this.unsubscribe?.(); }

    @Client()
    set(patch: Partial<NetworkSettingsInput>) {
        this.props.draft.setSection('network', { ...this.props.draft.section('network', networkDraft(this.props.initial)), ...patch });
    }

    @Client()
    togglePlugin(name: string, checked: boolean) {
        const current = this.props.draft.section('network', networkDraft(this.props.initial)).defaultPlugins;
        this.set({ defaultPlugins: checked ? [...new Set([...current, name])] : current.filter(entry => entry !== name) });
    }

    render() {
        const initial = this.props.initial;
        const form = this.props.draft.section('network', networkDraft(initial));
        const show = (field: string) => !this.props.fields || this.props.fields.includes(`network.${field}`);
        const errors = this.props.errors ?? {};
        const error = (name: string) => errors[name] ? html`<p role="alert" class="text-xs text-destructive">${errors[name]}</p>` : null;
        const input = (name: 'name' | 'subdomainSuffix' | 'defaultLanguage', label: string, hint: string, placeholder = ''): TemplateResult | null => show(name)
            ? component(Field, { label, for: `network-${name}`, hint, ...(errors[name] ? { error: errors[name] } : {}),
                control: attributes => component(Input, { ...attributes, '.value': form[name], placeholder, '@input': (event: Event) => this.set({ [name]: (event.target as HTMLInputElement).value }) }) })
            : null;
        const suffix = form.subdomainSuffix.trim() || initial.fallbackSuffix || 'example.com';
        return html`<fieldset class="min-w-0 space-y-5" ?disabled=${this.props.draft.saving}>
            ${show('enabled') ? component(Checkbox, { id: 'network-enabled', checked: form.enabled, '@change': (event: Event) => this.set({ enabled: (event.target as HTMLInputElement).checked }) },
                html`<span><span class="block font-medium">${__('Run a network of sites')}</span>
                    <span class="text-xs text-muted-foreground">${__('Each added site has its own database, address and members; accounts sign in once, here, for all of them. Network admins manage the sites under Network.')}</span></span>`) : null}
            ${form.enabled && !initial.canAddSites ? notice(__('Sites need their own databases: files beside the main one on Node, or ROMEDB_SITES_URL and ROMEDB_SITES_TOKEN (a RomeDB organization). Until then the network is this site only.')) : null}
            ${!form.enabled && initial.enabled && initial.sites ? notice(`${__('Turning the network off stops serving its other sites')} (${initial.sites}). ${__('Their databases stay: turn it on again to serve them.')}`, 'warning') : null}
            ${form.enabled ? html`
                ${input('name', __('Network name'), __('Shown on the network dashboard and the sign-in page.'))}
                ${input('subdomainSuffix', __('Addresses of new sites'), `${__('New sites start at a subdomain of this domain, such as blog.')}${suffix}. ${__('Point a wildcard DNS record at the network.')}`, initial.fallbackSuffix)}
                ${show('defaultTheme') || show('defaultPlugins') || show('defaultLanguage') ? html`<fieldset class="min-w-0 space-y-4">
                    <legend class="mb-2 text-base font-semibold text-foreground">${__('New sites')}</legend>
                    ${show('defaultTheme') ? component(Field, { label: __('Theme'), for: 'network-defaultTheme', ...(errors.defaultTheme ? { error: errors.defaultTheme } : {}),
                        control: attributes => component(NativeSelect, { ...attributes, '@change': (event: Event) => this.set({ defaultTheme: (event.target as HTMLSelectElement).value }) }, html`
                            <option value="" ?selected=${!form.defaultTheme}>${__('The first available theme')}</option>
                            ${initial.themes.map(theme => html`<option value=${theme.name} ?selected=${theme.name === form.defaultTheme}>${theme.label}</option>`)}`) }) : null}
                    ${show('defaultPlugins') && initial.plugins.length ? html`<div class="space-y-1.5">
                        <p class="text-sm font-medium text-foreground">${__('Plugins enabled on new sites')}</p>
                        ${initial.plugins.map(name => html`<div>${component(Checkbox, { label: name, checked: form.defaultPlugins.includes(name), '@change': (event: Event) => this.togglePlugin(name, (event.target as HTMLInputElement).checked) })}</div>`)}
                        <p class="text-xs text-muted-foreground">${__('Network active plugins run on every site already.')}</p>${error('defaultPlugins')}
                    </div>` : null}
                    ${input('defaultLanguage', __('Language'), __('A language code, such as en, fr or pt-br. Add site can choose another.'), 'en')}
                </fieldset>` : null}
                ${show('siteExports') ? html`<fieldset class="min-w-0 space-y-2">
                    <legend class="mb-2 text-base font-semibold text-foreground">${__('Site exports')}</legend>
                    ${([['request', __('Site admins request an export; a network admin approves it'), __('The site can then download it under Tools → Export for 7 days. Requests wait on the site\'s page under Network → Sites.')],
                        ['self', __('Site admins export their own site'), __('Tools → Export downloads the site\'s database at once.')]] as const).map(([value, label, hint]) => html`<label class="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3 has-[:checked]:border-primary">
                        <input type="radio" name="network-siteExports" class="mt-1" .checked=${form.siteExports === value} @change=${() => this.set({ siteExports: value })}>
                        <span><span class="block text-sm font-medium text-foreground">${label}</span><span class="text-xs text-muted-foreground">${hint}</span></span>
                    </label>`)}${error('siteExports')}
                </fieldset>` : null}` : null}
        </fieldset>`;
    }
}
