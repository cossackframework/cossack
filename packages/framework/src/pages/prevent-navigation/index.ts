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
        // Return true to BLOCK navigation
        return this.isDirty;
    }

    render() {
        return html`
            <style>
                .modal-overlay {
                    position: fixed; top: 0; left: 0; right: 0; bottom: 0;
                    background: rgba(0,0,0,0.5); display: flex;
                    align-items: center; justify-content: center; z-index: 1000;
                }
                .modal {
                    background: white; padding: 20px; border-radius: 8px;
                    box-shadow: 0 4px 6px rgba(0,0,0,0.1); max-width: 400px;
                }
                .actions { margin-top: 15px; display: flex; gap: 10px; justify-content: flex-end; }
                .btn { padding: 8px 16px; border-radius: 4px; cursor: pointer; border: none; }
                .btn-danger { background: #ef4444; color: white; }
                .btn-secondary { background: #e5e7eb; color: black; }
                .dirty-indicator { color: #f59e0b; font-weight: bold; margin-bottom: 10px; }
            </style>

            <h1>Prevent Navigation Demo</h1>
            <p>Try typing in the box below and then clicking a link to navigate away.</p>

            ${this.isDirty ? html`<div class="dirty-indicator">âš ï¸ You have unsaved changes</div>` : ''}

            <input 
                type="text" 
                value="${this.inputValue}" 
                @input="${this.onInput}"
                placeholder="Type something..."
                style="padding: 8px; width: 100%; box-sizing: border-box; margin-bottom: 20px;"
            />

            <p>
                <a href="/">Go Home (Trigger Navigation)</a>
            </p>

            <!-- Custom Prompt UI -->
            ${this._pendingNavigation ? html`
                <div class="modal-overlay">
                    <div class="modal">
                        <h3>Unsaved Changes</h3>
                        <p>You have unsaved text in the input field. Are you sure you want to leave?</p>
                        <div class="actions">
                            <button class="btn btn-secondary" @click="${() => this.confirmNavigation(false)}">
                                Stay
                            </button>
                            <button class="btn btn-danger" @click="${() => this.confirmNavigation(true)}">
                                Leave without saving
                            </button>
                        </div>
                    </div>
                </div>
            ` : ''}
        `;
    }
}
