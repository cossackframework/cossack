export interface TurnstileRenderOptions {
    sitekey: string;
    action?: string;
    theme?: 'auto' | 'light' | 'dark';
    size?: 'normal' | 'compact' | 'flexible';
    language?: string;
    'response-field': false;
    'refresh-expired': 'manual';
    callback(token: string): void;
    'expired-callback'(): void;
    'error-callback'(code: string): void;
    'timeout-callback'(): void;
    'unsupported-callback'(): void;
}
export interface TurnstileClient {
    render(container: HTMLElement, options: TurnstileRenderOptions): string;
    remove(widgetId: string): void;
}
export type TurnstileLoader = (document: Document, signal: AbortSignal) => Promise<TurnstileClient>;
const pending = new WeakMap<Document, Promise<TurnstileClient>>();
const sdk = (document: Document): TurnstileClient | undefined => {
    const candidate = (document.defaultView as (Window & { turnstile?: TurnstileClient }) | null)?.turnstile;
    return candidate && typeof candidate.render === 'function' && typeof candidate.remove === 'function' ? candidate : undefined;
};
/** One official explicit-render script per document; failed attempts can be retried. */
export const loadTurnstileClient: TurnstileLoader = (document, signal) => {
    if (signal.aborted) return Promise.reject(new DOMException('Turnstile load cancelled', 'AbortError'));
    let shared = pending.get(document);
    if (!shared) {
        const ready = sdk(document);
        shared = ready ? Promise.resolve(ready) : new Promise<TurnstileClient>((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
            script.async = true;
            const finish = () => { script.onload = null; script.onerror = null; clearTimeout(timeout); };
            const fail = () => { finish(); script.remove(); pending.delete(document); reject(new Error('Turnstile script unavailable')); };
            const timeout = setTimeout(fail, 30000);
            script.onload = () => { const client = sdk(document); if (!client) return fail(); finish(); resolve(client); };
            script.onerror = fail;
            document.head.append(script);
        });
        pending.set(document, shared);
        const attempt = shared;
        void shared.catch(() => { if (pending.get(document) === attempt) pending.delete(document); });
    }
    return new Promise((resolve, reject) => {
        const abort = () => reject(new DOMException('Turnstile load cancelled', 'AbortError'));
        if (signal.aborted) return abort();
        signal.addEventListener('abort', abort, { once: true });
        shared!.then(client => { signal.removeEventListener('abort', abort); if (!signal.aborted) resolve(client); }, error => { signal.removeEventListener('abort', abort); reject(error); });
    });
};
