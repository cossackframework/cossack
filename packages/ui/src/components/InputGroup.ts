import { html, classMap } from "@cossackframework/renderer";
import { Cossack, Component } from "@cossackframework/core";

export interface InputGroupProps {
    /** Content before the input (icon, unit, "@"). */
    prefix?: unknown;
    /** Content after the input (icon, unit, button). */
    suffix?: unknown;
    /** Allow arbitrary HTML attributes to spread onto the input. */
    [key: string]: any;
}

/**
 * Cossack UI InputGroup — input with prefix/suffix addons.
 *
 * Wraps a native `<input>` with optional leading and trailing adornments.
 * Useful for email fields (@), currency ($), URLs (https://), or trailing
 * buttons (copy, show/hide password).
 *
 *   ${component(InputGroup, {
 *       prefix: '@',
 *       placeholder: 'username',
 *   })}
 *   ${component(InputGroup, {
 *       prefix: html\`<svg .../>\`,
 *       suffix: 'kg',
 *       type: 'number',
 *   })}
 */
@Component()
export class InputGroup extends Cossack {
    declare props: InputGroupProps;

    render() {
        const { prefix, suffix, ...inputAttrs } = this.props;

        return html`
            <div class="cs-input-group flex items-center w-full rounded-md border border-border bg-background transition-colors focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
                ${prefix != null
                    ? html`<span class="cs-input-group__prefix inline-flex items-center pl-3 text-sm text-muted-foreground shrink-0">${prefix}</span>`
                    : null}
                <input
                    class="cs-input-group__input flex-1 min-w-0 bg-transparent border-none outline-none px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
                    ...=${inputAttrs}
                />
                ${suffix != null
                    ? html`<span class="cs-input-group__suffix inline-flex items-center pr-3 text-sm text-muted-foreground shrink-0">${suffix}</span>`
                    : null}
            </div>
        `;
    }
}
