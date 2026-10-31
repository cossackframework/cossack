import { Client, ClientState, Cossack, Page, State, flash, flashed, type HeadValue } from '@cossackframework/core';
import { Badge, Card, CardBody, Input, NativeSelect } from '@cossackframework/ui';
import { html, component } from '@cossackframework/renderer';
import { isCmsError, isSameOriginPost, PERMISSIONS } from '@cossackframework/cms';
import { requireAny } from '../../../../cms/guards';
import { artwork, authorLine, notice, pageHeader } from '../../../../cms/ui';

interface PluginRow {
    name: string;
    version: string;
    description: string;
    author: string;
    authorUrl: string;
    logo: string | null;
    cover: string | null;
    themeOnly: boolean;
    active: boolean;
    reason: string;
    missing: string[];
}

type PluginFilter = 'all' | 'active' | 'inactive' | 'themes';

/**
 * Plugins rendered into src/plugins/, as a table with search, a status filter and bulk
 * enable and disable (a plain form, so it works without JavaScript). A plugin runs only after its schema is migrated and an
 * administrator grants what its manifest requests; an upgrade that requests more needs a new grant.
 * Themes alone have nothing to grant and are chosen under Appearance.
 */
@Page({ transport: 'http', middlewares: [requireAny(PERMISSIONS.managePlugins)] })
export default class PluginsPage extends Cossack {
    @State() plugins: PluginRow[] = [];
    @State() message = '';
    @ClientState() search = '';
    @ClientState() filter: PluginFilter = 'all';

    head(): HeadValue {
        return { title: 'Plugins' };
    }

    async init() {
        const status = await this.c.get('cms').status();
        this.plugins = status.plugins.map(plugin => ({
            name: plugin.name, version: plugin.version, description: plugin.description, author: plugin.author, authorUrl: plugin.authorUrl, logo: plugin.logo, cover: plugin.cover, themeOnly: plugin.themeOnly,
            active: plugin.active, reason: plugin.reason ?? '', missing: [...plugin.missing],
        }));
        this.message = flashed<string>('cms.message') ?? '';
    }

    async post() {
        if (!isSameOriginPost(this.c.req.raw)) return this.c.text('Forbidden', 403);
        const form = await this.c.req.formData();
        // A row's button names its plugin and action (`grant:name`); the bulk bar sends the checked `plugins` and `_action`.
        const row = String(form.get('_row') ?? '');
        const action = row ? row.slice(0, row.indexOf(':')) : String(form.get('_action') ?? '');
        const names = row ? [row.slice(row.indexOf(':') + 1)] : [...new Set([...form.getAll('plugins'), form.get('plugin')].map(value => String(value ?? '')).filter(Boolean))];
        const cms = this.c.get('cms');
        const principal = this.c.get('principal');
        if (action !== 'grant' && action !== 'disable') { flash('cms.message', 'Choose an action.'); return this.redirect('/dashboard/plugins'); }
        const messages: string[] = [];
        for (const name of names.slice(0, 100)) {
            try {
                if (action === 'disable') {
                    await cms.revokePlugin(name, principal);
                    messages.push(`Disabled ${name}.`);
                } else {
                    const status = await cms.grantPlugin(name, principal);
                    messages.push(status.active ? `Enabled ${name}.` : `Granted ${name}. ${status.reason ?? ''}`.trim());
                }
            } catch (error) {
                messages.push(isCmsError(error) ? error.message : `${name} could not be changed.`);
            }
        }
        flash('cms.message', messages.length ? messages.join(' ') : 'Select at least one plugin.');
        return this.redirect('/dashboard/plugins');
    }

    @Client()
    setSearch(value: string) {
        this.search = value;
    }

    @Client()
    setFilter(value: string) {
        this.filter = (['all', 'active', 'inactive', 'themes'] as const).find(entry => entry === value) ?? 'all';
    }

    private shown(plugin: PluginRow): boolean {
        if (this.filter === 'themes' ? !plugin.themeOnly : this.filter === 'active' ? plugin.themeOnly || !plugin.active : this.filter === 'inactive' ? plugin.themeOnly || plugin.active : false) return false;
        const words = this.search.trim().toLowerCase().split(/\s+/).filter(Boolean);
        const text = [plugin.name, plugin.description, plugin.author].join(' ').toLowerCase();
        return words.every(word => text.includes(word));
    }

