/**
 * Application passwords: tokens that apps and scripts send to the content API as
 * `Authorization: Bearer`, acting as their user with the user's roles. Shared by Profile →
 * Security and the user screen; the page owns the list and the new password, shown once.
 */
import { Client, ClientState, Component, Cossack } from '@cossackframework/core';
import { Badge, Button, Field, Input, NativeSelect, toast } from '@cossackframework/ui';
import { html, component } from '@cossackframework/renderer';
import type { ApiToken } from '../auth';

export type AppPasswordsProps = {
    tokens: ApiToken[];
    /** The password just created; it is shown once. */
    newToken: string;
    /** Resolves to false when the password was not created, keeping the form. */
    onAdd(name: string, scope: 'read' | 'write'): unknown;
    onRevoke(id: string): unknown;
};

const date = (value: number | null) => value ? new Date(value).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : '—';

@Component()
export class AppPasswords extends Cossack {
    declare props: AppPasswordsProps;
    @ClientState() private name = '';
    @ClientState() private scope: 'read' | 'write' = 'write';

    @Client()
    private async submit(event: Event) {
        event.preventDefault();
        const name = this.name.trim();
        if (!name) return;
        if ((await this.props.onAdd(name, this.scope)) === false) return;
        this.name = '';
        this.scope = 'write';
    }

    @Client()
    private async copy() {
        try { await navigator.clipboard.writeText(this.props.newToken); toast.success(__('Copied.')); }
        catch { toast.error(__('Copy it from the box.')); }
    }

    render() {
        return html`<div class="space-y-4">
            ${this.props.newToken ? html`<div class="space-y-2 rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3">
                <p class="text-sm font-medium text-foreground">${__('Copy the new application password now. You will not see it again.')}</p>
                <div class="flex gap-2"><input readonly class="w-full rounded-md border border-input bg-background px-3 py-1.5 font-mono text-xs" aria-label=${__('New application password')} .value=${this.props.newToken} data-new-token>
                    ${component(Button, { type: 'button', size: 'sm', variant: 'outline', '@click': () => this.copy() }, __('Copy'))}</div>
            </div>` : null}
            <form class="flex flex-wrap items-end gap-2" @submit=${(event: Event) => this.submit(event)}>
                ${component(Field, { label: __('Name'), for: 'token-name', control: attributes => component(Input, { ...attributes, required: true, maxlength: 80, placeholder: __('Such as Mobile app'),
                    '.value': this.name, '@input': (event: Event) => { this.name = (event.target as HTMLInputElement).value; } }) })}
                ${component(Field, { label: __('Access'), for: 'token-scope', control: attributes => component(NativeSelect, { ...attributes, '@change': (event: Event) => { this.scope = (event.target as HTMLSelectElement).value === 'read' ? 'read' : 'write'; } }, html`
                    <option value="write" ?selected=${this.scope === 'write'}>${__('Read and write')}</option><option value="read" ?selected=${this.scope === 'read'}>${__('Read only')}</option>`) })}
                ${component(Button, { type: 'submit', disabled: !this.name.trim() }, __('Add application password'))}
            </form>
            ${this.props.tokens.length ? html`<ul class="divide-y divide-border rounded-md border border-border">${this.props.tokens.map(token => html`<li class="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm" data-token=${token.name}>
                <span><span class="font-medium text-foreground">${token.name}</span> ${component(Badge, { variant: 'secondary' }, token.scope === 'read' ? __('Read only') : __('Read and write'))}
                    <span class="block text-xs text-muted-foreground">${__('created')} ${date(token.createdAt)} · ${__('last used')} ${date(token.lastUsedAt)}</span></span>
                <button type="button" class="text-xs text-destructive hover:underline bg-transparent border-none p-0 cursor-pointer" @click=${() => this.props.onRevoke(token.id)}>${__('Revoke')}</button>
            </li>`)}</ul>` : html`<p class="text-sm text-muted-foreground">${__('No application passwords yet.')}</p>`}
        </div>`;
    }
}
