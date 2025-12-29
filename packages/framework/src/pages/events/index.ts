import { Cossack, Page, ClientState, On, OnDocument, OnWindow } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';
import { Layout } from '@/components/Layout';

@Page({
    transport: 'http'
})
export default class EventsDemo extends Cossack {
    @ClientState()
    clickCount: number = 0;

    @ClientState()
    lastKeyPressed: string = 'None';

    @ClientState()
    windowSize: string = 'Unknown';

    @On('click')
    handleContainerClick(event: MouseEvent) {
        this.clickCount++;
        console.log('[EventsDemo] Container clicked', event);
    }

    @OnDocument('keydown')
    handleKeydown(event: KeyboardEvent) {
        this.lastKeyPressed = event.key;
        console.log('[EventsDemo] Key pressed', event.key);
    }

    @OnWindow('resize')
    handleResize() {
        this.windowSize = `${window.innerWidth}x${window.innerHeight}`;
        console.log('[EventsDemo] Window resized', this.windowSize);
    }

    onMount() {
        super.onMount();
        // Initialize window size
        if (typeof window !== 'undefined') {
            this.windowSize = `${window.innerWidth}x${window.innerHeight}`;
        }
    }

    render() {
        return Layout({ dir: 'ltr' }, html`
            <div style="padding: 20px; border: 2px dashed #ccc; margin: 20px;">
                <h1>Event Decorators Demo</h1>
                <p>Interact with the page to see events in action.</p>

                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin-top: 20px;">
                    
                    <div style="padding: 15px; background: #e3f2fd; border-radius: 8px;">
                        <h3>@On('click')</h3>
                        <p>Clicks on this component (dashed border area):</p>
                        <strong style="font-size: 2em; color: #1565c0;">${this.clickCount}</strong>
                    </div>

                    <div style="padding: 15px; background: #e8f5e9; border-radius: 8px;">
                        <h3>@OnDocument('keydown')</h3>
                        <p>Last key pressed anywhere:</p>
                        <strong style="font-size: 2em; color: #2e7d32;">${this.lastKeyPressed}</strong>
                    </div>

                    <div style="padding: 15px; background: #fff3e0; border-radius: 8px;">
                        <h3>@OnWindow('resize')</h3>
                        <p>Current Window Size:</p>
                        <strong style="font-size: 2em; color: #ef6c00;">${this.windowSize}</strong>
                    </div>

                </div>

                <p style="margin-top: 20px; font-style: italic; color: #666;">
                    Note: These are all client-side events handled via decorators. No manual addEventListener required!
                </p>
            </div>
        `);
    }
}