    render() {
        const button = 'inline-flex items-center justify-center rounded-md px-2.5 py-1 text-xs font-medium cursor-pointer';
        const counts = { all: this.plugins.length, active: this.plugins.filter(plugin => !plugin.themeOnly && plugin.active).length, inactive: this.plugins.filter(plugin => !plugin.themeOnly && !plugin.active).length, themes: this.plugins.filter(plugin => plugin.themeOnly).length };
        const labels: Record<PluginFilter, string> = { all: __('All'), active: __('Active'), inactive: __('Inactive'), themes: __('Themes') };
        const rows = this.plugins.filter(plugin => this.shown(plugin));
        const th = 'px-3 py-2 font-medium';
        return html`<div class="space-y-6">
            ${pageHeader(__('Plugins'), { description: __('A plugin runs after its schema is applied and you grant what it requests.') })}
            ${this.message ? notice(this.message) : null}
            ${this.plugins.length ? html`<form method="post" class="space-y-3" id="plugins-form">
                <div class="flex flex-wrap items-center justify-between gap-3">
                    <div class="flex flex-wrap items-center gap-2">
                        <div class="w-44">${component(NativeSelect, { name: '_action', size: 'sm', 'aria-label': __('Bulk actions') }, html`
                            <option value="">${__('Bulk actions')}</option><option value="grant">${__('Grant and enable')}</option><option value="disable">${__('Disable')}</option>`)}</div>
                        <button type="submit" class=${`${button} border border-border bg-background text-foreground hover:bg-muted`}>${__('Apply')}</button>
                    </div>
                    <div class="flex flex-wrap items-center gap-2">
                        <div class="w-36">${component(NativeSelect, { size: 'sm', 'aria-label': __('Show'), '@change': (event: Event) => this.setFilter((event.target as HTMLSelectElement).value) }, html`
                            ${(['all', 'active', 'inactive', 'themes'] as const).map(entry => html`<option value=${entry} ?selected=${this.filter === entry}>${labels[entry]} (${counts[entry]})</option>`)}`)}</div>
                        <div class="w-56">${component(Input, { type: 'search', size: 'sm', placeholder: __('Search plugins'), 'aria-label': __('Search plugins'), '.value': this.search,
                            '@input': (event: Event) => this.setSearch((event.target as HTMLInputElement).value) })}</div>
                    </div>
                </div>
                ${component(Card, {}, component(CardBody, { class: 'p-0' }, html`<div class="overflow-x-auto"><table class="w-full text-sm">
                    <thead><tr class="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <th class="w-10 px-3 py-2"><span class="sr-only">${__('Select')}</span></th><th class=${th}>${__('Plugin')}</th><th class=${th}>${__('Description')}</th><th class=${th}>${__('Status')}</th><th class=${`${th} text-right`}>${__('Actions')}</th>
                    </tr></thead>
                    <tbody>${rows.map(plugin => html`<tr data-plugin=${plugin.name} data-version=${plugin.version} data-active=${plugin.active ? 'true' : 'false'} class="border-b border-border last:border-0 align-top">
                        <td class="px-3 py-3">${plugin.themeOnly ? null : html`<input type="checkbox" name="plugins" value=${plugin.name} aria-label=${`${__('Select')} ${plugin.name}`} class="size-4 cursor-pointer accent-primary">`}</td>
                        <td class="px-3 py-3"><div class="flex min-w-[12rem] items-center gap-3">
                            ${artwork('logo', plugin.logo, plugin.name, plugin.name)}
                            <div class="min-w-0">
                                <p class="truncate font-semibold text-foreground">${plugin.name}</p>
                                <p class="text-xs text-muted-foreground">${__('version')} ${plugin.version}</p>
                                ${authorLine(plugin.author, plugin.authorUrl)}
                            </div>
                        </div></td>
                        <td class="px-3 py-3 text-muted-foreground">
                            ${plugin.description ? html`<p>${plugin.description}</p>` : null}
                            ${plugin.reason ? html`<p class="mt-1">${plugin.reason}</p>` : null}
                            ${plugin.missing.length ? html`<p class="mt-1 text-xs">${__('Requests')}: ${plugin.missing.join(', ')}</p>` : null}
                        </td>
                        <td class="px-3 py-3">${plugin.themeOnly ? component(Badge, { variant: 'secondary' }, __('Theme'))
                            : component(Badge, { variant: plugin.active ? 'success' : 'secondary' }, plugin.active ? __('Active') : __('Inactive'))}</td>
                        <td class="px-3 py-3"><div class="flex flex-wrap justify-end gap-2">
                            ${plugin.themeOnly ? html`<a href="/dashboard/appearance" class="text-sm text-primary hover:underline">${__('Manage in Appearance')} →</a>` : html`
                                ${plugin.missing.length ? html`<button type="submit" name="_row" value=${`grant:${plugin.name}`} class=${`${button} bg-primary text-primary-foreground border-none`}>${__('Grant and enable')}</button>` : null}
                                ${plugin.active ? html`<button type="submit" name="_row" value=${`disable:${plugin.name}`} class=${`${button} border border-destructive bg-transparent text-destructive`}>${__('Disable')}</button>` : null}`}
                        </div></td>
                    </tr>`)}</tbody></table>
                    ${rows.length ? null : html`<p role="status" class="px-4 py-10 text-center text-sm text-muted-foreground">${__('No plugins match.')}</p>`}</div>`))}
            </form>` : html`<p class="text-sm text-muted-foreground">${__('No plugins. Render one with')} <code>cossack add plugin</code>.</p>`}
        </div>`;
    }
}
