import { html, classMap, component } from "@cossackframework/renderer";
import {
    Cossack,
    Component,
    ClientState,
    Client,
    createRef,
    type RefObject,
} from "@cossackframework/core";
import { Icon } from "../icons/Icon";

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
 * The height animation uses JS to measure the exact content height via
 * `scrollHeight`, then animates `max-height` between `0` and that exact value.
 * This avoids the "fixed 500px overshoot" problem where a 40px-tall content
 * appears to open instantly (because it reaches 40px in ~8% of the animation).
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
    /** Measured content height in px (set on mount / when content changes). */
    @ClientState() private contentHeight: number = 0;

    contentRef: RefObject<HTMLDivElement> = createRef<HTMLDivElement>();

    render() {
        const { summary } = this.props;

        let open: boolean;
        if (this.props.open !== undefined) {
            open = !!this.props.open;
        } else if (this.userInteracted) {
            open = this.internalOpen;
        } else {
            open = !!this.props.defaultOpen;
            this.internalOpen = open;
        }

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

        // Use the measured height for a precise animation. Fall back to 200px
        // before measurement completes (first render).
        const targetHeight = this.contentHeight > 0 ? this.contentHeight : 200;
        const contentWrapperStyle = `max-height: ${open ? targetHeight + "px" : "0"}; transition: max-height 300ms cubic-bezier(0.16, 1, 0.3, 1);`;

        return html`
            <div class=${containerClasses}>
                <button
                    type="button"
                    class=${summaryClasses}
                    aria-expanded=${open ? "true" : "false"}
                    @click=${() => this.toggle()}
                >
                    <span>${summary ?? this.props["summary"]}</span>
                    <span
                        class="cs-accordion__chevron text-muted-foreground shrink-0 transition-transform duration-200"
                        style=${`transform: rotate(${open ? 180 : 0}deg);`}
                    >
                        ${component(Icon, { name: "alt-arrow-down", size: 16 })}
                    </span>
                </button>
                <div
                    class="cs-accordion__content-wrapper overflow-hidden"
                    style=${contentWrapperStyle}
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
        const currentOpen = this.props.open !== undefined
            ? !!this.props.open
            : this.userInteracted
                ? this.internalOpen
                : !!this.props.defaultOpen;

        if (this.props.open !== undefined) {
            this.props.onToggle?.(!currentOpen);
            return;
        }
        this.userInteracted = true;
        this.internalOpen = !currentOpen;
        this.props.onToggle?.(this.internalOpen);
    }

    /** Measure the content height after mount so the animation is precise. */
    @Client()
    onMount() {
        // Use rAF to wait for layout.
        requestAnimationFrame(() => {
            const el = this.contentRef.value;
            if (el) {
                this.contentHeight = el.scrollHeight;
            }
        });
    }
}

export { AccordionItem as Accordion };
