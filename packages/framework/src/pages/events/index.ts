import { Cossack, Page, ClientState } from '@cossackframework/core';
import { html, component } from '@cossackframework/renderer';
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

    private handleKeydown = (event: KeyboardEvent) => {
        this.lastKeyPressed = event.key;
        console.log('[EventsDemo] Key pressed', event.key);
    };

    private handleResize = () => {
        this.windowSize = `${window.innerWidth}x${window.innerHeight}`;
        console.log('[EventsDemo] Window resized', this.windowSize);
    };

    onMount() {
        super.onMount();
        // Initialize window size
        if (typeof window !== 'undefined') {
            this.windowSize = `${window.innerWidth}x${window.innerHeight}`;
            // Document and window events need manual listeners
            document.addEventListener('keydown', this.handleKeydown);
            window.addEventListener('resize', this.handleResize);
        }
    }

    onCleanup() {
        super.onCleanup();
        document.removeEventListener('keydown', this.handleKeydown);
        window.removeEventListener('resize', this.handleResize);
    }

    render() {
        return component(Layout, { dir: 'ltr' }, html`
            <div @click=${() => { this.clickCount++; console.log('[EventsDemo] Container clicked'); }} class="p-5 border-2 border-dashed border-gray-300 m-5">
                <h1>Event Syntax Demo</h1>
                <p>Interact with the page to see events in action.</p>

                <div class="grid grid-cols-[repeat(auto-fit,minmax(250px,1fr))] gap-5 mt-5">

                    <div class="p-4 bg-blue-50 rounded-lg">
                        <h3>@click</h3>
                        <p>Clicks on this component (dashed border area):</p>
                        <strong class="text-[2em] text-blue-800">${this.clickCount}</strong>
                    </div>

                    <div class="p-4 bg-green-50 rounded-lg">
                        <h3>document @keydown</h3>
                        <p>Last key pressed anywhere:</p>
                        <strong class="text-[2em] text-green-800">${this.lastKeyPressed}</strong>
                    </div>

                    <div class="p-4 bg-orange-50 rounded-lg">
                        <h3>window @resize</h3>
                        <p>Current Window Size:</p>
                        <strong class="text-[2em] text-orange-800">${this.windowSize}</strong>
                    </div>

                </div>

                <p class="mt-5 italic text-gray-500">
                    Note: Element events use Lit-like @event syntax. Document/window events use onMount listeners.
                </p>
            </div>
        `);
    }
}
