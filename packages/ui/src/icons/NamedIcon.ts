import { html, component } from "@cossackframework/renderer";
import { Cossack, Component } from "@cossackframework/core";
import { Icon } from "./Icon";
import { iconRegistry, iconNames } from "@cossackframework/solar-icons/registry";
import type { IconEntry } from "@cossackframework/solar-icons/types";

export interface NamedIconProps {
    /** Kebab-case icon name from the registry (e.g. "arrow-right"). */
    name: string;
    /** Solar visual style. Defaults to "line". Falls back to "line" when a style is missing. */
    style?: string;
    /** Pixel size for width/height. Default 24. */
    size?: number;
    /** Accessible label. When omitted, the icon is aria-hidden. */
    label?: string;
    /**
     * Allow arbitrary HTML attributes / classes to spread onto the <svg>. The
     * string index signature is required by `component()`'s
     * `T['props'] & Record<string, unknown>` constraint.
     */
    [key: string]: any;
}

/**
 * Dynamic name-based icon renderer.
 *
 * Use this when the icon name is determined at runtime (e.g. from data). It
 * carries the full icon-registry dependency (all generated icon modules), so
 * prefer `Icon` with a direct `entry` import for fixed icons — that path is
 * fully tree-shakeable.
 *
 *   component(NamedIcon, { name: 'arrow-right', style: 'duotone', size: 20 })
 */
@Component()
export class NamedIcon extends Cossack {
    declare props: NamedIconProps;

    render() {
        const { name, ...rest } = this.props;
        const entry: IconEntry | undefined = iconRegistry[name];
        if (!entry) {
            if (typeof console !== "undefined") {
                // Log a short preview instead of all 1,246+ names (noisy + costly).
                const previewCount = 20;
                const preview = iconNames.slice(0, previewCount).join(", ");
                const suffix = iconNames.length > previewCount
                    ? `, … (+${iconNames.length - previewCount} more)`
                    : "";
                console.warn(
                    `[cossack/ui] Unknown icon "${name}". Available: ${preview}${suffix}`,
                );
            }
            return null;
        }
        return html`${component(Icon, { entry, ...rest })}`;
    }
}
