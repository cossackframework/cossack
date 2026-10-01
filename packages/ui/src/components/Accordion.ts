import { html, classMap, component } from "@cossackframework/renderer";
import {
    Cossack,
    Component,
    ClientState,
    Client,
    createRef,
    type RefObject,
} from "@cossackframework/core";
import { DisclosureController, disclosureStyle } from "../internal/disclosure";
import { Icon } from "../icons/Icon";
import { AltArrowDownIcon as altArrowDownIcon } from "@cossackframework/solar-icons/alt-arrow-down";

export interface AccordionItemProps {
    /** Controlled open state. When passed, the parent owns the state. */
    open?: boolean;
    /** Summary/trigger text. */
    summary?: unknown;
    /** Default open state for uncontrolled usage. */
    defaultOpen?: boolean;
    /** Callback fired when the open state changes. */
    onToggle?: (open: boolean) => void;
    /** Allow arbitrary HTML attributes. */
    [key: string]: any;
}

/**
 * Cossack UI Accordion — collapsible section with smooth height animation.
 *
 * Uses a `<button>` trigger + `<div>` content with `@ClientState` for open/close
 * state, NOT native `<details>`/`<summary>`. The reason: `<details>` internally
 * hides content via the browser's own mechanism when closed, which CSS
 * transitions can't override. The div+button+state approach gives full control.
 *
 * Height is measured for each toggle. Open content rests at auto height with
 * visible overflow, so async content and pop-out overlays are not clipped.
 *
 * Uncontrolled:
 *   ${component(AccordionItem, { summary: 'Section 1' }, html\`<p>Content</p>\`)}
 *   ${component(AccordionItem, { summary: 'Section 2', defaultOpen: true }, ...)}
 *
 * Controlled:
 *   ${component(AccordionItem, {
 *       summary: 'Section 1', open: this.open, onToggle: (v) => { this.open = v; },
 *   }, ...)}
 */
@Component()
export class AccordionItem extends Cossack {
    declare props: AccordionItemProps;

    @ClientState() private internalOpen: boolean = false;
    @ClientState() private userInteracted: boolean = false;

    contentRef: RefObject<HTMLDivElement> = createRef<HTMLDivElement>();

    wrapperRef: RefObject<HTMLDivElement> = createRef<HTMLDivElement>();
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
        const { summary } = this.props;
        const open = this.isOpen;

        const containerClasses = classMap({
            "cs-accordion": true,
            "cs-accordion--open": open,
            "rounded-md border bg-card text-card-foreground": true,
        });

        const summaryClasses = classMap({
            "cs-accordion__summary": true,
            "w-full flex items-center justify-between gap-2 px-4 py-3 font-medium text-sm cursor-pointer select-none bg-transparent border-none text-left outline-none": true,
            "hover:bg-accent hover:text-accent-foreground": true,
            "focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:rounded-md": true,
        });

        return html`
            <div class=${containerClasses}>
                <button
                    type="button"
                    class=${summaryClasses}
                    aria-expanded=${open ? "true" : "false"}
                    @click=${() => this.toggle()}
                >
                    <span>${summary}</span>
                    <span
                        class="cs-accordion__chevron text-muted-foreground shrink-0 transition-transform duration-200"
                        style=${`transform: rotate(${open ? 180 : 0}deg);`}
                    >
                        ${component(Icon, { entry: altArrowDownIcon, size: 16 })}
                    </span>
                </button>
                <div
                    class="cs-accordion__content-wrapper"
                    ref=${this.wrapperRef}
                    style=${disclosureStyle(open)}
                    ?inert=${!open}
                    aria-hidden=${open ? "false" : "true"}
                >
                    <div ref=${this.contentRef} class="cs-accordion__content px-4 py-3">
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

export { AccordionItem as Accordion };
