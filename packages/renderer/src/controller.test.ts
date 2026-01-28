import { describe, it, expect, vi } from 'vitest';
import { CossackElement, ReactiveController, ReactiveControllerHost } from './cossack-element';
import { html, renderToString } from './cossack-html';

describe('Reactive Controllers', () => {
    
    class TestController implements ReactiveController {
        host: ReactiveControllerHost;
        value = 0;
        
        constructor(host: ReactiveControllerHost) {
            this.host = host;
            host.addController(this);
        }

        increment() {
            this.value++;
            this.host.requestUpdate();
        }

        hostConnected = vi.fn();
        hostDisconnected = vi.fn();
        hostUpdate = vi.fn();
        hostUpdated = vi.fn();
    }

    class HostElement extends CossackElement {
        controller = new TestController(this);
        
        render() {
            return html`Value: ${this.controller.value}`;
        }
    }

    it('integrates with host lifecycle', async () => {
        const host = new HostElement();
        
        host.connectedCallback();
        expect(host.controller.hostConnected).toHaveBeenCalled();
        
        await host.requestUpdate();
        expect(host.controller.hostUpdate).toHaveBeenCalled();
        expect(host.controller.hostUpdated).toHaveBeenCalled();
        expect(renderToString(host.render()!)).toBe('Value: 0');
        
        host.controller.increment();
        await host.updateComplete;
        
        expect(host.controller.hostUpdate).toHaveBeenCalledTimes(2);
        expect(renderToString(host.render()!)).toBe('Value: 1');
        
        host.disconnectedCallback();
        expect(host.controller.hostDisconnected).toHaveBeenCalled();
    });
});