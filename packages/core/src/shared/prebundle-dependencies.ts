// shared/prebundle-dependencies.ts
//
// Which bare imports of application source Vite must pre-bundle up front. Vite cannot see a
// page's imports before the page loads, so a dependency found late is bundled late and the
// browser reloads once, or a second copy of a library appears beside the first. The scaffold
// lists these imports in the generated vite.config.ts for the application's own files, and the
// framework adds the ones in a mounted package's served files. Both use these rules.

/**
 * Imports the browser's first dependency bundle must hold.
 * - `hono/<module>` subpaths (`hono/cookie` in pages and layouts).
 * - `@tiptap/pm/<module>` subpaths: found one page at a time, Vite would bundle a second
 *   ProseMirror beside TipTap's, and the editor fails until the browser reloads.
 */
export const CLIENT_DEPENDENCY = /^(?:@cossackframework\/solar-icons\/.+|hono\/[^/]+|@tiptap\/[^/]+(?:\/[^/]+)?|prosemirror-collab|@simplewebauthn\/browser|@cossackframework\/(?:ui(?:\/blocks)?|auth|cms|framework\/plugins|core\/transport-routes))$/;

/**
 * The part of {@link CLIENT_DEPENDENCY} the server pre-bundles too. The Worker evaluates the
 * whole server entry at start, so icon subpaths and editor packages are bundled there as well.
 * The framework's own packages keep their one copy and stay off this list.
 */
export const SERVER_DEPENDENCY = /^(?:@cossackframework\/solar-icons\/.+|@tiptap\/[^/]+(?:\/[^/]+)?|prosemirror-collab)$/;

/** Specifiers a module imports at run time: static imports and re-exports that are not type-only, and dynamic imports. */
export function runtimeImports(source: string): string[] {
  const found: string[] = [];
  for (const [, typeOnly, specifier] of source.matchAll(/(?:^|\n)\s*(?:import|export)(\s+type\b)?[^;'"]*?\bfrom\s*'([^']+)'/g)) if (!typeOnly) found.push(specifier!);
  for (const [, specifier] of source.matchAll(/\bimport\(\s*'([^']+)'\s*\)/g)) found.push(specifier!);
  return found;
}

/** The pre-bundle lists for these source texts, sorted. */
export function prebundleDependencies(sources: Iterable<string>): { client: string[]; server: string[] } {
  const found = new Set<string>();
  for (const source of sources) for (const specifier of runtimeImports(source)) if (CLIENT_DEPENDENCY.test(specifier)) found.add(specifier);
  const client = [...found].sort();
  return { client, server: client.filter(name => SERVER_DEPENDENCY.test(name)) };
}
