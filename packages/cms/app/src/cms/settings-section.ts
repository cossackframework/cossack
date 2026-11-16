import { Client, Component, Cossack } from '@cossackframework/core';
import { html, type TemplateResult } from '@cossackframework/renderer';
import { settingsSectionId } from './settings-search';

/**
 * One section of the Settings page: its heading and its controls, in the shell the menu scrolls
 * to. Every section renders its controls at once, so the whole catalog is on the page: search
 * matches show without loading anything, and the layout is final when the menu scrolls to a
 * section. `onConnect` tells the page where the section is, for the menu's current item.
 */
@Component()
export class SettingsSection extends Cossack {
    declare props: { id: string; heading: TemplateResult; content: () => TemplateResult; onConnect?: (id: string, element: Element | undefined) => void };
    private element?: Element;

    @Client()
    connect(element: Element | undefined) {
        if (element === this.element) return;
        this.element = element;
        this.props.onConnect?.(this.props.id, element);
    }

    onCleanup() {
        // Teardown also runs on the server after rendering. The parent's `onConnect` is a client
        // method there, which cannot be sent from an HTTP render and would only log a warning.
        if (this.isServer) return;
        this.element = undefined;
        this.props.onConnect?.(this.props.id, undefined);
    }

    render() {
        return html`<section id=${settingsSectionId(this.props.id)} ref=${this.connect} data-settings-section=${this.props.id}
            data-settings-loaded="true" class="min-w-0 space-y-4" style="scroll-margin-top:calc(var(--settings-toolbar-height, 56px) + 24px)">
            ${this.props.heading}
            ${this.props.content()}
        </section>`;
    }
}
