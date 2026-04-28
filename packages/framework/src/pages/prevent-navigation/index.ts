import { Cossack, Page, ClientState, PreventNavigation, html, Client } from '@cossackframework/core';

@Page()
export default class PreventNavigationDemo extends Cossack {
    @ClientState()
    inputValue: string = '';

    @ClientState()
    isDirty: boolean = false;

    @Client()
    onInput(e: Event) {
        const target = e.currentTarget as HTMLInputElement;
        this.inputValue = target.value;
        this.isDirty = this.inputValue.length > 0;
    }

    @PreventNavigation()
    checkNavigation() {
        // Return true to PREVENT navigation (has unsaved changes)
        return this.isDirty;
    }

    render() {
        return html`
            <h1>Prevent Navigation Demo</h1>
            <p>Try typing in the box below and then clicking a link to navigate away.</p>

            ${this.isDirty ? html`<div class="text-amber-500 font-bold mb-2.5">You have unsaved changes</div>` : ''}
            ${this.inputValue ? html`<div>Current Input: <strong>${this.inputValue}</strong></div>` : ''}

            <input
                type="text"
                value="${this.inputValue}"
                @input="${this.onInput}"
                placeholder="Type something..."
                class="p-2 w-full box-border mb-5"
            />

            <p>
                <a href="/">Go Home (Trigger Navigation)</a>
            </p>

            <!-- Custom Prompt UI -->
            ${this._pendingNavigation ? html`
                <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-[1000]">
                    <div class="bg-white p-5 rounded-lg shadow-lg max-w-[400px]">
                        <h3>Unsaved Changes</h3>
                        <p>You have unsaved text in the input field. Are you sure you want to leave?</p>
                        <div class="mt-4 flex gap-2.5 justify-end">
                            <button class="py-2 px-4 rounded cursor-pointer border-none bg-gray-200 text-black" @click="${() => this.confirmNavigation(false)}">
                                Stay
                            </button>
                            <button class="py-2 px-4 rounded cursor-pointer border-none bg-red-500 text-white" @click="${() => this.confirmNavigation(true)}">
                                Leave without saving
                            </button>
                        </div>
                    </div>
                </div>
            ` : ''}
        `;
    }
}
