/* eslint-disable */
// Default Cloudflare binding type declarations.
//
// This file ships with the template so `tsc` works out of the box. Running
// `pnpm run cf-typegen` (wrangler types --env-interface CloudflareBindings)
// regenerates it with the full Cloudflare runtime types plus whatever
// bindings you add to wrangler.jsonc. Re-run it after changing bindings.
interface CloudflareBindings {
	/** Cloudflare Workers Static Assets binding (wrangler.jsonc `assets`). */
	ASSETS: Fetcher;
	/** Site base URL, used for sitemap/canonical/OG generation (wrangler.jsonc `vars.BASE_URL`). */
	BASE_URL: string;
}
