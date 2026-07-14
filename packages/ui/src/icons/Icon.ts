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
 * Build the full <svg>...</svg> markup string for an icon.
 *
 * The whole <svg> is emitted as a single unsafeHTML blob (rather than wrapping
 * an inner path in unsafeHTML) because the HTML parser only enters the SVG
 * namespace when it encounters a literal <svg> start tag. If we rendered
 * <svg>${unsafeHTML(path)}</svg>, the inner path would be parsed in the XHTML
 * namespace and never become a real SVGPathElement — so it wouldn't render.
 *
 * Extra attributes from `rest` (class, style, data-*, etc.) are merged into the
 * opening <svg> tag so consumers can customize the icon.
 */
function buildSvg(
    inner: string,
    size: number,
    label: string | undefined,
    extraAttrs: Record<string, unknown>,
): string {
    const a11y = label
        ? ` role="img" aria-label="${escapeAttr(label)}"`
        : ` aria-hidden="true"`;

    // Merge consumer-provided class with the default cs-icon hook.
    const consumerClass = extraAttrs.class;
    const classStr = consumerClass ? `cs-icon ${String(consumerClass)}` : "cs-icon";

    // Serialize remaining extra attrs (skip class/label/style already handled).
    const skip = new Set(["class", "label", "style", "name", "size"]);
    const attrParts = Object.entries(extraAttrs)
        .filter(([k]) => !skip.has(k))
        .map(([k, v]) => v === true ? ` ${k}` : ` ${k}="${escapeAttr(String(v))}"`)
        .join("");

    const styleStr = extraAttrs.style ? ` style="${escapeAttr(String(extraAttrs.style))}"` : "";

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" class="${classStr}"${a11y}${styleStr}${attrParts}>${inner}</svg>`;
}

function escapeAttr(s: string): string {
    return String(s).replace(/"/g, "&quot;");
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

        return html`${unsafeHTML(buildSvg(inner, size, label, rest))}`;
    }
}
