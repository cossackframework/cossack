import { html, type TemplateResult, component } from '@cossackframework/renderer';
import { Cossack, Page, ClientState, HeadContext, HeadValue } from '@cossackframework/core';

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

    private revealCleanup?: () => void;

    public head(context: HeadContext): HeadValue {
        return { title: 'Security Demo' };
    }

    onMount() {
        // Reachable from a builtin -> preserved transitively.
        // Defer one tick so the rendered DOM (.reveal elements) is available.
        setTimeout(() => this.setupReveal(), 0);
    }

    onCleanup() {
        this.revealCleanup?.();
    }

    private async setupReveal() {
        // Reachable from onMount -> preserved transitively.
        if (typeof document === 'undefined') return;

        // Flip the deterministic flag so the e2e test can confirm the helper
        // ran, then wait for the resulting page/App reconciliation. Querying
        // before that commit would attach the observer to nodes that the
        // reactive render immediately replaces.
        this.revealReady = true;
        await this.requestUpdate();

        this.revealCleanup?.();

        const observer = new IntersectionObserver((entries) => {
            for (const entry of entries) {
                if (!entry.isIntersecting) continue;
                this.reveal(entry.target as HTMLElement);
                observer.unobserve(entry.target);
            }
        }, { threshold: 0.1 });

        const observed = new WeakSet<Element>();
        const scan = () => {
            document.querySelectorAll('.reveal').forEach((element) => {
                if (observed.has(element)) return;
                observed.add(element);
                observer.observe(element);
            });
        };

        scan();

        // A reactive App reconciliation can replace the page's DOM after
        // onMount. Re-scan added subtrees so the observer always follows the
        // live elements rather than detached pre-commit nodes.
        const mutationObserver = new MutationObserver(scan);
        mutationObserver.observe(document.body, { childList: true, subtree: true });

        this.revealCleanup = () => {
            observer.disconnect();
            mutationObserver.disconnect();
        };
    }

    private reveal(el: HTMLElement) {
        // Reachable from setupReveal -> preserved transitively (depth 2).
        el.classList.add('revealed');
    }

    render(): TemplateResult {
        return html`
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
        `;
    }
}
