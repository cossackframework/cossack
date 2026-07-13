import { html, classMap, component } from "@cossackframework/renderer";
import { Cossack, Component } from "@cossackframework/core";
import { Avatar } from "./Avatar";

export interface AvatarGroupItem {
    /** Image URL. */
    src?: string;
    /** Alt text / fallback initials. */
    alt?: string;
}

export interface AvatarGroupProps {
    /** Avatar data. Extra items beyond `max` collapse into a "+N" counter. */
    items?: AvatarGroupItem[];
    /** Max avatars to show before collapsing. Default 5. */
    max?: number;
    /** Avatar size in px. Default 36. */
    size?: number;
    /** Avatar shape. */
    shape?: "circle" | "square";
    /** Stack direction. */
    direction?: "row" | "row-reverse";
    /** Overlap in px (negative margin). Default is 25% of size. */
    overlap?: number;
    /** Show a ring border between overlapping avatars. Default true. */
    ring?: boolean;
    [key: string]: any;
}

/**
 * Cossack UI AvatarGroup — stacked avatar set with overflow counter.
 *
 * Renders a row of overlapping `Avatar` components. When `items.length` exceeds
 * `max`, the extras collapse into a "+N" counter at the end. Useful for showing
 * team members, participants, or recent activity.
 *
 *   ${component(AvatarGroup, {
 *       max: 4,
 *       size: 32,
 *       items: [
 *           { src: '/alice.png', alt: 'Alice' },
 *           { src: '/bob.png', alt: 'Bob' },
 *           { src: '/carol.png', alt: 'Carol' },
 *           { src: '/dan.png', alt: 'Dan' },
 *           { src: '/eve.png', alt: 'Eve' },
 *           { src: '/frank.png', alt: 'Frank' },
 *       ],
 *   })}
 */
@Component()
export class AvatarGroup extends Cossack {
    declare props: AvatarGroupProps;

    render() {
        const {
            items = [],
            max = 5,
            size = 36,
            shape = "circle",
            direction = "row",
            overlap,
            ring = true,
        } = this.props;

        const visible = items.slice(0, max);
        const overflow = items.length - max;

        // Default overlap: 25% of the avatar size.
        const margin = overlap ?? -Math.round(size * 0.25);
        const radius = shape === "circle" ? "9999px" : "0.375rem";
        const ringStyle = ring
            ? `box-shadow: 0 0 0 2px var(--color-background, #fff);`
            : "";

        return html`
            <div
                class=${classMap({
                    "cs-avatar-group": true,
                    "inline-flex items-center": true,
                    "flex-row-reverse": direction === "row-reverse",
                })}
            >
                ${visible.map((item, i) => html`
                    <span
                        class="cs-avatar-group__item inline-block"
                        style="margin-left:${i === 0 ? 0 : margin}px;${ringStyle}"
                    >
                        ${component(Avatar, {
                            src: item.src,
                            alt: item.alt,
                            size,
                            shape,
                        })}
                    </span>
                `)}
                ${overflow > 0
                    ? html`<span
                          class="cs-avatar-group__overflow inline-flex items-center justify-center bg-muted text-muted-foreground font-medium select-none"
                          style="margin-left:${margin}px;width:${size}px;height:${size}px;font-size:${Math.round(size * 0.38)}px;border-radius:${radius};${ringStyle}"
                      >+${overflow}</span>`
                    : null}
            </div>
        `;
    }
}
