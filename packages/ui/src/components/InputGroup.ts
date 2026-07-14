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
            <div class="cs-input-group flex items-center w-full rounded-md border bg-background shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-[3px] aria-invalid:border-destructive aria-invalid:ring-destructive/20">
                ${prefix != null
                    ? html`<span class="cs-input-group__prefix inline-flex items-center pl-3 text-sm text-muted-foreground shrink-0 [&_svg]:size-4">${prefix}</span>`
                    : null}
                <input
                    class="cs-input-group__input flex-1 min-w-0 h-9 bg-transparent border-none outline-none px-3 text-sm text-foreground placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
                    ...=${inputAttrs}
                />
                ${suffix != null
                    ? html`<span class="cs-input-group__suffix inline-flex items-center pr-3 text-sm text-muted-foreground shrink-0 [&_svg]:size-4">${suffix}</span>`
                    : null}
            </div>
        `;
    }
}
