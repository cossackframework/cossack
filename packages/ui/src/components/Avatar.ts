import { html, classMap } from "@cossackframework/renderer";
import { Cossack, Component, ClientState } from "@cossackframework/core";

export interface AvatarProps {
    /** Image URL. */
    src?: string;
    /** Alt text / fallback initials shown if the image fails or is absent. */
    alt?: string;
    /** Avatar size in px. Default 40. */
    size?: number;
    /** Shape. */
    shape?: "circle" | "square";
    /** Allow arbitrary HTML attributes to spread onto the root. */
    [key: string]: any;
}

/**
 * Cossack UI Avatar — image with graceful fallback.
 *
 * Shows the image when it loads; falls back to initials (from `alt`) or the
 * slotted children on error/missing src. Native `<img onerror>` drives the
 * fallback via a `@ClientState`.
 *
 *   ${component(Avatar, { src: '/me.png', alt: 'Tan Nguyen', size: 40 })}
 */
@Component()
export class Avatar extends Cossack {
    declare props: AvatarProps;

    @ClientState() private failed = false;

    render() {
        const { src, alt = "", size = 40, shape = "circle", ...rest } = this.props;

        const showImg = src && !this.failed;

        const classes = classMap({
            "cs-avatar": true,
            "cs-avatar--circle": shape === "circle",
            "cs-avatar--square": shape === "square",
            "inline-flex items-center justify-center overflow-hidden": true,
            "bg-muted text-muted-foreground font-medium select-none": true,
            "rounded-full": shape === "circle",
            "rounded-md": shape === "square",
        });

        const radius = shape === "circle" ? "50%" : "0.375rem";
        const style = `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.4)}px;border-radius:${radius};`;
        const initials = alt
            .split(" ")
            .map((w) => w[0])
            .slice(0, 2)
            .join("")
            .toUpperCase();

        return html`
            <span class=${classes} style=${style} ...=${rest}>
                ${showImg
                    ? html`<img
                          src=${src}
                          alt=${alt}
                          class="cs-avatar__img w-full h-full object-cover"
                          @error=${() => { this.failed = true; }}
                      />`
                    : html`<span class="cs-avatar__fallback">${this.children || initials}</span>`}
            </span>
        `;
    }
}
