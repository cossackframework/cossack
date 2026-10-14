import { describe, it, expect, vi } from 'vitest';
import { CossackElement, ReactiveController, ReactiveControllerHost } from './cossack-element';
import { html, renderToString, component } from './cossack-html';

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

    describe('SSR component() lifecycle', () => {
        class ClockController implements ReactiveController {
            timer: ReturnType<typeof setInterval> | undefined;
            static live = 0;
            constructor(host: ReactiveControllerHost) { host.addController(this); }
            hostConnected() { ClockController.live++; this.timer = setInterval(() => {}, 1000); }
            hostDisconnected() { ClockController.live--; clearInterval(this.timer); }
        }
        class Clock extends CossackElement {
            clock = new ClockController(this);
            render() { return html`<time>now</time>`; }
        }
        class Broken extends CossackElement {
            clock = new ClockController(this);
            render(): ReturnType<CossackElement['render']> { throw new Error('render failed'); }
        }

        it('disconnects SSR component instances after rendering', () => {
            ClockController.live = 0;
            for (let i = 0; i < 3; i++) {
                expect(renderToString(component(Clock))).toBe('<time>now</time>');
            }
            expect(ClockController.live).toBe(0);
        });

        it('disconnects SSR component instances when render throws', () => {
            ClockController.live = 0;
            expect(() => renderToString(component(Broken))).toThrow('render failed');
            expect(ClockController.live).toBe(0);
        });
    });
});
