import { html, component } from '@cossackframework/renderer';
import { Cossack, Component, ClientState, Client } from '@cossackframework/core';
import { Command, type CommandProps, type CommandItem as NativeCommandItem } from '../../components/Command.js';
import { Icon } from '../../icons/Icon.js';
import { Kbd } from '../../components/Kbd.js';
import type { IconEntry } from '@cossackframework/solar-icons/types';
import { ControlledValue } from '../../native-attributes.js';

export type CommandItem = NativeCommandItem & {
    /** Explicitly trusted SVG artwork. Import individual Solar entries. */
    readonly icon?: Readonly<IconEntry>;
    /** Display hint, not a registered binding. Also used as a description by default. */
    readonly shortcut?: string;
};
type SharedProps = Omit<CommandProps, 'items' | 'renderItem' | 'grouped' | 'open' | 'defaultOpen' | 'onOpenChange' | 'onSelect'> & {
    commands: readonly CommandItem[];
    onSelect: (id: string) => unknown;
};
export type CommandPaletteProps = SharedProps & (
    { open: boolean; defaultOpen?: never; onOpenChange: (open: boolean) => unknown }
    | { open?: never; defaultOpen?: boolean; onOpenChange?: (open: boolean) => unknown }
);

/** Rich command launcher. The shared Command owns the dialog, search and keyboard behavior. */
@Component()
export class CommandPalette extends Cossack {
    declare props: CommandPaletteProps;
    @ClientState() private localOpened: boolean | undefined;
    private initialOpened?: boolean;
    private controlled = new ControlledValue<boolean>();

    get isOpen() { return this.props.open ?? this.localOpened ?? this.initialOpened ?? !!this.props.defaultOpen; }

    /** Request a state change. Controlled callers must accept it through props. */
    @Client() setOpen(open: boolean) {
        if (typeof open !== 'boolean') throw new Error('CommandPalette setOpen requires a boolean.');
        if (!this.controlled.changed(this.props, this.isOpen, open)) return;
        if (this.props.open === undefined) this.localOpened = open;
        this.props.onOpenChange?.(this.controlled.emit(this.props, open));
        void this.requestUpdate();
    }
    /** Request the opposite open state, for application-owned buttons or menus. */
    @Client() toggle() { this.setOpen(!this.controlled.base(this.props, this.isOpen)); }

    render() {
        const { commands, onSelect, open, defaultOpen, onOpenChange, ...dialog } = this.props;
        if (!Array.isArray(commands)) throw new Error('CommandPalette requires a commands array.');
        if (typeof onSelect !== 'function') throw new Error('CommandPalette requires onSelect.');
        if ((open !== undefined && typeof open !== 'boolean') || (defaultOpen !== undefined && typeof defaultOpen !== 'boolean')) throw new Error('CommandPalette open/defaultOpen must be boolean.');
        if (open !== undefined && (defaultOpen !== undefined || typeof onOpenChange !== 'function')) throw new Error('Controlled CommandPalette requires onOpenChange and no defaultOpen.');
        if (this.children != null && this.children !== false && this.children !== '') throw new Error('CommandPalette uses commands, not positional children.');
        this.initialOpened ??= defaultOpen ?? false;
        const records = new Map(commands.map(command => [command.id, command]));
        const items = commands.map(command => {
            if (command.shortcut !== undefined && typeof command.shortcut !== 'string') throw new Error('CommandPalette shortcut hints must be text.');
            return { id: command.id, label: command.label, group: command.group, disabled: command.disabled, description: command.description ?? command.shortcut };
        });
        return html`<div class="cs-command-palette">${component(Command, {
            ...dialog, items, grouped: true, open: this.isOpen, onOpenChange: value => this.setOpen(value), onSelect,
            renderItem: item => {
                const command = records.get(item.id)!;
                return html`${command.icon ? component(Icon, { entry: command.icon, size: 16 }) : null}
                    <span class="min-w-0 flex-1 break-words">${item.label}</span>
                    ${command.shortcut ? component(Kbd, { 'aria-hidden': true }, command.shortcut) : null}`;
            },
        })}</div>`;
    }
}
