// Writes src/server/brand-icons.ts: the brand icons `brandIcon()` resolves, copied from the
// simple-icons package (a development dependency) so the server ships forty icons, not the
// whole set. Run `pnpm --filter @cossackframework/cms brands` after changing the list or
// updating simple-icons; brand-icons.test.ts fails while the file is stale.
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import * as icons from 'simple-icons';

export const BRAND_SLUGS = ['applepodcasts', 'behance', 'bluesky', 'buymeacoffee', 'discord', 'dribbble', 'facebook', 'flickr', 'github', 'goodreads', 'googlemaps', 'instagram', 'kofi', 'letterboxd', 'line', 'mastodon',
    'medium', 'messenger', 'patreon', 'pinterest', 'reddit', 'rss', 'signal', 'snapchat', 'soundcloud', 'spotify', 'strava', 'substack', 'telegram', 'threads', 'tiktok', 'tripadvisor', 'tumblr',
    'twitch', 'viber', 'vimeo', 'vk', 'wechat', 'whatsapp', 'x', 'xing', 'yelp', 'youtube', 'zalo'];

/** The export name simple-icons gives a slug: `si` and the slug capitalized. */
export const exportName = slug => `si${slug[0].toUpperCase()}${slug.slice(1)}`;

/** The icons as `{ title, slug, hex, path }` records, by export name. */
export function brandIcons() {
    return BRAND_SLUGS.map(slug => {
        const icon = icons[exportName(slug)];
        if (!icon) throw new Error(`simple-icons has no ${slug}`);
        return [exportName(slug), { title: icon.title, slug: icon.slug, hex: icon.hex, path: icon.path }];
    });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const lines = brandIcons().map(([name, icon]) => `export const ${name}: BrandArtwork = ${JSON.stringify(icon)};`);
    const source = `/**\n * Brand icons for \`brandIcon()\`, copied from simple-icons (CC0) by scripts/brand-icons.mjs; do not edit.\n * Each is a 24×24 path with the brand's color. Run \`pnpm --filter @cossackframework/cms brands\` to refresh.\n */\nexport interface BrandArtwork { readonly title: string; readonly slug: string; readonly hex: string; readonly path: string }\n\n${lines.join('\n')}\n`;
    await writeFile(new URL('../src/server/brand-icons.ts', import.meta.url), source);
    console.log(`wrote ${lines.length} brand icons`);
}
