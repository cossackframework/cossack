import { getRequestListener } from '@hono/node-server';
import { isRunnableDevEnvironment, type Plugin } from 'vite';
import type { NodeUpgradeServer } from './adapter';

/** Structural application entry; this tooling never imports the framework. */
export interface NodeDevelopmentEntry {
    app: { fetch(request: Request, env?: Record<string, unknown>): Response | Promise<Response> };
    env?: Record<string, unknown>;
    runtime?: {
        attach?(server: NodeUpgradeServer, fetch: (request: Request) => Response | Promise<Response>): () => void;
        dispose(): void | Promise<void>;
    };
}
export interface NodeDevelopmentOptions {
    /** Vite server entry, relative to the project root. */
    entry?: string;
    /** Maximum time to wait for application cleanup when closing Vite. */
    shutdownTimeoutMs?: number;
}

/** Serve generated Node applications through Vite's SSR environment. */
export function cossackNode(options: NodeDevelopmentOptions = {}): Plugin {
    const timeout = options.shutdownTimeoutMs ?? 5000;
    if (!Number.isFinite(timeout) || timeout <= 0) throw new TypeError('shutdownTimeoutMs must be positive and finite');
    let close: (() => Promise<void>) | undefined;
    return {
        name: 'cossack-node-development',
        apply: 'serve',
        config: () => ({ appType: 'custom' }),
        configureServer(server) {
            // Embedded servers own their HTTP listener and runtime lifecycle.
            // Preserve existing generated scripts/dev.js applications.
            if (server.config.server.middlewareMode) return;
            const environment = server.environments.ssr;
            if (!isRunnableDevEnvironment(environment)) throw new Error('Cossack Node development requires a runnable Vite SSR environment');
            let current: NodeDevelopmentEntry | undefined;
            let detach: (() => void) | undefined;
            let stopped = false;
            let loading: Promise<NodeDevelopmentEntry> | undefined;
            const cleanups = new Set<Promise<void>>();
            const retired = new WeakSet<NonNullable<NodeDevelopmentEntry['runtime']>>();
            const retire = (entry: NodeDevelopmentEntry) => {
                if (!entry.runtime || retired.has(entry.runtime)) return;
                retired.add(entry.runtime);
                const work = Promise.resolve().then(() => entry.runtime?.dispose()).then(() => {});
                cleanups.add(work);
                void work.catch(error => server.config.logger.error(`[cossack node] cleanup failed: ${error}`))
                    .finally(() => cleanups.delete(work));
            };
            const load = (): Promise<NodeDevelopmentEntry> => {
                if (stopped) return Promise.reject(new Error('Cossack Node development server is closing'));
                return loading ??= environment.runner.import(options.entry ?? '/src/index.ts').then(module => {
                    const entry = module as NodeDevelopmentEntry;
                    if (typeof entry.app?.fetch !== 'function') throw new TypeError('Cossack Node entry must export app.fetch');
                    if (stopped) { retire(entry); throw new Error('Cossack Node development server is closing'); }
                    if (entry !== current) {
                        detach?.(); detach = undefined;
                        if (current && current.runtime !== entry.runtime) retire(current);
                        current = entry;
                        if (server.httpServer && entry.runtime?.attach) {
                            detach = entry.runtime.attach(server.httpServer, request => entry.app.fetch(request, entry.env));
                        }
                    }
                    return entry;
                }).finally(() => { loading = undefined; });
            };
            let closing: Promise<void> | undefined;
            close = () => closing ??= (async () => {
                stopped = true;
                detach?.(); detach = undefined;
                const settle = (async () => {
                    await loading?.catch(() => {});
                    if (current) { retire(current); current = undefined; }
                    await Promise.allSettled([...cleanups]);
                })();
                let timer: ReturnType<typeof setTimeout> | undefined;
                try {
                    await Promise.race([settle, new Promise<void>(resolve => {
                        timer = setTimeout(() => {
                            server.config.logger.warn('[cossack node] application cleanup exceeded the shutdown deadline');
                            resolve();
                        }, timeout);
                    })]);
                } finally { clearTimeout(timer); }
            })();
            // Returning a post hook preserves Vite's module, public asset and HMR handlers.
            return () => server.middlewares.use((request, response, next) => {
                void load().then(entry => {
                    const handle = getRequestListener(webRequest => entry.app.fetch(webRequest, entry.env));
                    return handle(request, response);
                }).catch(next);
            });
        },
        async closeBundle() { await close?.(); },
    };
}
