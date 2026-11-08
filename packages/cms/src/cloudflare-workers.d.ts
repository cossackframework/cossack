// The parts of the Workers runtime the CMS uses, so the package type-checks without the
// generated Workers types. Only Cloudflare-only modules import them.
declare module 'cloudflare:workers' {
    export abstract class WorkerEntrypoint<Env = unknown, Props = unknown> {
        protected ctx: { readonly props: Props; waitUntil(promise: Promise<unknown>): void; readonly exports: Record<string, unknown> };
        protected env: Env;
        constructor(ctx: unknown, env: Env);
    }
}
