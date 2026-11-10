import { Client, ClientState, Cossack, Page, Server, State, type HeadValue } from '@cossackframework/core';
import { Button, Card, CardBody, CardHeader, Field, IconPicker, Input } from '@cossackframework/ui';
import { component, html, repeat } from '@cossackframework/renderer';
import { applyDashboardMenu, dashboardLinkModuleId, dashboardMenuOf, dashboardMenuProblems, DASHBOARD_MENU_LIMITS, isCmsError, PERMISSIONS, type DashboardMenu, type DashboardMenuLink } from '@cossackframework/cms';
import { requireAny } from '../../../../../cms/guards';
import { iconButton, notice, pageHeader } from '../../../../../cms/ui';
import { defaultNavigation } from '../../../../../dashboard/access';
import { ICON_CATALOG } from '../../../../../cms/icons';

interface Row { id: string; label: string; href: string; link: boolean }

/** Icons a custom link may carry, from the dashboard's set. */
/**
 * Appearance → Dashboard menu: administrators arrange the dashboard's navigation for everyone.
 * Modules can be hidden and reordered, and links added (to a dashboard screen, a page of the site
 * or another address). Stored in the `dashboard.menu` setting; each user still sees only the
 * modules their permissions allow, in this order. The account menu is not part of it.
 */
@Page({ transport: 'http', middlewares: [requireAny(PERMISSIONS.manageAppearance)] })
export default class DashboardMenuPage extends Cossack {
    /** The default modules of the administrator editing, as the sidebar would show them without a menu. */
    @State() modules: Row[] = [];
    @State() menu: DashboardMenu = { order: [], hidden: [], links: [] };
    @State() draft: { label: string; href: string; icon: string } = { label: '', href: '', icon: 'link' };
    @State() error = '';
    @State() message = '';
    @State() dirty = false;
    /** A drag in progress: the row dragged, where it would land (an index among the rows), the drop line's offset, and whether the pointer moved. */
    @ClientState() drag: { from: number; to: number; y: number; moved: boolean } | null = null;
    private pointer: { id: number; x: number; y: number; tops: number[]; bottoms: number[] } | null = null;
    private list?: HTMLElement;
    private rowElements = new Map<string, HTMLElement>();

    head(): HeadValue {
        return { title: 'Dashboard menu' };
    }

    async init() {
        await this.load();
    }

    @Server()
    async load() {
        const cms = this.c.get('cms');
        const [modules, stored] = await Promise.all([defaultNavigation(this.c), cms.settings.get('dashboard.menu').catch(() => null)]);
        // As the sidebar lists them: no account modules, and a module nested in its parent's menu (Roles under Users) is not a row of its own.
        const top = modules.filter(module => module.placement !== 'account');
        this.modules = top.filter(module => !module.parent || !top.some(other => other.id === module.parent)).map(module => ({ id: module.id, label: module.label, href: module.href, link: false }));
        this.menu = dashboardMenuOf(stored);
        this.dirty = false;
    }

    @Server()
    async save(menu: DashboardMenu) {
        this.error = '';
        const problems = dashboardMenuProblems(menu);
        if (problems.length) { this.error = problems.join(' '); return; }
        try {
            await this.c.get('cms').settings.update('dashboard', { menu: { order: menu.order, hidden: menu.hidden, links: menu.links } }, { principal: this.c.get('principal') });
            await this.load();
            this.message = __('Dashboard menu saved. The sidebar shows the new order after a reload.');
        } catch (error) {
            if (!isCmsError(error)) throw error;
            this.error = error.message;
        }
    }

    /** Every row in the menu's order, hidden ones included, so they can be shown again. */
    private rows(): Row[] {
        return applyDashboardMenu(this.modules, { ...this.menu, hidden: [] }, link => ({ id: dashboardLinkModuleId(link), label: link.label, href: link.href, link: true }));
    }

    @Client()
    private update(menu: DashboardMenu) {
        this.menu = menu;
        this.dirty = true;
        this.message = '';
    }

    @Client()
    private move(id: string, by: -1 | 1) {
        const ids = this.rows().map(row => row.id);
        const index = ids.indexOf(id);
        const target = index + by;
        if (index < 0 || target < 0 || target >= ids.length) return;
        [ids[index], ids[target]] = [ids[target]!, ids[index]!];
        this.update({ ...this.menu, order: ids });
        requestAnimationFrame(() => (this.rowElements.get(id)?.querySelector('[data-handle]') as HTMLElement | null)?.focus());
    }

    /** Place the row at `from` before the row at `to` (counting without the dragged row). */
    @Client()
    private place(from: number, to: number) {
        const ids = this.rows().map(row => row.id);
        const [id] = ids.splice(from, 1);
        ids.splice(to, 0, id!);
        this.update({ ...this.menu, order: ids });
    }

