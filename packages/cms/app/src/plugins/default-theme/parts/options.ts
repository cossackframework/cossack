/** The theme's options as classes and styles: accent color, content width and typography. */
import type { ThemeHelpers } from '@cossackframework/cms';

/** Accent colors as the UI kit's primary tokens, light and dark. */
const ACCENTS: Record<string, [string, string] | undefined> = {
    blue: ['oklch(0.546 0.245 262.881)', 'oklch(0.985 0 0)'],
    emerald: ['oklch(0.596 0.145 163.225)', 'oklch(0.985 0 0)'],
    violet: ['oklch(0.541 0.281 293.009)', 'oklch(0.985 0 0)'],
    rose: ['oklch(0.586 0.253 17.585)', 'oklch(0.985 0 0)'],
    amber: ['oklch(0.769 0.188 70.08)', 'oklch(0.205 0 0)'],
};
const WIDTHS: Record<string, string> = { narrow: 'max-w-3xl', wide: 'max-w-5xl' };

export const width = (helpers: ThemeHelpers) => WIDTHS[String(helpers.options.width)] ?? WIDTHS.narrow!;

export function accentStyle(helpers: ThemeHelpers): string {
    const accent = ACCENTS[String(helpers.options.accent)];
    return accent ? `--primary: ${accent[0]}; --primary-foreground: ${accent[1]}; --ring: ${accent[0]};` : '';
}

/** Font stacks by option: system fonts, so nothing is downloaded. */
const FONTS: Record<string, string> = {
    sans: 'ui-sans-serif, system-ui, sans-serif',
    humanist: 'Seravek, "Gill Sans Nova", Ubuntu, Calibri, "DejaVu Sans", source-sans-pro, sans-serif',
    serif: 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif',
    mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
};
const SIZES: Record<string, string> = { small: '15px', medium: '16px', large: '18px' };
const WEIGHTS: Record<string, string> = { normal: '400', medium: '500', semibold: '600', bold: '700' };

/**
 * The typography options as a stylesheet the layout embeds: the root font size (so rem-based
 * sizes scale with it), the font stack, and the weight of every heading, which wins over
 * the templates' weight classes.
 */
export function typographyCss(helpers: ThemeHelpers): string {
    const font = FONTS[String(helpers.options.fontFamily)] ?? FONTS.sans!;
    const size = SIZES[String(helpers.options.baseSize)] ?? SIZES.medium!;
    const weight = WEIGHTS[String(helpers.options.headingWeight)] ?? WEIGHTS.bold!;
    return `html { font-size: ${size}; } [data-theme="default-theme"] { font-family: ${font}; } [data-theme="default-theme"][data-theme] :is(h1, h2, h3, h4, h5, h6) { font-weight: ${weight}; }`;
}
