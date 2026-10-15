import { html } from "@cossackframework/renderer";
import { Cossack, Component, ClientState, Client, createRef } from "@cossackframework/core";

import { ControlledValue } from "../native-attributes";
import { DisclosureController, disclosureStyle, disclosureClick, validateDisclosure, restoreDisclosureFocus, type DisclosureProps } from "../internal/disclosure";

export type CollapsibleProps = DisclosureProps & {
    /** Text inside the native trigger button. Style it with triggerProps. */
    trigger: string;
};

/** Native disclosure button with caller-owned content and optional controlled state. */
@Component()
export class Collapsible extends Cossack {
    declare props: CollapsibleProps;

    @ClientState() private internalOpen = false;
    @ClientState() private userInteracted = false;
    private initialOpen?: boolean;
    private controlled = new ControlledValue<boolean>();
    private triggerButton?: HTMLButtonElement;
    contentRef = createRef<HTMLDivElement>();
    wrapperRef = createRef<HTMLDivElement>();
    private disclosure = new DisclosureController(this, () => ({
        open: this.isOpen,
        wrapper: this.wrapperRef.value,
        content: this.contentRef.value,
    }));

    private get isOpen(): boolean {
        this.initialOpen ??= !!this.props.defaultOpen;
        return this.props.open !== undefined ? !!this.props.open
            : this.userInteracted ? this.internalOpen : this.initialOpen;
    }

    render() {
        const { id, trigger, triggerProps = {}, panelProps = {}, disabled,
            open: _open, defaultOpen: _default, onOpenChange: _change, ...rest } = this.props;
        validateDisclosure(id, trigger);

        const open = this.isOpen;
        restoreDisclosureFocus(open, this.wrapperRef.value, this.triggerButton);

        return html`
            <div id=${id} class="cs-collapsible w-full" ...=${rest}>
                <button ref=${(element: Element) => { this.triggerButton = element as HTMLButtonElement; }}
                    type="button" id=${`${id}-trigger`} ?disabled=${disabled} aria-expanded=${open} aria-controls=${`${id}-panel`}
                    class="cs-collapsible__trigger inline-flex items-center rounded-md border px-3 py-2 text-sm focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:opacity-50 disabled:cursor-not-allowed"
                    ...=${{ ...triggerProps, '@click': disclosureClick(triggerProps['@click'], () => this.toggle()) }}>${trigger}</button>
                <div id=${`${id}-panel`} ...=${panelProps} class="cs-collapsible__content-wrapper" ref=${this.wrapperRef}
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
        if (this.props.disabled || this.triggerButton?.matches(':disabled')) return;
        const currentOpen = this.controlled.base(this.props, this.isOpen);

        if (this.props.open !== undefined) {
            this.props.onOpenChange?.(this.controlled.emit(this.props, !currentOpen));
            return;
        }
        this.userInteracted = true;
        this.internalOpen = !currentOpen;
        this.props.onOpenChange?.(this.controlled.emit(this.props, this.internalOpen));
    }

    onMount() {
        this.disclosure.hostUpdated();
    }

    onCleanup() {
        this.disclosure.hostDisconnected();
        this.triggerButton = undefined; this.wrapperRef.value = undefined; this.contentRef.value = undefined;
    }
}
