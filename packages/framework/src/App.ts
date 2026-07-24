import { Cossack, Page, HeadContext, HeadValue, ClientState, On, OnDocument, Client } from '@cossackframework/core';
import { component, html } from '@cossackframework/renderer';
import { Button, Command } from '@cossackframework/ui';
import { demoCommandItems } from './demo-catalog.js';

@Page({ transport: 'http' })
export class App extends Cossack {
    @ClientState() theme: 'light' | 'dark' = 'light';

    @ClientState()
    lastNavigatedPath: string = '/';

    @ClientState()
    commandPaletteOpen = false;

    @On('navigate-complete')
    logNavigation(pathname: string) {
        // App, active layouts, and the current page all receive this lifecycle
        // event. Multiple handlers per component are supported.
        this.lastNavigatedPath = pathname;

        // This is a part of e2e test so do NOT remove it.
        console.log('[App] @On("navigate-complete")', pathname);
    }

    public head(context: HeadContext): HeadValue {
        return {
            title: `Cossack Framework - ${context.title || 'Welcome'}`,
            meta: [
                { tag: 'meta', attributes: { name: 'viewport', content: 'width=device-width, initial-scale=1' } },
            ]
        };
    }

    @Client()
    toggleTheme() {
        this.theme = this.theme === 'light' ? 'dark' : 'light';
        if (!this.isServer) {
            document.documentElement.classList.toggle('dark', this.theme === 'dark');
        }
    }

    @OnDocument('keydown')
    handleCommandShortcut(event: KeyboardEvent) {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
            event.preventDefault();
            this.commandPaletteOpen = !this.commandPaletteOpen;
        } else if (event.key === 'Escape' && this.commandPaletteOpen) {
            this.commandPaletteOpen = false;
        }
    }

    @Client()
    setCommandPaletteOpen(open: boolean) {
        this.commandPaletteOpen = open;
    }

    @Client()
    navigateFromCommand(url: string) {
        this.redirect(url);
    }

    render() {
        return html`
            <div id="app-wrapper" class="${this.theme}">
                <div class="fixed bottom-5 right-5 z-[1000]">
                    ${component(Button, {
                        variant: 'outline',
                        '@click': this.toggleTheme,
                        'aria-label': `Switch to ${this.theme === 'light' ? 'dark' : 'light'} mode`,
                    }, this.theme === 'light' ? '🌙 Dark mode' : '☀️ Light mode')}
                </div>
                ${this.children}
                ${component(Command, {
                    items: demoCommandItems,
                    placeholder: 'Go to a demo…',
                    open: this.commandPaletteOpen,
                    onOpenChange: this.setCommandPaletteOpen,
                    onSelect: this.navigateFromCommand,
                })}
            </div>
        `;
    }
}
