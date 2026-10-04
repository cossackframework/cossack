import { html, svg, ifDefined, unsafeHTML } from '@cossackframework/renderer';
import { Cossack, Component } from '@cossackframework/core';
import type { IconStyle, IconEntry } from '@cossackframework/solar-icons/types';
import type { SvgAttributes } from '../native-attributes';

/** Normalize an artwork style or supported alias. Unknown styles reject. */
export function normalizeStyle(style: string): IconStyle {
    if (typeof style !== 'string') throw new Error('Icon style must be a string.');
    switch (style.trim().toLowerCase()) {
        case 'line': case 'linear': case 'l': return 'line';
        case 'bold': case 'solid': case 'b': return 'bold';
        case 'duotone': case 'd': return 'duotone';
        case 'broken': case 'brk': return 'broken';
        case 'outline': case 'o': return 'outline';
        case 'line-duotone': case 'ld': case 'lineduotone': return 'line-duotone';
        default: throw new Error(`Unsupported Icon style: ${style}`);
    }
}

export type IconProps = Omit<SvgAttributes, 'width' | 'height' | 'viewBox' | 'role' | 'aria-label' | 'aria-labelledby' | 'aria-hidden' | 'tabindex' | 'focusable'> & {
    /** Trusted SVG artwork imported from Solar or authored locally. This is not sanitized. */
    entry: Readonly<IconEntry>;
    /** Artwork style. Native style remains CSS. Defaults to line. */
    variant?: IconStyle;
    /** Positive finite width and height in pixels. Defaults to 24. */
    size?: number;
    /** Informative alternative text. Omit or use an empty string for decoration. */
    label?: string;
};

/** Native SVG bindings for attributes/events; only the explicitly trusted artwork is raw. */
@Component()
export class Icon extends Cossack {
    declare props: IconProps;
    render() {
        const { entry, variant = 'line', size = 24, label, fill = 'none', ...rest } = this.props;
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('Icon requires a trusted entry; import an icon from @cossackframework/solar-icons.');
        if (!Number.isFinite(size) || size <= 0) throw new Error('Icon size must be positive and finite.');
        if (label !== undefined && typeof label !== 'string') throw new Error('Icon label must be a string.');
        if (this.children != null && this.children !== false && this.children !== '') throw new Error('Icon uses entry and label, not component children.');
        const normalized = normalizeStyle(variant);
        const requested = Object.hasOwn(entry, normalized) ? entry[normalized] : undefined;
        const artwork = requested === undefined && Object.hasOwn(entry, 'line') ? entry.line : requested;
        if (typeof artwork !== 'string' || !artwork.trim()) throw new Error(`Icon entry needs nonempty ${normalized} artwork or a line fallback.`);
        const name = label?.trim();
        return html`<svg xmlns="http://www.w3.org/2000/svg" class="cs-icon" ...=${rest} fill=${fill}
            width=${size} height=${size} viewBox="0 0 24 24" focusable="false"
            role=${ifDefined(name ? 'img' : undefined)} aria-label=${ifDefined(name || undefined)} aria-hidden=${ifDefined(name ? undefined : 'true')}>
            ${name ? svg`<title>${name}</title>` : null}${unsafeHTML(artwork)}
        </svg>`;
    }
}
