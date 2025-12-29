import { Cossack, Page, State, Task, VisibleTask, ClientState } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';
import { Layout } from '@/components/Layout';

@Page({
    transport: 'durable-object'
})
export default class LifecycleDemo extends Cossack {
    @State()
    count: number = 0;

    @ClientState()
    logs: string[] = [];

    @ClientState()
    isVisible: boolean = false;

    @Task()
    logUpdate() {
        const message = `[Task] Component updated. Count: ${this.count} (${this.isServer ? 'Server' : 'Client'})`;
        console.log(message);
        if (!this.isServer) {
            this.logs = [...this.logs, message];
        }
    }

    @VisibleTask({ strategy: 'intersection-observer', threshold: 0.5, selector: '#visible-target' })
    onVisible() {
        console.log('[VisibleTask] Element is now visible!');
        this.isVisible = true;
        this.logs = [...this.logs, '[VisibleTask] Element is now visible!'];
        
        return () => {
            console.log('[VisibleTask] Cleanup (if implemented)');
        };
    }

    increment() {
        this.count++;
    }

    render() {
        const targetStyle = `
            padding: 50px; 
            background: ${this.isVisible ? '#d4edda' : '#f8d7da'}; 
            color: ${this.isVisible ? '#155724' : '#721c24'};
            border: 2px solid ${this.isVisible ? '#c3e6cb' : '#f5c6cb'};
            text-align: center;
            transition: all 0.5s ease;
        `;

        return Layout({ dir: 'ltr' }, html`
            <div style="padding: 20px;">
                <h1>Lifecycle Hooks Demo</h1>
                <p>Open console to see logs.</p>

                <div style="margin-bottom: 20px; padding: 10px; border: 1px solid #ccc; background: #f9f9f9;">
                    <h2>@Task Demo</h2>
                    <p>Current Count: ${this.count}</p>
                    <button @click=${() => this.increment()}>Increment (Triggers Task)</button>
                    
                    <h3>Logs:</h3>
                    <ul style="max-height: 200px; overflow-y: auto; background: #333; color: #fff; padding: 10px; font-family: monospace;">
                        ${this.logs.map(log => html`<li>${log}</li>`)}
                    </ul>
                </div>

                <div style="height: 120vh; background: linear-gradient(to bottom, #fff, #eee); display: flex; align-items: center; justify-content: center;">
                    <p>Scroll down to see @VisibleTask in action...</p>
                </div>

                <div id="visible-target" style="${targetStyle}">
                    <h2>@VisibleTask Target</h2>
                    <p>${this.isVisible ? 'I am VISIBLE!' : 'I am NOT yet visible (or observer waiting)'}</p>
                </div>

                <div style="height: 50vh;"></div>
            </div>
        `);
    }
}
