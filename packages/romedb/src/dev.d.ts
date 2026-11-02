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

/** Vite plugin: starts `romedb serve` for a loopback ROMEDB_URL and sets `process.env.ROMEDB_TOKEN`. */
export function romedbDev(options?: { url?: string; root?: string }): Plugin;

/** Cloudflare plugin `config` customizer that passes the token {@link romedbDev} read. */
export function romedbDevVars(): { vars?: { ROMEDB_TOKEN: string } };
