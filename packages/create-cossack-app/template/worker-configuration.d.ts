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
	/** Site base URL (wrangler.jsonc `vars.APP_URL`). Read via config('app.url'). Used for sitemap/canonical/OG generation. */
	APP_URL: string;
	/** Default locale for `__()`. Override with `cossack_locale` cookie or `Accept-Language`. See `cossack lang publish`. */
	APP_LOCALE: string;
	/** Signing secret for flash-data cookies (min 16 chars). Read via config('app.key'). */
	APP_SECRET: string;
}
