import { html, type TemplateResult, component } from '@cossackframework/renderer';
import { Cossack, Page, ClientState, HeadContext, HeadValue } from '@cossackframework/core';
import { Layout } from '../../components/Layout';

/**
 * Regression page for the security-plugin transitive-preservation fix.
 *
 * `onMount()` is a client-safe builtin, and it calls `setupReveal()` via
 * `this.setupReveal()`. The security plugin must therefore preserve
 * `setupReveal()` (and `reveal()` which it calls transitively) in the client
 * bundle — even though neither helper carries a client-safe decorator.
 *
 * The runtime (`setupServerMethodProxies`) must also NOT replace these
 * undecorated helpers with RPC proxies — otherwise the method body is
 * silently swallowed even when the source is preserved.
 *
 * If either layer incorrectly strips/proxies the helper, the `revealReady`
 * flag never flips and the `[data-reveal-ready]` attribute never appears.
 */
@Page()
export class SecurityDemo extends Cossack {
    @ClientState()
    revealReady = false;

    public head(context: HeadContext): HeadValue {
        return { title: 'Security Demo' };
    }

    onMount() {
        // Reachable from a builtin -> preserved transitively.
        // Defer one tick so the rendered DOM (.reveal elements) is available.
        setTimeout(() => this.setupReveal(), 0);
    }

    private setupReveal() {
        // Reachable from onMount -> preserved transitively.
        if (typeof document === 'undefined') return;

        // Flip the deterministic flag so the e2e test can confirm the helper ran.
        this.revealReady = true;

        const observer = new IntersectionObserver((entries) => {
            for (const entry of entries) {
                if (!entry.isIntersecting) continue;
                this.reveal(entry.target as HTMLElement);
                observer.unobserve(entry.target);
            }
        }, { threshold: 0.1 });

        const targets = document.querySelectorAll('.reveal');
        targets.forEach((el) => observer.observe(el));
    }

    private reveal(el: HTMLElement) {
        // Reachable from setupReveal -> preserved transitively (depth 2).
        el.classList.add('revealed');
    }

    render(): TemplateResult {
        return component(Layout, { dir: 'ltr' }, html`
            <div class="security-demo" ?data-reveal-ready="${this.revealReady}">
                <h1>Security Demo</h1>
                <p>Scroll down to reveal elements. The reveal logic lives in
                   undecorated private helpers that are preserved transitively
                   because <code>onMount()</code> calls them.</p>

                <div style="height: 150vh;"></div>

                <div class="reveal" data-testid="reveal-1">Reveal 1</div>
                <div class="reveal" data-testid="reveal-2">Reveal 2</div>
                <div class="reveal" data-testid="reveal-3">Reveal 3</div>
            </div>
        `);
    }
}
