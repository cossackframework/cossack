import { Cossack, Client, Component } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';
import { loadTurnstileClient, type TurnstileClient, type TurnstileLoader } from '../internal/turnstile-loader';
export type { TurnstileClient, TurnstileLoader, TurnstileRenderOptions } from '../internal/turnstile-loader';
export interface TurnstileError {
    code: 'script-load' | 'render-failed' | 'widget-error' | 'timeout' | 'unsupported' | 'invalid-token';
    providerCode?: string;
}
export interface TurnstileProps {
    id: string;
    siteKey: string;
    action?: string;
    theme?: 'auto' | 'light' | 'dark';
    size?: 'normal' | 'compact' | 'flexible';
    language?: string;
    label?: string;
    responseFieldName?: string;
    resetKey?: string | number;
    onSuccess?: (token: string) => void;
    onTokenChange?: (token: string) => void;
    onExpired?: () => void;
    onError?: (error: TurnstileError) => void;
    /** Test/custom loader only: client callbacks never replace server verification. */
    loadClient?: TurnstileLoader;
}
@Component()
export class Turnstile extends Cossack {
    declare props: TurnstileProps;
    private host?: HTMLElement;
    private client?: TurnstileClient;
    private widget?: string;
    private abort?: AbortController;
    private generation = 0;
    private disposed = false;
    private configuration?: string;
    private token = '';
    private status: 'loading' | 'ready' | 'verified' | 'expired' | 'error' = 'loading';

    render() {
        if (!this.props.id || !this.props.siteKey) throw new TypeError('Turnstile requires id and siteKey');
        if (this.props.action !== undefined && !/^[a-zA-Z0-9_-]{1,32}$/.test(this.props.action)) throw new TypeError('Turnstile action must be a bounded identifier');
        const messages = { loading: 'Loading verification.', ready: 'Complete verification.', verified: 'Verification complete.', expired: 'Verification expired. Please retry.', error: 'Verification unavailable. Please retry.' };
        return html`<div role="group" aria-label=${this.props.label ?? 'Bot protection'} aria-describedby=${`${this.props.id}-status`}><div id=${this.props.id} ref=${(element: Element) => this.connect(element as HTMLElement)}></div><input type="hidden" name=${this.props.responseFieldName ?? 'cf-turnstile-response'} value=${this.token}><p id=${`${this.props.id}-status`} role="status" aria-live="polite">${messages[this.status]}</p>${this.status === 'error' || this.status === 'expired' ? html`<button type="button" @click=${() => this.reset()}>Retry verification</button>` : ''}</div>`;
    }
    @Client()
    connect(host: HTMLElement) {
        if (this.disposed) return;
        const configuration = JSON.stringify([this.props.siteKey, this.props.action, this.props.theme, this.props.size, this.props.language, this.props.resetKey]);
        if (this.host === host && this.configuration === configuration) return;
        this.host = host;
        this.configuration = configuration;
        void this.reset();
    }
    @Client()
    private clearToken() {
        this.token = '';
        this.props.onTokenChange?.('');
        // Clear transport synchronously, before the next reactive render.
        const input = this.host?.parentElement?.querySelector('input');
        if (input) input.value = '';
    }
    @Client()
    private release() {
        this.abort?.abort();
        this.abort = undefined;
        const widget = this.widget;
        this.widget = undefined;
        if (widget !== undefined) { try { this.client?.remove(widget); } catch { /* Disposal must still invalidate callbacks. */ } }
        this.client = undefined;
    }
    /** Recreate the widget, invalidating callbacks from the previous challenge. */
    @Client()
    async reset(): Promise<void> {
        const generation = ++this.generation;
        this.release();
        this.clearToken();
        if (this.disposed || !this.host) return;
        this.status = 'loading';
        void this.requestUpdate();
        const abort = this.abort = new AbortController();
        const host = this.host;
        const active = () => !this.disposed && generation === this.generation && !abort.signal.aborted;
        const fail = (error: TurnstileError) => {
            if (!active()) return;
            this.clearToken(); this.status = 'error'; void this.requestUpdate(); this.props.onError?.(error);
        };
        // Renderer refs run before newly cloned template nodes are adopted.
        // Resolve the document only after that synchronous insertion completes.
        await Promise.resolve();
        if (!active()) return;
        let client: TurnstileClient;
        try { client = await (this.props.loadClient ?? loadTurnstileClient)(host.ownerDocument, abort.signal); }
        catch { if (active()) fail({ code: 'script-load' }); return; }
        if (!active()) return;
        this.client = client;
        this.status = 'ready';
        try {
            const widget = client.render(host, {
                sitekey: this.props.siteKey, action: this.props.action, theme: this.props.theme, size: this.props.size, language: this.props.language,
                'response-field': false, 'refresh-expired': 'manual',
                callback: token => {
                    if (!active()) return;
                    if (typeof token !== 'string' || !token || token.length > 2048) return fail({ code: 'invalid-token' });
                    this.token = token; this.status = 'verified';
                    const input = host.parentElement?.querySelector('input'); if (input) input.value = token;
                    void this.requestUpdate(); this.props.onTokenChange?.(token); this.props.onSuccess?.(token);
                },
                'expired-callback': () => { if (!active()) return; this.clearToken(); this.status = 'expired'; void this.requestUpdate(); this.props.onExpired?.(); },
                'error-callback': code => fail({ code: 'widget-error', ...(typeof code === 'string' && /^\d{6}$/.test(code) ? { providerCode: code } : {}) }),
                'timeout-callback': () => fail({ code: 'timeout' }),
                'unsupported-callback': () => fail({ code: 'unsupported' }),
            });
            if (active()) this.widget = widget; else client.remove(widget);
        } catch { fail({ code: 'render-failed' }); }
        if (active()) void this.requestUpdate();
    }
    onCleanup() { this.onDispose(); }
    onDispose() {
        if (this.disposed) return;
        this.disposed = true; ++this.generation;
        if (!this.host) return;
        this.release();
        this.clearToken();
        this.host = undefined;
    }
}
