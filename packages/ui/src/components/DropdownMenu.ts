import { html, classMap } from '@cossackframework/renderer';
import { Cossack, Component, Client, createRef, type RefObject } from '@cossackframework/core';
import type { ButtonAttributes, ControlEvent } from '../native-attributes';
import { MenuController, menuEvent, menuIdentity, renderMenuItems, type MenuItem, type MenuPanelProps } from '../internal/menu';

export type DropdownMenuProps = Omit<ButtonAttributes, 'id' | 'type' | 'role' | 'popovertarget' | 'popovertargetaction' | 'aria-haspopup' | 'aria-expanded' | 'aria-controls'> & {
    /** Stable page-unique button ID; menu ID is `${id}-menu`. */
    id: string;
    trigger?: unknown;
    side?: 'top' | 'bottom' | 'left' | 'right';
    align?: 'start' | 'center' | 'end';
    items?: readonly MenuItem[];
    block?: boolean;
    /** Native panel attributes/events. By default its name comes from the trigger. */
    menuProps?: MenuPanelProps;
};
/** Single-level action menu. Custom children must author role=menuitem and tabindex=-1. */
@Component()
export class DropdownMenu extends Cossack {
    declare props: DropdownMenuProps;
    menuRef: RefObject<HTMLDivElement> = createRef<HTMLDivElement>();
    private triggerElement?: HTMLButtonElement;
    private menu = new MenuController(() => ({ side: this.props.side, align: this.props.align }));
    render() {
        const { id, trigger, side = 'bottom', align = 'start', items = [], block = false, menuProps = {}, ...rest } = this.props;
        menuIdentity(id);
        if (!['top','bottom','left','right'].includes(side)) throw new Error('DropdownMenu side must be top, bottom, left or right.');
        if (!['start','center','end'].includes(align)) throw new Error('DropdownMenu align must be start, center or end.');
        const panel = { ...menuProps,
            'aria-labelledby': menuProps['aria-labelledby'] ?? (menuProps['aria-label'] ? undefined : id),
            '@keydown': menuEvent<ControlEvent<HTMLDivElement, KeyboardEvent>>(menuProps['@keydown'], event => this.menu.key(event)),
            '@click': menuEvent<ControlEvent<HTMLDivElement, PointerEvent>>(menuProps['@click'], event => this.menu.click(event)),
        };
        return html`<div class=${classMap({ 'cs-dropdown-menu__wrapper relative': true, 'inline-flex': !block, 'flex w-full': block })}>
            <button ref=${(element: Element) => { this.triggerElement = element as HTMLButtonElement; }} id=${id} type="button"
                popovertarget=${`${id}-menu`} popovertargetaction="toggle" aria-haspopup="menu" aria-expanded=${String(this.menu.expanded)} aria-controls=${`${id}-menu`}
                class="cs-dropdown-menu__trigger flex items-center cursor-pointer w-full text-left disabled:opacity-50 disabled:cursor-not-allowed"
                ...=${{ ...rest, '@keydown': menuEvent<ControlEvent<HTMLButtonElement, KeyboardEvent>>(rest['@keydown'], event => this.menu.triggerKey(event)) }}>${trigger}</button>
            <div ref=${(element: Element) => { this.menuRef.value = element as HTMLDivElement; if (this.triggerElement) this.menu.attach(element as HTMLDivElement, this.triggerElement); }}
                id=${`${id}-menu`} role="menu" tabindex="-1" popover="auto" class="cs-dropdown-menu bg-popover text-popover-foreground border rounded-md shadow-lg p-1 min-w-[180px] outline-none"
                ...=${panel}>${renderMenuItems(items, 'cs-dropdown-menu')}${this.children}</div>
        </div>`;
    }
    @Client() showMenu() { this.menu.open(); }
    @Client() closeMenu() { this.menu.close(); }
    onCleanup() { this.menu.disconnect(); this.menuRef.value = undefined; this.triggerElement = undefined; }
}
