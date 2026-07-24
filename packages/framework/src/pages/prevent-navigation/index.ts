import { Cossack, Page, ClientState, PreventNavigation, html, Client } from '@cossackframework/core';
import { component } from '@cossackframework/renderer';
import { Alert, AlertDialog, Input, Typography } from '@cossackframework/ui';

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
            ${component(Typography, { variant: 'h1' }, 'Prevent Navigation Demo')}
            <p>Try typing in the box below and then clicking a link to navigate away.</p>

            ${this.isDirty ? component(Alert, { variant: 'warning' }, 'You have unsaved changes') : ''}
            ${this.inputValue ? html`<div>Current Input: <strong>${this.inputValue}</strong></div>` : ''}

            <div class="my-5">${component(Input, {
                type: 'text', value: this.inputValue,
                '@input': this.onInput, placeholder: 'Type something...',
            })}</div>

            <p>
                <a href="/">Go Home (Trigger Navigation)</a>
            </p>

            <!-- Custom Prompt UI -->
            ${component(AlertDialog, {
                open: !!this._pendingNavigation,
                title: 'Unsaved changes',
                description: 'You have unsaved text in the input field. Are you sure you want to leave?',
                cancelLabel: 'Stay',
                actionLabel: 'Leave without saving',
                onClose: () => this.confirmNavigation(false),
                onAction: () => this.confirmNavigation(true),
            })}
        `;
    }
}
