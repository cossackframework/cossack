import { getRequestListener } from '@hono/node-server';
import { isRunnableDevEnvironment, loadEnv, type DevEnvironment, type Plugin, type RunnableDevEnvironment } from 'vite';
import { EventEmitter } from 'node:events';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { relative } from 'node:path';
import type { NodeUpgradeServer } from './adapter';

/** Structural application entry; this tooling never imports the framework. */
export interface NodeDevelopmentEntry {
    app: { fetch(request: Request, env?: Record<string, unknown>): Response | Promise<Response> };
    env?: Record<string, unknown>;
    /** Build server bindings from Vite's environment files and process overrides. */
    createEnv?(variables: Record<string, string | undefined>): Record<string, unknown> | Promise<Record<string, unknown>>;
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
interface LoadedEntry {
    entry: NodeDevelopmentEntry;
    env: Record<string, unknown> | undefined;
    upgrades: EventEmitter;
    detach?: () => void;
}

/**
 * `isRunnableDevEnvironment` is an `instanceof` check. When this package is
 * linked or Vite is installed twice, the server's environment comes from the
 * application's Vite copy and fails that check, so also accept the runner shape.
 */
function isRunnableEnvironment(environment: DevEnvironment): environment is RunnableDevEnvironment {
    if (isRunnableDevEnvironment(environment)) return true;
    const runner = (environment as Partial<RunnableDevEnvironment>).runner;
    return typeof runner?.import === 'function' && typeof runner.clearCache === 'function'
        && typeof environment.moduleGraph?.invalidateAll === 'function';
}

/** Serve generated Node applications through Vite's SSR environment. */
export function cossackNode(options: NodeDevelopmentOptions = {}): Plugin {
    const timeout = options.shutdownTimeoutMs ?? 5000;
    if (!Number.isFinite(timeout) || timeout <= 0) throw new TypeError('shutdownTimeoutMs must be positive and finite');
    let close: (() => Promise<void>) | undefined;
    let refresh: (() => Promise<unknown>) | undefined;
    return {
        name: 'cossack-node-development',
        apply: 'serve',
        config: () => ({
            appType: 'custom',
            // Installed packages are otherwise loaded directly by Node, where
            // import.meta.env.DEV is absent and socket trace guards stay disabled.
            environments: { ssr: { resolve: {
                noExternal: ['@cossackframework/node-adapter', '@cossackframework/core'],
            } } },
        }),
        configureServer(server) {
            // Embedded servers own their HTTP listener and runtime lifecycle.
            if (server.config.server.middlewareMode) return;
            const environment = server.environments.ssr;
            if (!isRunnableEnvironment(environment)) throw new Error('Cossack Node development requires a runnable Vite SSR environment');
            const variables = { ...loadEnv(server.config.mode, server.config.envDir, ''), ...process.env };
            let current: LoadedEntry | undefined;
            let stopped = false;
            let revision = 0;
            let dirty = false;
            let loading: Promise<LoadedEntry> | undefined;
            const waitingSockets = new Set<Duplex>();
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
            const release = () => {
                if (!current) return;
                current.detach?.();
                retire(current.entry);
                current = undefined;
            };
            const load = (): Promise<LoadedEntry> => {
                if (stopped) return Promise.reject(new Error('Cossack Node development server is closing'));
                if (current) return Promise.resolve(current);
                return loading ??= (async () => {
                    while (!stopped) {
                        const expected = revision;
                        if (dirty) {
                            // Reload only the server graph. Browser HMR keeps its own connection and cache.
                            environment.moduleGraph.invalidateAll();
                            environment.runner.clearCache();
                            dirty = false;
                        }
                        const entry = await environment.runner.import(options.entry ?? '/src/index.ts') as NodeDevelopmentEntry;
                        if (typeof entry.app?.fetch !== 'function') { retire(entry); throw new TypeError('Cossack Node entry must export app.fetch'); }
                        let env: Record<string, unknown> | undefined;
                        try { env = entry.createEnv ? await entry.createEnv(variables) : entry.env; }
                        catch (error) { retire(entry); throw error; }
                        if (stopped || expected !== revision) { retire(entry); continue; }
                        const next: LoadedEntry = { entry, env, upgrades: new EventEmitter() };
                        try {
                            next.detach = entry.runtime?.attach?.(next.upgrades, request => entry.app.fetch(request, env));
                        } catch (error) { retire(entry); throw error; }
                        current = next;
                        return next;
                    }
                    throw new Error('Cossack Node development server is closing');
                })().catch(error => {
                    // A failed binding factory may already have retired its runtime.
                    // The next request must evaluate a fresh entry before retrying.
                    dirty = true;
                    throw error;
                }).finally(() => { loading = undefined; });
            };
            refresh = () => {
                revision++;
                dirty = true;
                release();
                return load();
            };
            const onUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer) => {
                if (!request.url?.startsWith('/ws/')) return;
                waitingSockets.add(socket);
                const forget = () => waitingSockets.delete(socket);
                socket.once('close', forget);
                socket.on('error', () => socket.destroy());
                void load().then(application => {
                    if (stopped || socket.destroyed) return;
                    if (!application.upgrades.emit('upgrade', request, socket, head)) {
                        socket.end('HTTP/1.1 503 Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
                    }
                }).catch(error => {
                    server.config.logger.error(`[cossack node] upgrade failed: ${error}`);
                    socket.destroy();
                }).finally(() => { forget(); socket.off('close', forget); });
            };
            server.httpServer?.on('upgrade', onUpgrade);
            let closing: Promise<void> | undefined;
            close = () => closing ??= (async () => {
                stopped = true;
                refresh = undefined;
                server.httpServer?.off('upgrade', onUpgrade);
                for (const socket of waitingSockets) socket.destroy();
                waitingSockets.clear();
                release();
                const settle = (async () => {
                    await loading?.catch(() => {});
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
            return () => server.middlewares.use((request, response, next) => {
                void load().then(({entry, env}) => getRequestListener(webRequest => entry.app.fetch(webRequest, env))(request, response)).catch(next);
            });
        },
        hotUpdate: {
            order: 'post',
            async handler({ file, modules, read, type, server }) {
                if (this.environment.name !== 'ssr' || !refresh) return;
                const source = relative(server.config.root, file).replaceAll('\\', '/');
                if (!modules.length && !(source.startsWith('src/') && !source.startsWith('src/client/') && /\.[cm]?[jt]sx?$|\.mdx?$/.test(source))) return;
                if (type !== 'delete') await read();
                try { await refresh(); }
                catch (error) { server.config.logger.error(`[cossack node] reload failed: ${error}`); }
                // This plugin replaced the SSR graph; do not ask its runner to reload it a second time.
                return [];
            },
        },
        async closeBundle() { await close?.(); },
    };
}
