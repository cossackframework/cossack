import { Cossack, Page, ClientState, HeadContext, HeadValue } from '@cossackframework/core';
import { html, component } from '@cossackframework/renderer';
import { Kbd } from '@cossackframework/ui';
import { CommandPalette, type CommandItem } from '../../blocks/CommandPalette';
import { HamburgerMenuIcon } from '@cossackframework/solar-icons/hamburger-menu';
import { SettingsIcon } from '@cossackframework/solar-icons/settings';
import { AddCircleIcon } from '@cossackframework/solar-icons/add-circle';
import { TrashBinMinimalisticIcon } from '@cossackframework/solar-icons/trash-bin-minimalistic';

const COMMANDS: CommandItem[] = [
    { id: 'home', label: 'Go to Home', group: 'Navigation', icon: HamburgerMenuIcon },
    { id: 'dashboard', label: 'Go to Dashboard', group: 'Navigation', icon: SettingsIcon },
    { id: 'settings', label: 'Open Settings', group: 'Navigation', shortcut: '⌘,' },
    { id: 'profile', label: 'View Profile', group: 'Navigation' },
    { id: 'new-post', label: 'Create new post', group: 'Actions', icon: AddCircleIcon },
    { id: 'invite', label: 'Invite team member', group: 'Actions' },
    { id: 'export', label: 'Export data', group: 'Actions' },
    { id: 'delete', label: 'Delete account', group: 'Actions', icon: TrashBinMinimalisticIcon },
];

@Page({ transport: 'http' })
export default class CommandPaletteBlocksPage extends Cossack {
    @ClientState() lastSelected = '';

    render() {
        return html`
            <main class="min-h-screen bg-background py-12 px-4 flex flex-col items-center gap-8">
                <div class="text-center">
                    <h1 class="text-2xl font-bold text-foreground mb-1">Command Palette</h1>
                    <p class="text-sm text-muted-foreground flex items-center justify-center gap-1">
                        Press ${component(Kbd, {}, '⌘')} ${component(Kbd, {}, 'K')} anywhere to open it.
                    </p>
                </div>
                ${this.lastSelected
                    ? html`<p class="text-sm text-muted-foreground">Last selected: <span class="font-medium text-foreground">${this.lastSelected}</span></p>`
                    : null}
                ${component(CommandPalette, {
                    commands: COMMANDS,
                    onSelect: (id) => { this.lastSelected = id; },
                })}
            </main>
        `;
    }

    head(_: HeadContext): HeadValue {
        return { title: 'Command Palette — Blocks' };
    }
}
