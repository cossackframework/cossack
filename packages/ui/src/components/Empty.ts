import type { GlobalAttributes } from "../native-attributes";
import { html } from "@cossackframework/renderer";
import { Cossack, Component } from "@cossackframework/core";

export type EmptyProps = Omit<GlobalAttributes<HTMLDivElement>, 'title'> & {
    /** Icon or illustration (template or string). */
    icon?: unknown;
    /** Title text. */
    title?: string;
    /** Description text. */
    description?: string;
}

/**
 * Cossack UI Empty — placeholder for empty states (no data, no results).
 *
 *   <${Empty} title="No results" description="Try a different search.">
 *       <${Button}>Clear filters</${Button}>
 *   </${Empty}>
 */
@Component()
export class Empty extends Cossack {
    declare props: EmptyProps;

    render() {
        const { icon, title, description, ...rest } = this.props;

        return html`
            <div class="cs-empty flex flex-col items-center justify-center text-center py-12 px-4" ...=${rest}>
                ${icon ? html`<div class="cs-empty__icon mb-4 text-muted-foreground">${icon}</div>` : null}
                ${title ? html`<p class="cs-empty__title text-sm font-medium text-foreground mb-1">${title}</p>` : null}
                ${description ? html`<p class="cs-empty__description text-sm text-muted-foreground mb-4">${description}</p>` : null}
                ${this.children ? html`<div class="cs-empty__action">${this.children}</div>` : null}
            </div>
        `;
    }
}
