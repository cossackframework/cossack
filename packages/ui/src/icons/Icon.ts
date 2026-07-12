import { html } from "@cossackframework/renderer";
import { unsafeHTML } from "@cossackframework/renderer";
import { Cossack, Component } from "@cossackframework/core";
import { iconRegistry, iconNames } from "./registry";
import { normalizeStyle, type IconStyle } from "./types";

export interface IconProps {
    /** Kebab-case icon name from the registry (e.g. "arrow-right"). */
    name: string;
    /** Solar visual style. Defaults to "line". Falls back to "line" when a style is missing. */
    style?: IconStyle | string;
    /** Pixel size for width/height. Default 24. */
    size?: number;
    /** Accessible label. When omitted, the icon is aria-hidden. */
    label?: string;
    /** Allow arbitrary HTML attributes / classes to spread onto the <svg>. */
    [key: string]: any;
}

/**
 * Cossack UI Icon — renders a Solar icon from the registry by name.
 *
 *   component(Icon, { name: 'arrow-right', style: 'duotone', size: 20, label: 'Next' })
 *
 * Falls back to the "line" style if the requested style is missing for an icon,
 * and renders nothing if the name is unknown (with a dev-mode console warning).
 */
@Component()
export class Icon extends Cossack {
    declare props: IconProps;

    render() {
        const {
            name,
            style = "line",
            size = 24,
            label,
            ...rest
        } = this.props;

        const entry = iconRegistry[name];
        if (!entry) {
            if (typeof console !== "undefined") {
                console.warn(
                    `[cossack/ui] Unknown icon "${name}". Available: ${iconNames.join(", ")}`,
                );
            }
            return null;
        }

        const normalized = normalizeStyle(String(style));
        const inner = entry[normalized] ?? entry.line;
        if (!inner) return null;

        const a11y = label
            ? { role: "img", "aria-label": label }
            : { "aria-hidden": "true" };

        return html`
            <svg
                xmlns="http://www.w3.org/2000/svg"
                width="${size}"
                height="${size}"
                viewBox="0 0 24 24"
                fill="none"
                class="cs-icon"
                ...=${{ ...a11y, ...rest }}
            >
                ${unsafeHTML(inner)}
            </svg>
        `;
    }
}
