import { html, classMap } from "@cossackframework/renderer";
import { Cossack, Component, ClientState, Client } from "@cossackframework/core";

export interface CollapsibleProps {
    /** Default open state for uncontrolled usage. */
    defaultOpen?: boolean;
    /** Controlled open state. */
    open?: boolean;
    /** Callback fired when the open state changes. */
    onToggle?: (open: boolean) => void;
    [key: string]: any;
}

/**
 * Cossack UI Collapsible — expand/collapse container with smooth animation.
 *
 * Similar to Accordion but without the summary/trigger — the parent controls
 * what triggers the toggle (usually a Button). Uses the same @ClientState +
 * measured max-height technique for smooth animation.
 *
 *   ${component(Collapsible, { trigger: component(Button, {}, 'Toggle') },
 *       html\`<p>Hidden content</p>\`)}
 */
@Component()
export class Collapsible extends Cossack {
    declare props: CollapsibleProps;

    @ClientState() private internalOpen = false;
    @ClientState() private userInteracted = false;
    @ClientState() private contentHeight = 0;

    render() {
        const { trigger } = this.props;

        let open: boolean;
        if (this.props.open !== undefined) {
            open = !!this.props.open;
        } else if (this.userInteracted) {
            open = this.internalOpen;
        } else {
            open = !!this.props.defaultOpen;
            this.internalOpen = open;
        }

        const targetHeight = this.contentHeight > 0 ? this.contentHeight : 200;
        const contentStyle = `max-height: ${open ? targetHeight + "px" : "0"}; transition: max-height 300ms cubic-bezier(0.16,1,0.3,1);`;

        return html`
            <div class="cs-collapsible w-full">
                <div class="cs-collapsible__trigger" @click=${(e: Event) => { e.stopPropagation(); this.toggle(); }}>
                    ${trigger}
                </div>
                <div class="cs-collapsible__content-wrapper overflow-hidden" style=${contentStyle}>
                    <div class="cs-collapsible__content-wrapper-inner">
                        ${this.children}
                    </div>
                </div>
            </div>
        `;
    }

    @Client()
    toggle() {
        const currentOpen = this.props.open !== undefined
            ? !!this.props.open
            : this.userInteracted ? this.internalOpen : !!this.props.defaultOpen;

        if (this.props.open !== undefined) {
            this.props.onToggle?.(!currentOpen);
            return;
        }
        this.userInteracted = true;
        this.internalOpen = !currentOpen;
        this.props.onToggle?.(this.internalOpen);
    }

    @Client()
    onMount() {
        requestAnimationFrame(() => {
            const wrapper = (this as any).container?.querySelector(".cs-collapsible__content-wrapper-inner");
            if (wrapper) this.contentHeight = wrapper.scrollHeight;
        });
    }
}
