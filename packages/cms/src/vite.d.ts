import type { Plugin, UserConfig } from 'vite';
import type { IconStyleName } from './icons';

/** Puts the space back between attributes the icon package's artwork glues together, so a sprite is well-formed XML. */
export function xmlSafe(markup: string): string;

/** The sprite of a group in a style, or undefined for an unknown group. Missing artwork in a style falls back to line. */
export function iconSprite(style: IconStyleName, group: string): Promise<string | undefined>;

/**
 * The Vite plugin that delivers the icons: one sprite per style and group under
 * `/assets/icons/<style>/<group>.<version>.svg`, served in development and emitted into the
 * client build.
 */
export function cossackCmsIcons(): Plugin;

/** The CMS's part of a project's Vite configuration, which the `cossack/vite` preset adds. */
export function cossackVite(context: { root: string; runtime: string; mode: string; command: 'build' | 'serve' }): Promise<{
    setup: Plugin[];
    plugins: Plugin[];
    pluginPolicy: boolean;
    pages: Record<string, unknown>;
    cloudflare: Record<string, unknown>;
    config: UserConfig | undefined;
}>;