    @Client()
    private rowRef(id: string, element: Element | undefined) {
        if (element) this.rowElements.set(id, element as HTMLElement); else this.rowElements.delete(id);
    }

    @Client()
    private startDrag(event: PointerEvent, index: number) {
        if (event.button !== 0 || !this.list) return;
        event.preventDefault();
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
        const top = this.list.getBoundingClientRect().top;
        const rects = this.rows().map(row => this.rowElements.get(row.id)?.getBoundingClientRect());
        this.pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, tops: rects.map(rect => (rect?.top ?? 0) - top), bottoms: rects.map(rect => (rect?.bottom ?? 0) - top) };
        this.drag = { from: index, to: index, y: 0, moved: false };
    }

    @Client()
    private moveDrag(event: PointerEvent) {
        const pointer = this.pointer;
        const drag = this.drag;
        if (!pointer || !drag || event.pointerId !== pointer.id || !this.list) return;
        if (!drag.moved && Math.abs(event.clientY - pointer.y) < 4 && Math.abs(event.clientX - pointer.x) < 4) return;
        const y = event.clientY - this.list.getBoundingClientRect().top;
        // The rows other than the dragged one, in order; the drop goes before the first whose middle is below the pointer.
        const rest = pointer.tops.map((_, index) => index).filter(index => index !== drag.from);
        let to = 0;
        while (to < rest.length && (pointer.tops[rest[to]!]! + pointer.bottoms[rest[to]!]!) / 2 < y) to++;
        const line = to < rest.length ? pointer.tops[rest[to]!]! : pointer.bottoms[rest.at(-1) ?? 0] ?? 0;
        if (drag.to !== to || !drag.moved) this.drag = { ...drag, to, y: line - 2, moved: true };
        if (event.clientY < 60) window.scrollBy(0, -12);
        else if (event.clientY > window.innerHeight - 60) window.scrollBy(0, 12);
    }

    @Client()
    private endDrag(event: PointerEvent) {
        const drag = this.drag;
        if (!this.pointer || event.pointerId !== this.pointer.id) return;
        this.pointer = null;
        this.drag = null;
        if (!drag?.moved || drag.to === drag.from) return;
        this.place(drag.from, drag.to);
    }

    @Client()
    private cancelDrag() {
        this.pointer = null;
        this.drag = null;
    }

    @Client()
    private handleKey(event: KeyboardEvent, id: string) {
        if (event.key === 'Escape' && this.drag) { this.cancelDrag(); return; }
        const by = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
        if (!by) return;
        event.preventDefault();
        this.move(id, by);
    }

    @Client()
    private toggle(id: string) {
        const hidden = this.menu.hidden.includes(id) ? this.menu.hidden.filter(entry => entry !== id) : [...this.menu.hidden, id];
        this.update({ ...this.menu, hidden });
    }

    @Client()
    private removeLink(id: string) {
        const moduleId = dashboardLinkModuleId({ id });
        this.update({ order: this.menu.order.filter(entry => entry !== moduleId), hidden: this.menu.hidden.filter(entry => entry !== moduleId), links: this.menu.links.filter(link => link.id !== id) });
    }

    @Client()
    private addLink(event: Event) {
        event.preventDefault();
        const label = this.draft.label.trim();
        const href = this.draft.href.trim();
        if (!label || !href) return;
        const base = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'link';
        let id = base;
        for (let n = 2; this.menu.links.some(link => link.id === id); n++) id = `${base}-${n}`;
        const link: DashboardMenuLink = { id, label, href, icon: this.draft.icon };
        const problems = dashboardMenuProblems({ links: [link] });
        if (problems.length) { this.error = problems.join(' '); return; }
        this.error = '';
        // New links take their place at the end of the current order.
        this.update({ ...this.menu, order: [...this.rows().map(row => row.id), dashboardLinkModuleId(link)], links: [...this.menu.links, link] });
        this.draft = { label: '', href: '', icon: 'link' };
    }

    @Client()
    private reset() {
        this.update({ order: [], hidden: [], links: [] });
    }

    render() {
        const rows = this.rows();
        const field = (key: 'label' | 'href', label: string, extra: Record<string, unknown> = {}) => component(Field, { label, for: `menu-link-${key}`, control: attributes => component(Input, { ...attributes, ...extra, '.value': this.draft[key], '@input': (event: Event) => { this.draft = { ...this.draft, [key]: (event.target as HTMLInputElement).value }; } }) });
        return html`<div class="space-y-6">
            ${pageHeader(__('Dashboard menu'), { description: __('Arrange the sidebar for everyone: hide modules, change their order and add links. Each person still sees only what their role allows.') })}
            ${this.message ? notice(this.message, 'success') : null}
            ${this.error ? notice(this.error, 'error') : null}
            <div class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
                ${component(Card, {}, html`${component(CardHeader, { class: 'flex items-center justify-between gap-2' }, html`<h2 class="text-base font-semibold text-foreground">${__('Menu')}</h2>
                        <span class="flex gap-2">${component(Button, { type: 'button', variant: 'outline', size: 'sm', '@click': () => this.reset() }, __('Reset to default'))}${component(Button, { type: 'button', size: 'sm', disabled: !this.dirty, '@click': () => this.save(this.menu) }, __('Save'))}</span>`)}
                    ${component(CardBody, { class: 'p-0' }, html`<p id="dashboard-menu-help" class="px-4 pt-3 text-xs text-muted-foreground">${__('Drag the handles to reorder. On a handle, the arrow keys move the item.')}</p>
                    <div class="relative" ref=${(element: Element) => { this.list = element as HTMLElement | undefined; }}>
                    <ol class="divide-y divide-border" aria-label=${__('Dashboard menu items')}>${repeat(rows, row => row.id, (row, index) => {
                        const hidden = this.menu.hidden.includes(row.id);
                        const linkId = row.link ? row.id.slice('link-'.length) : '';
                        const dragging = this.drag?.moved && this.drag.from === index;
                        return html`<li class=${`flex flex-wrap items-center gap-2 px-2 py-2 text-sm transition-opacity ${hidden ? 'opacity-60' : ''} ${dragging ? 'opacity-40' : ''}`} data-menu-row=${row.id} ref=${(element: Element) => this.rowRef(row.id, element)}>
                            <button type="button" class="flex h-8 w-6 shrink-0 cursor-grab touch-none items-center justify-center rounded border-none bg-transparent text-muted-foreground hover:bg-muted active:cursor-grabbing"
                                aria-label=${`${__('Move')} ${row.label}. ${__('Drag, or use the arrow keys.')}`} aria-describedby="dashboard-menu-help" data-handle
                                @pointerdown=${(event: PointerEvent) => this.startDrag(event, index)} @pointermove=${(event: PointerEvent) => this.moveDrag(event)}
                                @pointerup=${(event: PointerEvent) => this.endDrag(event)} @pointercancel=${() => this.cancelDrag()} @lostpointercapture=${() => this.cancelDrag()}
                                @keydown=${(event: KeyboardEvent) => this.handleKey(event, row.id)}>
                                <svg aria-hidden="true" viewBox="0 0 10 16" class="h-4 w-2.5 fill-current"><circle cx="2" cy="2" r="1.5"/><circle cx="8" cy="2" r="1.5"/><circle cx="2" cy="8" r="1.5"/><circle cx="8" cy="8" r="1.5"/><circle cx="2" cy="14" r="1.5"/><circle cx="8" cy="14" r="1.5"/></svg>
                            </button>
                            <span class="min-w-0 flex-1">
                                <span class=${`font-medium ${hidden ? 'line-through text-muted-foreground' : 'text-foreground'}`}>${__(row.label)}</span>
                                <span class="ml-2 text-xs text-muted-foreground">${row.href}</span>
                            </span>
                            <span class="flex items-center gap-1">
                                ${iconButton(`menu-${row.id}-hide`, hidden ? 'eye-closed' : 'eye', hidden ? `${__('Show')} ${row.label}` : `${__('Hide')} ${row.label}`, () => this.toggle(row.id), { pressed: hidden })}
                                ${row.link ? iconButton(`menu-${row.id}-remove`, 'trash-bin-trash', `${__('Remove')} ${row.label}`, () => this.removeLink(linkId), { danger: true }) : null}
                            </span>
                        </li>`;
                    })}</ol>
                    ${this.drag?.moved ? html`<div aria-hidden="true" class="pointer-events-none absolute inset-x-2 h-1 rounded-full bg-primary" style=${`top: ${this.drag.y}px`}></div>` : null}
                    </div>`)}`)}
                ${component(Card, {}, html`${component(CardHeader, {}, html`<h2 class="text-base font-semibold text-foreground">${__('Add a link')}</h2>`)}
                    ${component(CardBody, {}, html`<form class="space-y-4" @submit=${(event: Event) => this.addLink(event)}>
                        ${field('label', __('Label'), { required: true, maxlength: DASHBOARD_MENU_LIMITS.label })}
                        ${field('href', __('Address'), { required: true, placeholder: '/dashboard/tools/health or https://…' })}
                        ${component(Field, { label: __('Icon'), for: 'menu-link-icon-picker', control: () => component(IconPicker, { id: 'menu-link-icon', value: this.draft.icon, icons: ICON_CATALOG, label: __('Icon'), allowEmpty: false, onChange: (name: string) => { this.draft = { ...this.draft, icon: name }; } }) })}
                        ${component(Button, { type: 'submit', variant: 'outline', disabled: this.menu.links.length >= DASHBOARD_MENU_LIMITS.links }, __('Add link'))}
                        <p class="text-xs text-muted-foreground">${__('Links show for everyone who can open the dashboard. Save the menu to keep them.')}</p>
                    </form>`)}`)}
            </div>
        </div>`;
    }
}
