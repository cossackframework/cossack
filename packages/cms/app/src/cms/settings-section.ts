import { Client, ClientState, ClientTask, Component, Cossack } from '@cossackframework/core';
import { html, type TemplateResult } from '@cossackframework/renderer';
import { settingsSectionId } from './settings-search';

/** Keep light headings/anchors in the document; mount controls only near the viewport. */
@Component()
export class SettingsSection extends Cossack {
    declare props: { id: string; heading: TemplateResult; content: () => TemplateResult; eager?: boolean; count: number; onConnect?: (id: string, element: Element | undefined) => void };
    @ClientState() ready = false;
    private observer?: IntersectionObserver;
    private element?: Element;

    @Client()
    connect(element: Element | undefined) {
        if (element === this.element) return;
        this.observer?.disconnect();
        this.element = element;
        this.props.onConnect?.(this.props.id, element);
        if (!element) return;
        if (this.props.eager || this.ready) { this.ready = true; return; }
        if (typeof IntersectionObserver === 'undefined') { this.ready = true; return; }
        // Nested component() children have no framework container for @VisibleTask.
        // Bind at ref attachment, after the nested element actually enters the DOM.
        this.observer = new IntersectionObserver(entries => {
            if (entries.some(entry => entry.isIntersecting)) { this.ready = true; this.observer?.disconnect(); }
        }, { rootMargin: '600px 0px' });
        this.observer.observe(element);
    }

    onCleanup() {
        this.observer?.disconnect();
        // Teardown also runs on the server after rendering. The parent's `onConnect` is a client
        // method there, which cannot be sent from an HTTP render and would only log a warning.
        if (this.isServer) return;
        this.element = undefined;
        this.props.onConnect?.(this.props.id, undefined);
    }

    @ClientTask()
    keepMounted() { if (this.props.eager && !this.ready) { this.ready = true; this.observer?.disconnect(); } }

    render() {
        const loaded = this.ready || this.props.eager;
        return html`<section id=${settingsSectionId(this.props.id)} ref=${this.connect} data-settings-section=${this.props.id}
            data-settings-loaded=${loaded ? 'true' : 'false'} class="min-w-0 space-y-4" style="scroll-margin-top:calc(var(--settings-toolbar-height, 56px) + 24px)">
            ${this.props.heading}
            ${loaded ? this.props.content() : html`<div class="rounded-lg border border-border bg-muted/20 p-5" style=${`min-height:${Math.min(900, Math.max(240, this.props.count * 80))}px`}>
                <p class="text-sm text-muted-foreground">${__('Settings load as you scroll.')}</p>
            </div>`}
        </section>`;
    }
}
