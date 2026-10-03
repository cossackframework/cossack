import { html } from '@cossackframework/renderer';
import { Cossack, Component, Client } from '@cossackframework/core';
import type { GlobalAttributes, ControlEvent } from '../native-attributes';
import { MenuController, menuEvent, menuIdentity, renderMenuItems, type MenuItem, type MenuPanelProps } from '../internal/menu';

export type ContextMenuItem = MenuItem;
export type ContextMenuProps = Omit<GlobalAttributes<HTMLDivElement>, 'id' | 'aria-haspopup' | 'aria-expanded' | 'aria-controls' | 'aria-disabled'> & {
    /** Stable page-unique context region ID. */
    id: string;
    /** Accessible menu name, distinct from the context region's name. */
    menuLabel: string;
    items?: readonly ContextMenuItem[];
    disabled?: boolean;
    menuProps?: MenuPanelProps;
};
/** Context action menu with pointer and Shift+F10/ContextMenu-key activation. */
@Component()
export class ContextMenu extends Cossack {
    declare props: ContextMenuProps;
    private contextElement?: HTMLDivElement;
    private menu = new MenuController(() => ({ context: true, disabled: this.props.disabled }));
    render() {
        const { id, menuLabel, items = [], disabled = false, menuProps = {}, ...rest } = this.props;
        menuIdentity(id);
        if (typeof menuLabel !== 'string' || !menuLabel.trim()) throw new Error('ContextMenu requires a nonempty menuLabel.');
        const context = { ...rest,
            '@contextmenu': menuEvent<ControlEvent<HTMLDivElement, PointerEvent>>(rest['@contextmenu'], event => {
                if (disabled || (event.target as Element).closest('[role="menu"]')) return;
                event.preventDefault();
                const target = (event.target as Element).closest<HTMLElement>('button,a[href],input,textarea,select,[tabindex]') ?? this.contextElement;
                target?.focus({ preventScroll: true });
                this.menu.open(false, { x: event.clientX, y: event.clientY }, target);
            }),
            '@keydown': menuEvent<ControlEvent<HTMLDivElement, KeyboardEvent>>(rest['@keydown'], event => {
                if (disabled || (event.target as Element).closest('[role="menu"]')) return;
                if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
                    event.preventDefault(); event.stopPropagation();
                    this.menu.open(false, undefined, event.target as HTMLElement);
                }
            }),
        };
        const panel = { ...menuProps, 'aria-label': menuProps['aria-label'] ?? (menuProps['aria-labelledby'] ? undefined : menuLabel),
            '@keydown': menuEvent<ControlEvent<HTMLDivElement, KeyboardEvent>>(menuProps['@keydown'], event => this.menu.key(event)),
            '@click': menuEvent<ControlEvent<HTMLDivElement, PointerEvent>>(menuProps['@click'], event => this.menu.click(event)),
        };
        return html`<div ref=${(element: Element) => { this.contextElement = element as HTMLDivElement; }} id=${id} tabindex="0"
            aria-haspopup="menu" aria-expanded=${String(this.menu.expanded)} aria-controls=${`${id}-menu`} aria-disabled=${disabled ? 'true' : undefined}
            class="cs-context-menu relative inline-block" ...=${context}>${this.children}
            <div ref=${(element: Element) => { if (this.contextElement) this.menu.attach(element as HTMLDivElement, this.contextElement); }}
                id=${`${id}-menu`} role="menu" tabindex="-1" popover="manual" class="cs-context-menu__panel min-w-[160px] bg-popover text-popover-foreground border rounded-md shadow-lg p-1 outline-none"
                ...=${panel}>${renderMenuItems(items, 'cs-context-menu')}</div>
        </div>`;
    }
    @Client() hide() { this.menu.close(); }
    onCleanup() { this.menu.disconnect(); this.contextElement = undefined; }
}
