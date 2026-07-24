import { Cossack, Page, ClientState, On, OnDocument, OnWindow } from '@cossackframework/core';
import { html, component, unsafeHTML } from '@cossackframework/renderer';

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

    @ClientState()
    mountFired: boolean = false;

    @On('mount')
    initWindowSize() {
        // Runs once after the component mounts on the client.
        this.windowSize = `${window.innerWidth}x${window.innerHeight}`;
        this.mountFired = true;
        console.log('[EventsDemo] @On("mount") fired', this.windowSize);
    }

    @On('click')
    handleContainerClick() {
        this.clickCount++;
        console.log('[EventsDemo] @On("click") fired');
    }

    @OnDocument('keydown')
    handleKeydown(event: KeyboardEvent) {
        this.lastKeyPressed = event.key;
        console.log('[EventsDemo] @OnDocument("keydown") fired', event.key);
    }

    @OnWindow('resize')
    handleResize() {
        this.windowSize = `${window.innerWidth}x${window.innerHeight}`;
        console.log('[EventsDemo] @OnWindow("resize") fired', this.windowSize);
    }

    render() {
        return html`
            <div class="p-5 border-2 border-dashed border-gray-300 m-5">
                <h1>Event Syntax Demo</h1>
                <p>Interact with the page to see events in action.</p>

                <div class="grid grid-cols-[repeat(auto-fit,minmax(250px,1fr))] gap-5 mt-5">

                    <div class="p-4 bg-blue-50 rounded-lg">
                        <h3>@On('click')</h3>
                        <p>Clicks on this component (dashed border area):</p>
                        <strong class="text-[2em] text-blue-800">${this.clickCount}</strong>
                    </div>

                    <div class="p-4 bg-green-50 rounded-lg">
                        <h3>@OnDocument('keydown')</h3>
                        <p>Last key pressed anywhere:</p>
                        <strong class="text-[2em] text-green-800">${this.lastKeyPressed}</strong>
                    </div>

                    <div class="p-4 bg-orange-50 rounded-lg">
                        <h3>@OnWindow('resize')</h3>
                        <p>Current Window Size:</p>
                        <strong class="text-[2em] text-orange-800">${this.windowSize}</strong>
                    </div>

                    <div class="p-4 bg-purple-50 rounded-lg">
                        <h3>@On('mount')</h3>
                        <p>Mount handler fired:</p>
                        <strong class="text-[2em] text-purple-800">${this.mountFired ? 'yes' : 'no'}</strong>
                    </div>

                </div>

                <p class="mt-5 italic text-gray-500">
                    Note: These listeners are attached with decorators and cleaned up automatically. No manual addEventListener/removeEventListener needed.
                    ${unsafeHTML('Test <b>Unsafe HTML</b>')}
                </p>
            </div>
        `;
    }
}
