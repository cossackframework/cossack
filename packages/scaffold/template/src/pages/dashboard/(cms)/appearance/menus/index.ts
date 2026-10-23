import { Cossack, Page, State, Server, Client, type HeadValue } from '@cossackframework/core';
import { AlertDialog, Badge, Button, Card, CardBody, Field, Input, NativeSelect, toast } from '@cossackframework/ui';
import { html, component } from '@cossackframework/renderer';
import { isCmsError, PERMISSIONS } from '@cossackframework/cms';
import { requireAny } from '../../../../../cms/guards';
import { notice, pageHeader, shortDate } from '../../../../../cms/ui';

interface MenuRow { id: string; name: string; items: number; locations: string[]; updatedAt: number }
interface LocationRow { name: string; label: string; theme: string; active: boolean; menu: string }

/** Menus and where the theme shows them. A new menu opens in the menu editor. */
@Page({ transport: 'http', middlewares: [requireAny(PERMISSIONS.manageAppearance)] })
export default class MenusPage extends Cossack {
    @State() menus: MenuRow[] = [];
    @State() locations: LocationRow[] = [];
    @State() name = '';
    @State() errors: Record<string, string> = {};
    @State() error = '';
    @State() pendingDelete: MenuRow | null = null;

    head(): HeadValue {
        return { title: __('Menus') };
    }

    async init() {
        await this.load();
    }

    @Server()
    async load() {
        const cms = this.c.get('cms');
        const assigned = await cms.menus.locations();
        this.menus = (await cms.menus.list()).map(menu => ({ ...menu, locations: [...menu.locations] }));
        this.locations = (await cms.menuLocations()).map(location => ({ ...location, menu: assigned.get(location.name) ?? '' }));
    }

    @Client()
    async submit(event: Event) {
        event.preventDefault();
        await this.create(this.name);
        if (this.error) toast.error(this.error);
    }

    @Server()
    async create(name: string) {
        this.errors = {};
        this.error = '';
        try {
            const menu = await this.c.get('cms').menus.create({ name }, { principal: this.c.get('principal') });
            return this.redirect(`/dashboard/appearance/menus/${menu.id}`);
        } catch (error) {
            this.errors = isCmsError(error) && error.fields ? { ...error.fields } : {};
            this.error = isCmsError(error) ? error.message : __('The menu could not be created.');
        }
    }

    @Client()
    setLocation(name: string, menu: string) {
        this.locations = this.locations.map(location => location.name === name ? { ...location, menu } : location);
    }

    @Client()
    async saveLocations() {
        await this.assign(this.locations.map(location => ({ name: location.name, menu: location.menu })));
        if (this.error) toast.error(this.error); else toast.success(__('Menu locations saved.'));
    }

    @Server()
    async assign(locations: { name: string; menu: string }[]) {
        this.error = '';
        const cms = this.c.get('cms');
        const known = (await cms.menuLocations()).map(location => location.name);
        try {
            for (const location of locations) await cms.menus.assign(location.name, location.menu || null, { principal: this.c.get('principal'), known });
        } catch (error) { this.error = isCmsError(error) ? error.message : __('The locations could not be saved.'); }
        await this.load();
    }

    @Server()
    async remove(id: string) {
        this.error = '';
        try { await this.c.get('cms').menus.delete(id, { principal: this.c.get('principal') }); }
        catch (error) { this.error = isCmsError(error) ? error.message : __('The menu could not be deleted.'); }
        await this.load();
    }

