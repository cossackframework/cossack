import { html, classMap } from "@cossackframework/renderer";
import { Cossack, Component } from "@cossackframework/core";

export interface SeparatorProps {
    /** Orientation of the separator. */
    orientation?: "horizontal" | "vertical";
    /** Adds decorative semantics (aria-hidden) when the separator is purely visual. */
    decorative?: boolean;
    /** Allow arbitrary HTML attributes to spread onto the root. */
    [key: string]: any;
}

/**
 * Cossack UI Separator — visual or semantic divider using `<hr>` / `<div>`.
 *
 * For a horizontal separator, the native `<hr>` is used (semantic). For
 * vertical, a `<div role="separator">` is used since `<hr>` is always
 * horizontal in the accessibility tree.
 *
 *   ${component(Separator, { orientation: 'vertical' })}
 */
@Component()
export class Separator extends Cossack {
    declare props: SeparatorProps;

    render() {
        const { orientation = "horizontal", decorative = false, ...rest } = this.props;

        const isVertical = orientation === "vertical";

        if (!isVertical) {
            // Native <hr> is semantically horizontal.
            const classes = classMap({
                "cs-separator": true,
                "shrink-0 bg-border h-px w-full": true,
            });
            return html`<hr class=${classes} ?aria-hidden=${decorative} ...=${rest} />`;
        }

        const classes = classMap({
            "cs-separator": true,
            "cs-separator--vertical": true,
            "shrink-0 bg-border self-stretch w-px": true,
        });

        return html`
            <div
                class=${classes}
                role="separator"
                aria-orientation="vertical"
                ?aria-hidden=${decorative}
                ...=${rest}
            ></div>
        `;
    }
}
