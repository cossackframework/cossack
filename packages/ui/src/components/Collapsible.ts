import { html } from "@cossackframework/renderer";
import { Cossack, Component, ClientState, Client, createRef } from "@cossackframework/core";

import { DisclosureController, disclosureStyle } from "../internal/disclosure";

export interface CollapsibleProps {
    /** Default open state for uncontrolled usage. */
    defaultOpen?: boolean;
    /** Controlled open state. */
    open?: boolean;
    /** Trigger content (usually a Button) that toggles the collapsible. */
    trigger?: unknown;
    /** Callback fired when the open state changes. */
    onToggle?: (open: boolean) => void;
    [key: string]: any;
}

/**
 * Cossack UI Collapsible — expand/collapse container with smooth animation.
 *
 * Similar to Accordion but without the summary/trigger — the parent controls
 * what triggers the toggle (usually a Button). Uses the same @ClientState +
 * height animation as Accordion, with unclipped content while open.
 *
 *   ${component(Collapsible, { trigger: component(Button, {}, 'Toggle') },
 *       html\`<p>Hidden content</p>\`)}
 */
@Component()
export class Collapsible extends Cossack {
    declare props: CollapsibleProps;

    @ClientState() private internalOpen = false;
    @ClientState() private userInteracted = false;
    contentRef = createRef<HTMLDivElement>();
    wrapperRef = createRef<HTMLDivElement>();
    private disclosure = new DisclosureController(this, () => ({
        open: this.isOpen,
        wrapper: this.wrapperRef.value,
        content: this.contentRef.value,
    }));

    private get isOpen(): boolean {
        return this.props.open !== undefined ? !!this.props.open
            : this.userInteracted ? this.internalOpen : !!this.props.defaultOpen;
    }

    render() {
        const { trigger } = this.props;

        const open = this.isOpen;

        return html`
            <div class="cs-collapsible w-full">
                <div class="cs-collapsible__trigger" @click=${(e: Event) => { e.stopPropagation(); this.toggle(); }}>
                    ${trigger}
                </div>
                <div class="cs-collapsible__content-wrapper" ref=${this.wrapperRef}
                    style=${disclosureStyle(open)} ?inert=${!open} aria-hidden=${open ? "false" : "true"}>
                    <div class="cs-collapsible__content-wrapper-inner" ref=${this.contentRef} style="display: flow-root;">
                        ${this.children}
                    </div>
                </div>
            </div>
        `;
    }

    @Client()
    toggle() {
        const currentOpen = this.isOpen;

        if (this.props.open !== undefined) {
            this.props.onToggle?.(!currentOpen);
            return;
        }
        this.userInteracted = true;
        this.internalOpen = !currentOpen;
        this.props.onToggle?.(this.internalOpen);
    }

    onMount() {
        this.disclosure.hostUpdated();
    }

    onCleanup() {
        this.disclosure.hostDisconnected();
    }
}