    render() {
        const label = (name: string) => this.locations.find(location => location.name === name)?.label ?? name;
        return html`<div class="space-y-6">
            ${pageHeader(__('Menus'), { description: __('Build menus from pages, posts, categories and links, then choose where the theme shows them.') })}
            ${this.error ? notice(this.error, 'error') : null}
            <div class="grid gap-6 lg:grid-cols-[22rem_minmax(0,1fr)]">
                <div class="space-y-6">
                    ${component(Card, {}, component(CardBody, {}, html`
                        <h2 class="mb-4 text-base font-semibold text-foreground">${__('Create a menu')}</h2>
                        <form class="space-y-4" @submit=${(event: Event) => this.submit(event)}>
                            ${component(Field, { label: __('Menu name'), for: 'menu-name', error: this.errors.name, hint: __('Only you see this name, such as Main menu or Footer links.'),
                                control: attributes => component(Input, { ...attributes, '.value': this.name, '@input': (event: Event) => { this.name = (event.target as HTMLInputElement).value; } }) })}
                            ${component(Button, { type: 'submit', disabled: !this.name.trim() }, __('Create menu'))}
                        </form>`))}
                    ${component(Card, {}, component(CardBody, {}, html`
                        <h2 class="mb-1 text-base font-semibold text-foreground">${__('Menu locations')}</h2>
                        <p class="mb-4 text-xs text-muted-foreground">${__('Where the active theme shows menus. Locations of other themes keep their menus for when you switch.')}</p>
                        ${this.locations.length ? html`<div class="space-y-3">
                            ${this.locations.map(location => component(Field, { label: location.active ? location.label : `${location.label} (${location.theme})`, for: `location-${location.name}`,
                                control: attributes => component(NativeSelect, { ...attributes, '@change': (event: Event) => this.setLocation(location.name, (event.target as HTMLSelectElement).value) }, html`
                                    <option value="" ?selected=${!location.menu}>— ${__('No menu')} —</option>
                                    ${this.menus.map(menu => html`<option value=${menu.id} ?selected=${menu.id === location.menu}>${menu.name}</option>`)}`) }))}
                            ${component(Button, { type: 'button', variant: 'outline', '@click': () => this.saveLocations() }, __('Save locations'))}
                        </div>` : html`<p class="text-sm text-muted-foreground">${__('The active theme has no menu locations.')}</p>`}`))}
                </div>
                ${component(Card, {}, component(CardBody, { class: 'p-0' }, html`<div class="overflow-x-auto"><table class="w-full text-sm">
                    <thead><tr class="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <th class="px-3 py-2 font-medium">${__('Name')}</th><th class="px-3 py-2 font-medium">${__('Locations')}</th>
                        <th class="px-3 py-2 text-right font-medium">${__('Items')}</th><th class="px-3 py-2 font-medium">${__('Last modified')}</th>
                    </tr></thead>
                    <tbody>${this.menus.map(menu => html`<tr class="group border-b border-border last:border-0 align-top">
                        <td class="px-3 py-2">
                            <a href=${`/dashboard/appearance/menus/${menu.id}`} class="font-medium text-foreground hover:text-primary no-underline">${menu.name}</a>
                            <div class="mt-1 flex gap-2 text-xs opacity-80 group-hover:opacity-100">
                                <a href=${`/dashboard/appearance/menus/${menu.id}`} class="text-primary hover:underline">${__('Edit')}</a><span aria-hidden="true" class="text-muted-foreground">|</span>
                                <button type="button" class="text-destructive hover:underline bg-transparent border-none p-0 cursor-pointer" @click=${() => { this.pendingDelete = menu; }}>${__('Delete')}</button>
                            </div>
                        </td>
                        <td class="px-3 py-2"><span class="flex flex-wrap gap-1">${menu.locations.length ? menu.locations.map(name => component(Badge, { variant: 'secondary' }, label(name))) : html`<span class="text-muted-foreground">—</span>`}</span></td>
                        <td class="px-3 py-2 text-right text-muted-foreground">${menu.items}</td>
                        <td class="px-3 py-2 text-muted-foreground">${shortDate(menu.updatedAt)}</td>
                    </tr>`)}</tbody>
                </table>${this.menus.length ? null : html`<p class="px-4 py-10 text-center text-sm text-muted-foreground">${__('No menus yet. Create one to start.')}</p>`}</div>`))}
            </div>
            ${component(AlertDialog, {
                id: 'delete-menu-dialog', open: this.pendingDelete !== null, title: __('Delete menu?'),
                description: this.pendingDelete ? `“${this.pendingDelete.name}” ${__('and its items are deleted. Locations that showed it fall back to the theme default.')}` : '',
                cancelLabel: __('Cancel'), actionLabel: __('Delete'), actionVariant: 'destructive',
                onAction: () => { const menu = this.pendingDelete; this.pendingDelete = null; if (menu) void this.remove(menu.id); },
                onOpenChange: () => { this.pendingDelete = null; },
            })}
        </div>`;
    }
}
