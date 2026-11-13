import type { Plugin } from 'vite';

/** The local single-database service a ROMEDB_URL names, or undefined for files and remote URLs. */
export function localService(url: string | undefined): { origin: string; port: number } | undefined;

/**
 * Start `romedb serve` for a loopback ROMEDB_URL unless a service already answers there.
 * Data stays in `storage/romedb/app.romedb` under `root`; the token in `storage/romedb/token`.
 * Undefined for files and remote URLs, and for a service this app did not start.
 */
export function startLocalRomeDB(options: {
    url: string | undefined;
    root?: string;
    binary?: string;
    timeoutMs?: number;
    log?: (message: string) => void;
}): Promise<{ token: string; started: boolean; stop(): Promise<void> } | undefined>;

/**
 * Start `romedb serve --directory` on `port` for a CMS network's added sites, unless a service
 * answers there. Data stays in `storage/romedb/sites` under `root`. Undefined when the executable
 * cannot serve a directory (before RomeDB 0.2.12), or another service answers there.
 */
export function startLocalSites(options: {
    port: number;
    root?: string;
    binary?: string;
    timeoutMs?: number;
    log?: (message: string) => void;
}): Promise<{ url: string; token: string; started: boolean; stop(): Promise<void> } | undefined>;

/**
 * Vite plugin: starts `romedb serve` for a loopback ROMEDB_URL and sets `process.env.ROMEDB_TOKEN`;
 * unless ROMEDB_SITES_URL is set, also a directory service for added sites on the next free port, setting
 * ROMEDB_SITES_URL and ROMEDB_SITES_TOKEN.
 */
export function romedbDev(options?: { url?: string; root?: string }): Plugin;

/** Cloudflare plugin `config` customizer that passes on what {@link romedbDev} read. */
export function romedbDevVars(): { vars?: { ROMEDB_TOKEN?: string; ROMEDB_SITES_URL?: string; ROMEDB_SITES_TOKEN?: string } };
