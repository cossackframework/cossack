/**
 * The first path segments the application's routes take, from its page files (the keys of
 * `virtual:cossack-pages`, such as `/src/pages/(site)/search/index.ts`): the project's pages,
 * the CMS's and every plugin's. An entry served at the site root cannot take one as its slug,
 * or the entry would hide the page, or the page the entry.
 */
export function reservedRouteSegments(files: readonly string[]): string[] {
    const segments = new Set<string>();
    for (const file of files) {
        // Route groups, `(site)`, are not part of the address.
        const [first, ...rest] = file.replace(/^\/src\/pages\//, '').split('/').filter(part => !/^\([^)]+\)$/.test(part));
        if (!first) continue;
        const segment = rest.length ? first : first.replace(/\.(?:ts|mdx?)$/, '');
        // A parameter takes any address already, and these files are not routes of their own.
        if (segment.startsWith('[') || ['index', '404', 'error', 'layout', 'loading'].includes(segment)) continue;
        segments.add(segment);
    }
    return [...segments].sort();
}
