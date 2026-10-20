/** The theme's options as classes and styles: accent colour and content width. */
import type { ThemeHelpers } from '@cossackframework/cms';

/** Accent colours as the UI kit's primary tokens, light and dark. */
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
