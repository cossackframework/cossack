import { html, classMap } from "@cossackframework/renderer";
import { Cossack, Component } from "@cossackframework/core";

export interface AccordionItemProps {
    /** Initial/collapsed state. Native <details> handles toggle with zero JS. */
    open?: boolean;
    /** Allow arbitrary HTML attributes to spread onto the <details>. */
    [key: string]: any;
}

/**
 * Cossack UI Accordion — built on native `<details>`/`<summary>`.
 *
 * Zero-JS by default: the browser handles open/close, accessibility
 * (aria-expanded), and keyboard. Pass the trigger text as `summary` (a string
 * or template) and the body as children.
 *
 *   ${component(AccordionItem, { open: true, summary: 'Section 1' },
 *       html\`<p>Content</p>\`)}
 */
@Component()
export class AccordionItem extends Cossack {
    declare props: AccordionItemProps & { summary?: unknown };

    render() {
        const { open = false, summary } = this.props;

        const classes = classMap({
            "cs-accordion": true,
            "cs-accordion--open": open,
            "rounded-md border border-border bg-background text-foreground": true,
        });

        const summaryClasses = classMap({
            "cs-accordion__summary": true,
            "cursor-pointer select-none px-4 py-3 font-medium text-sm": true,
            "hover:bg-muted": true,
        });

        return html`
            <details class=${classes} ?open=${open}>
                <summary class=${summaryClasses}>
                    ${summary ?? this.props["summary"]}
                </summary>
                <div class="cs-accordion__content-wrapper">
                    <div class="cs-accordion__content px-4 py-3">
                        ${this.children}
                    </div>
                </div>
            </details>
        `;
    }
}

export { AccordionItem as Accordion };
