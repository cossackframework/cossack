import { html, classMap } from "@cossackframework/renderer";
import { Cossack, Component } from "@cossackframework/core";

export interface ButtonGroupProps {
    /** Layout direction. */
    orientation?: "horizontal" | "vertical";
    [key: string]: any;
}

/**
 * Cossack UI ButtonGroup — visually connected group of buttons.
 *
 * Pass buttons as children. They'll be visually joined with shared borders.
 *
 *   ${component(ButtonGroup, {},
 *       html\`${component(Button, { variant: 'outline' }, 'Left')}
 *            ${component(Button, { variant: 'outline' }, 'Center')}
 *            ${component(Button, { variant: 'outline' }, 'Right')}\`)}
 */
@Component()
export class ButtonGroup extends Cossack {
    declare props: ButtonGroupProps;

    render() {
        const { orientation = "horizontal" } = this.props;

        const classes = classMap({
            "cs-button-group": true,
            "inline-flex": orientation === "horizontal",
            "inline-flex flex-col": orientation === "vertical",
            "isolate": true,
        });

        // We style children via CSS (base.css) targeting [data-group-child].
        return html`
            <div class=${classes} role="group" data-orientation=${orientation} ...=${this.props}>
                ${this.children}
            </div>
        `;
    }
}
