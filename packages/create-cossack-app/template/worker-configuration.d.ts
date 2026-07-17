/* eslint-disable */
// Default Cloudflare binding type declarations.
//
// This file ships with the template so `tsc` works out of the box. Running
// `pnpm run cf-typegen` (wrangler types --env-interface CloudflareBindings)
// regenerates it with the full Cloudflare runtime types plus whatever
// bindings you add to wrangler.jsonc. Re-run it after changing bindings.

// Minimal D1Database stub so `tsc` passes before `cf-typegen` is run.
// Replaced by the full type when you run `pnpm cf-typegen`.
declare abstract class D1Database {
	prepare(query: string): D1PreparedStatement;
	batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
	exec(query: string): Promise<D1ExecResult>;
}
declare abstract class D1PreparedStatement {
	bind(...values: unknown[]): D1PreparedStatement;
	all<T = unknown>(): Promise<D1Result<T>>;
	run<T = unknown>(): Promise<D1Result<T>>;
	first<T = unknown>(col?: string): Promise<T | null>;
}
interface D1Result<T = unknown> {
	results?: T[];
	success: boolean;
	meta?: Record<string, unknown>;
}
interface D1ExecResult {
	count: number;
	duration: number;
}
interface CacheStorage {}
interface ExecutionContext {
	waitUntil(promise: Promise<unknown>): void;
	passThroughOnException(): void;
}
/** Cloudflare Email Routing binding (wrangler.jsonc `send_email`). */
declare abstract class SendEmail {
	send(message: { to: string; from: string; subject: string; html?: string; text?: string }): Promise<void>;
}

interface CloudflareBindings {
	/** Cloudflare Workers Static Assets binding (wrangler.jsonc `assets`). */
	ASSETS: Fetcher;
	/** Cloudflare D1 database binding (wrangler.jsonc `d1_databases`). Used by db() / getDb(c). */
	DB: D1Database;
	/** Cloudflare Email Routing binding (wrangler.jsonc `send_email`). Used by binding('EMAIL').send(...) in requestPasswordReset. */
	EMAIL: SendEmail;
	/** Site base URL (wrangler.jsonc `vars.APP_URL`). Read via config('app.url'). Used for sitemap/canonical/OG generation. */
	APP_URL: string;
	/** Default locale for `__()`. Override with `cossack_locale` cookie or `Accept-Language`. See `cossack lang publish`. */
	APP_LOCALE: string;
	/** Signing secret for flash-data cookies (min 16 chars). Read via config('app.key'). */
	APP_SECRET: string;
	/** From address for transactional email. Read via env('MAIL_FROM') in requestPasswordReset. */
	MAIL_FROM: string;
}
