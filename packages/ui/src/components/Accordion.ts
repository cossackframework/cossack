import { html, classMap, component } from "@cossackframework/renderer";
import {
    Cossack,
    Component,
    ClientState,
    Client,
    createRef,
    type RefObject,
} from "@cossackframework/core";
import { ControlledValue } from "../native-attributes";
import { DisclosureController, disclosureStyle, disclosureClick, validateDisclosure, restoreDisclosureFocus, type DisclosureProps } from "../internal/disclosure";
import { Icon } from "../icons/Icon";
import { AltArrowDownIcon as altArrowDownIcon } from "@cossackframework/solar-icons/alt-arrow-down";

export type AccordionProps = DisclosureProps & {
    summary: string;
    headingLevel?: 2 | 3 | 4 | 5 | 6;
};

/** One independent accordion section with native button activation and a typed panel. Stack several for a group. */
@Component()
export class Accordion extends Cossack {
    declare props: AccordionProps;

    @ClientState() private internalOpen: boolean = false;
    @ClientState() private userInteracted: boolean = false;

    private initialOpen?: boolean;
    private controlled = new ControlledValue<boolean>();
    private trigger?: HTMLButtonElement;

    contentRef: RefObject<HTMLDivElement> = createRef<HTMLDivElement>();

    wrapperRef: RefObject<HTMLDivElement> = createRef<HTMLDivElement>();
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
        const { id, summary, headingLevel = 3, triggerProps = {}, panelProps = {}, disabled,
            open: _open, defaultOpen: _default, onOpenChange: _change, ...rest } = this.props;
        validateDisclosure(id, summary);
        if (![2,3,4,5,6].includes(headingLevel)) throw new Error('headingLevel must be from 2 through 6.');
        const open = this.isOpen;
        restoreDisclosureFocus(open, this.wrapperRef.value, this.trigger);

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
            <div id=${id} class=${containerClasses} ...=${rest}>
                <div role="heading" aria-level=${headingLevel}>
                <button
                    ref=${(element: Element) => { this.trigger = element as HTMLButtonElement; }}
                    id=${`${id}-trigger`} type="button" ?disabled=${disabled} aria-controls=${`${id}-panel`}
                    class=${summaryClasses}
                    aria-expanded=${open ? "true" : "false"}
                    ...=${{ ...triggerProps, '@click': disclosureClick(triggerProps['@click'], () => this.toggle()) }}
                >
                    <span>${summary}</span>
                    <span
                        aria-hidden="true" class="cs-accordion__chevron text-muted-foreground shrink-0 transition-transform duration-200"
                        style=${`transform: rotate(${open ? 180 : 0}deg);`}
                    >
                        ${component(Icon, { entry: altArrowDownIcon, size: 16 })}
                    </span>
                </button>
                </div>
                <div
                    id=${`${id}-panel`} ...=${panelProps}
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
        if (this.props.disabled || this.trigger?.matches(':disabled')) return;
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
        this.trigger = undefined; this.wrapperRef.value = undefined; this.contentRef.value = undefined;
    }
}
