import { html } from "@cossackframework/renderer";
import { unsafeHTML } from "@cossackframework/renderer";
import { Cossack, Component } from "@cossackframework/core";
import { normalizeStyle, type IconStyle, type IconEntry } from "@cossackframework/solar-icons/types";

export interface IconProps {
    entry: IconEntry;
    style?: IconStyle | string;
    size?: number;
    label?: string;
    [key: string]: any;
}

function buildSvg(inner: string, size: number, label: string | undefined, extraAttrs: Record<string, unknown>): string {
    const a11y = label ? ` role="img" aria-label="${escapeAttr(label)}"` : ` aria-hidden="true"`;
    const consumerClass = extraAttrs.class;
    const classStr = consumerClass ? `cs-icon ${String(consumerClass)}` : "cs-icon";
    const skip = new Set(["class", "label", "style", "size"]);
    const attrParts = Object.entries(extraAttrs).filter(([k]) => !skip.has(k)).map(([k, v]) => v === true ? ` ${k}` : ` ${k}="${escapeAttr(String(v))}"`).join("");
    const styleStr = extraAttrs.style ? ` style="${escapeAttr(String(extraAttrs.style))}"` : "";
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" class="${classStr}"${a11y}${styleStr}${attrParts}>${inner}</svg>`;
}
function escapeAttr(s: string): string { return String(s).replace(/"/g, "&quot;"); }

@Component()
export class Icon extends Cossack {
    declare props: IconProps;
    render() {
        const { entry: directEntry, style = "line", size = 24, label, ...rest } = this.props;
        if (!directEntry) {
            // Help migrate callers still using the old name-based API.
            if (typeof console !== "undefined" && "name" in this.props && this.props.name) {
                console.warn(
                    `[cossack/ui] <Icon> no longer takes a "name" prop — use "entry" instead. ` +
                    `For dynamic names, use <NamedIcon>. ` +
                    `Example: import { ArrowRightIcon } from '@cossackframework/solar-icons/arrow-right'; ` +
                    `component(Icon, { entry: ArrowRightIcon })`,
                );
            }
            return null;
        }
        const normalized = normalizeStyle(String(style));
        const inner = directEntry[normalized] ?? directEntry.line;
        if (!inner) return null;
        return html`${unsafeHTML(buildSvg(inner, size, label, rest))}`;
    }
}
