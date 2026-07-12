import { html } from "@cossackframework/renderer";
import { Cossack, Component } from "@cossackframework/core";

export interface LabelProps {
    /** The form control id this label is for. */
    for?: string;
    /** Render the label text in muted (secondary) style. */
    muted?: boolean;
    /** Allow arbitrary HTML attributes to spread onto the native label. */
    [key: string]: any;
}

/**
 * Cossack UI Label — accessible form label.
 *
 * Use via `component(Label, { for: 'email' }, 'Email address')`.
 */
@Component()
export class Label extends Cossack {
    declare props: LabelProps;

    render() {
        const { muted = false, ...rest } = this.props;

        const classes = [
            "cs-label",
            "inline-block text-sm font-medium leading-none",
            muted ? "text-muted-foreground" : "text-foreground",
        ]
            .filter(Boolean)
            .join(" ");

        return html`
            <label class="${classes}" ...=${rest}>
                ${this.children}
            </label>
        `;
    }
}
