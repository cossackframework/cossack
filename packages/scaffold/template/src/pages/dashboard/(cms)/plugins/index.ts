import { Cossack, Page, State, flash, flashed, type HeadValue } from '@cossackframework/core';
import { Badge, Card, CardBody } from '@cossackframework/ui';
import { html, component } from '@cossackframework/renderer';
import { isCmsError, isSameOriginPost, PERMISSIONS } from '@cossackframework/cms';
import { requireAny } from '../../../../cms/guards';
import { artwork, notice, pageHeader } from '../../../../cms/ui';

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

/**
 * Plugins rendered into src/plugins/. A plugin runs only after its schema is migrated and an
 * administrator grants what its manifest requests; an upgrade that requests more needs a new grant.
 * Themes alone have nothing to grant and are chosen under Appearance.
 */
@Page({ transport: 'http', middlewares: [requireAny(PERMISSIONS.managePlugins)] })
export default class PluginsPage extends Cossack {
    @State() plugins: PluginRow[] = [];
    @State() message = '';

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
        const name = String(form.get('plugin') ?? '');
        const cms = this.c.get('cms');
        const principal = this.c.get('principal');
        try {
            if (form.get('_action') === 'disable') {
                await cms.revokePlugin(name, principal);
                flash('cms.message', `Disabled ${name}.`);
            } else {
                const status = await cms.grantPlugin(name, principal);
                flash('cms.message', status.active ? `Enabled ${name}.` : `Granted ${name}. ${status.reason ?? ''}`);
            }
        } catch (error) {
            flash('cms.message', isCmsError(error) ? error.message : 'The plugin could not be changed.');
        }
        return this.redirect('/dashboard/plugins');
    }

    render() {
        const button = 'inline-flex items-center justify-center rounded-md px-3 py-1.5 text-sm font-medium cursor-pointer';
        return html`<div class="space-y-6">
            ${pageHeader(__('Plugins'), { description: __('A plugin runs after its schema is applied and you grant what it requests.') })}
            ${this.message ? notice(this.message) : null}
            ${this.plugins.length ? null : html`<p class="text-sm text-muted-foreground">${__('No plugins. Render one with')} <code>cossack add plugin</code>.</p>`}
            <ul class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">${this.plugins.map(plugin => html`<li data-plugin=${plugin.name} data-version=${plugin.version} data-active=${plugin.active ? 'true' : 'false'}>${component(Card, { class: 'flex h-full flex-col overflow-hidden' }, html`
                ${artwork('cover', plugin.cover, plugin.name, plugin.name, 'aspect-[2/1] border-b border-border')}
                ${component(CardBody, { class: 'flex flex-1 flex-col gap-3 pt-5' }, html`
                    <div class="flex items-start justify-between gap-3">
                        <div class="flex min-w-0 items-center gap-4">
                            ${artwork('logo', plugin.logo, plugin.name, plugin.name)}
                            <div class="min-w-0">
                                <p class="truncate text-sm font-semibold text-foreground">${plugin.name}</p>
                                <p class="text-xs text-muted-foreground">${__('version')} ${plugin.version}${plugin.author ? html` · ${__('by')} ${plugin.authorUrl ? html`<a href=${plugin.authorUrl} target="_blank" rel="noopener noreferrer" class="text-primary hover:underline">${plugin.author}</a>` : plugin.author}` : null}</p>
                            </div>
                        </div>
                        ${plugin.themeOnly ? component(Badge, { variant: 'secondary' }, __('Theme'))
                            : component(Badge, { variant: plugin.active ? 'success' : 'secondary' }, plugin.active ? __('Active') : __('Inactive'))}
                    </div>
                    ${plugin.description ? html`<p class="text-sm text-muted-foreground">${plugin.description}</p>` : null}
                    ${plugin.reason ? html`<p class="text-sm text-muted-foreground">${plugin.reason}</p>` : null}
                    ${plugin.missing.length ? html`<p class="text-xs text-muted-foreground">${__('Requests')}: ${plugin.missing.join(', ')}</p>` : null}
                    <div class="mt-auto">
                        ${plugin.themeOnly ? html`<a href="/dashboard/appearance" class="text-sm text-primary hover:underline">${__('Manage in Appearance')} →</a>` : html`<form method="post" class="flex gap-2">
                            <input type="hidden" name="plugin" value=${plugin.name}>
                            ${plugin.missing.length ? html`<button type="submit" name="_action" value="grant" class=${`${button} bg-primary text-primary-foreground border-none`}>${__('Grant and enable')}</button>` : null}
                            ${plugin.active ? html`<button type="submit" name="_action" value="disable" class=${`${button} border border-destructive bg-transparent text-destructive`}>${__('Disable')}</button>` : null}
                        </form>`}
                    </div>`)}`)}</li>`)}</ul>
        </div>`;
    }
}
