import { html, classMap } from "@cossackframework/renderer";
import { Cossack, Component } from "@cossackframework/core";

export interface SkeletonProps {
    /** Optional fixed width, e.g. "100%" or "200px". Defaults to 100%. */
    width?: string;
    /** Optional fixed height, e.g. "20px" or "1rem". Defaults to 1em line. */
    height?: string;
    /** Render as a circle (for avatar skeletons). */
    circle?: boolean;
    /** Allow arbitrary HTML attributes to spread onto the root. */
    [key: string]: any;
}

/**
 * Cossack UI Skeleton — placeholder loading indicator.
 *
 * Uses Tailwind's `animate-pulse` keyframes (built-in, no custom CSS).
 *
 *   ${component(Skeleton, { width: '60%', height: '12px' })}
 *   ${component(Skeleton, { circle: true, size: 40 })}
 */
@Component()
export class Skeleton extends Cossack {
    declare props: SkeletonProps;

    render() {
        const { width, height, circle = false, ...rest } = this.props;

        const classes = classMap({
            "cs-skeleton": true,
            "animate-pulse bg-muted": true,
            "rounded-md": !circle,
            "rounded-full": circle,
        });

        const styleParts: string[] = [];
        if (width) styleParts.push(`width:${width}`);
        else styleParts.push("width:100%");
        if (height) styleParts.push(`height:${height}`);
        if (circle && !height) styleParts.push("height:1em");
        const style = styleParts.join(";");

        return html`<div class=${classes} style=${style} aria-hidden="true" ...=${rest}></div>`;
    }
}
