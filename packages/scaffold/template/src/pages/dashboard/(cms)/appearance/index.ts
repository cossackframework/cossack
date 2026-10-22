import { Cossack, Page, State, Server, Client, type HeadValue } from '@cossackframework/core';
import { Badge, Button, Card, CardBody, toast } from '@cossackframework/ui';
import { html, component } from '@cossackframework/renderer';
import { isCmsError, PERMISSIONS } from '@cossackframework/cms';
import { requireAny } from '../../../../cms/guards';
import { artwork, linkButton, notice, pageHeader } from '../../../../cms/ui';

interface ThemeRow { name: string; label: string; description: string; version: string; author: string; authorUrl: string; locations: string[]; parent: string; options: boolean; problems: string[]; active: boolean; logo: string | null; cover: string | null }

/** Themes, WordPress style: every theme plugin as a card, the active one first. */
@Page({ transport: 'http', middlewares: [requireAny(PERMISSIONS.manageAppearance)] })
export default class ThemesPage extends Cossack {
    @State() themes: ThemeRow[] = [];
    @State() error = '';

    head(): HeadValue {
        return { title: __('Themes') };
    }

    async init() {
        await this.load();
    }

    @Server()
    async load() {
        const cms = this.c.get('cms');
        const active = await cms.activeTheme();
        const labels = new Map(cms.themes().map(theme => [theme.name, theme.label]));
        this.themes = cms.themes().map(theme => ({
            name: theme.name, label: theme.label, description: theme.description, version: theme.version, author: theme.author, authorUrl: theme.authorUrl, locations: theme.locations.map(location => location.label),
            parent: theme.parent ? labels.get(theme.parent) ?? theme.parent : '',
            options: Boolean(theme.options), problems: [...theme.problems], active: theme.name === active, logo: theme.logo, cover: theme.cover,
        })).sort((a, b) => Number(b.active) - Number(a.active));
    }

    @Server()
    async activate(name: string) {
        this.error = '';
        try { await this.c.get('cms').activateTheme(name, this.c.get('principal')); }
        catch (error) { this.error = isCmsError(error) ? error.message : __('The theme could not be activated.'); }
        await this.load();
    }

    @Client()
    async choose(theme: ThemeRow) {
        await this.activate(theme.name);
        if (this.error) toast.error(this.error); else toast.success(`${theme.label} ${__('is now the active theme.')}`);
    }

    render() {
        return html`<div class="space-y-6">
            ${pageHeader(__('Themes'), {
                description: __('A theme is a plugin that draws the public site. Add one with cossack add plugin, or copy src/plugins/default-theme to start your own.'),
                actions: html`${linkButton(__('Customize'), '/dashboard/appearance/customize', 'outline')}${linkButton(__('Menus'), '/dashboard/appearance/menus', 'outline')}`,
            })}
            ${this.error ? notice(this.error, 'error') : null}
            ${this.themes.length ? html`<ul class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">${this.themes.map(theme => html`<li>
                ${component(Card, { class: `overflow-hidden ${theme.active ? 'ring-2 ring-primary' : ''}` }, html`
                    ${artwork('cover', theme.cover, theme.name, theme.label, 'aspect-[4/3] border-b border-border')}
                    ${component(CardBody, { class: 'space-y-3 pt-5' }, html`
                    <div class="flex items-start justify-between gap-3">
                        <div class="flex min-w-0 items-center gap-4">
                            ${artwork('logo', theme.logo, theme.name, theme.label)}
                            <div class="min-w-0">
                                <h2 class="truncate text-base font-semibold text-foreground">${theme.label}</h2>
                                <p class="text-xs text-muted-foreground">${theme.name} · ${__('version')} ${theme.version}</p>
                                ${theme.author ? html`<p class="text-xs text-muted-foreground">${__('By')} ${theme.authorUrl ? html`<a href=${theme.authorUrl} target="_blank" rel="noopener noreferrer" class="text-primary hover:underline">${theme.author}</a>` : theme.author}</p>` : null}
                            </div>
                        </div>
                        ${theme.active ? component(Badge, { variant: 'success' }, __('Active')) : theme.problems.length ? component(Badge, { variant: 'destructive' }, __('Broken')) : null}
                    </div>
                    ${theme.description ? html`<p class="text-sm text-muted-foreground">${theme.description}</p>` : null}
                    ${theme.parent ? html`<p class="text-xs text-muted-foreground">${__('Child theme of')} ${theme.parent}</p>` : null}
                    ${theme.locations.length ? html`<p class="text-xs text-muted-foreground">${__('Menu locations')}: ${theme.locations.join(', ')}</p>` : null}
                    ${theme.problems.length ? html`<ul role="alert" class="list-disc space-y-1 pl-5 text-xs text-destructive">${theme.problems.map(problem => html`<li>${problem}</li>`)}</ul>` : null}
                    <div class="flex flex-wrap gap-2 pt-1">
                        ${theme.active
                            ? html`${theme.options ? linkButton(__('Customize'), '/dashboard/appearance/customize') : null}<a href="/" target="_blank" rel="noopener" class="inline-flex items-center rounded-md px-4 py-2 text-sm text-primary hover:underline">${__('View site')} ↗</a>`
                            : component(Button, { type: 'button', size: 'sm', disabled: theme.problems.length > 0, '@click': () => this.choose(theme) }, __('Activate'))}
                    </div>`)}`)}
            </li>`)}</ul>` : notice(__('No themes are installed. The site uses plain built-in templates until you add one.'))}
        </div>`;
    }
}
