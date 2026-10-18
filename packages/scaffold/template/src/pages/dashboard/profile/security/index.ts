import { Cossack, Page, State, Server, Client, type HeadValue } from '@cossackframework/core';
import { Alert, Badge, Button, Card, CardBody, CardHeader, Field, Input, toast } from '@cossackframework/ui';
import { html, component, unsafeHTML, type TemplateResult } from '@cossackframework/renderer';
import {
    addPasskey, apiTokensAvailable, confirmAuthenticator, createApiToken, disableAuthenticator, listApiTokens, newRecoveryCodes, passkeyRegistration,
    removePasskey, revokeApiToken, securityStatus, startAuthenticator, twoFactorAvailable, type ApiToken, type PublicUser, type SecurityStatus,
} from '../../../../auth';
import { createPasskey } from '../../../../passkeys.client';
import { AppPasswords } from '../../../../dashboard/app-passwords';

const date = (value: number | null) => value ? new Date(value).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : '—';

/**
 * Account security: two-step sign-in with an authenticator app (and recovery codes),
 * passkeys, and application passwords for apps and scripts that use the content API.
 */
@Page({ transport: 'http' })
export default class SecurityPage extends Cossack {
    @State() available = false;
    @State() tokensAvailable = false;
    @State() status: SecurityStatus = { totp: false, recoveryCodes: 0, passkeys: [] };
    @State() setup: { secret: string; uri: string; qr: string } | null = null;
    @State() code = '';
    @State() recoveryCodes: string[] = [];
    @State() passkeyName = '';
    @State() tokens: ApiToken[] = [];
    @State() newToken = '';
    @State() required = false;
    @State() recovered = false;
    @State() error = '';

    head(): HeadValue {
        return { title: __('Security') };
    }

    async init() {
        this.available = twoFactorAvailable;
        this.tokensAvailable = apiTokensAvailable;
        this.required = this.c.req.query('required') === '1';
        this.recovered = this.c.req.query('recovered') === '1';
        await this.load();
    }

    private async load() {
        const user = this.user as PublicUser | undefined;
        if (!user) return;
        this.status = await securityStatus(user.id);
        this.tokens = await listApiTokens(user.id);
    }

    // --- Authenticator app -------------------------------------------------------

    @Server()
    async beginSetup() {
        this.error = '';
        this.recoveryCodes = [];
        this.setup = await startAuthenticator(this.user as PublicUser);
    }

    @Server()
    async finishSetup(code: string) {
        this.error = '';
        try {
            this.recoveryCodes = await confirmAuthenticator(this.user!.id, code);
            this.setup = null;
            this.code = '';
            await this.load();
        } catch (error) { this.error = (error as Error).message; }
    }

    @Server()
    async turnOff(code: string) {
        this.error = '';
        try {
            await disableAuthenticator(this.user!.id, code);
            this.code = '';
            this.recoveryCodes = [];
            await this.load();
        } catch (error) { this.error = (error as Error).message; }
    }

    @Server()
    async regenerate(code: string) {
        this.error = '';
        try {
            this.recoveryCodes = await newRecoveryCodes(this.user!.id, code);
            this.code = '';
            await this.load();
        } catch (error) { this.error = (error as Error).message; }
    }

    @Client()
    async copyCodes() {
        try { await navigator.clipboard.writeText(this.recoveryCodes.join('\n')); toast.success(__('Recovery codes copied.')); }
        catch { toast.error(__('Copy the codes from the list.')); }
    }

    // --- Passkeys ------------------------------------------------------------------

    @Client()
    async addPasskey() {
        this.error = '';
        try {
            const { challenge, options } = await this.passkeyOptions();
            const response = await createPasskey(options);
            await this.savePasskey(challenge, response, this.passkeyName || navigatorName());
            if (!this.error) { this.passkeyName = ''; toast.success(__('Passkey added.')); }
        } catch (error) {
            if ((error as Error)?.name === 'NotAllowedError') return;
            this.error = (error as Error)?.message || __('The passkey could not be added.');
        }
    }

    @Server()
    async passkeyOptions() {
        return passkeyRegistration(this.c, this.user as PublicUser);
    }

    @Server()
    async savePasskey(challenge: string, response: unknown, name: string) {
        this.error = '';
        try {
            await addPasskey(this.c, this.user as PublicUser, challenge, response as never, name);
            await this.load();
        } catch (error) { this.error = (error as Error).message; }
    }

    @Server()
    async deletePasskey(id: string) {
        await removePasskey(this.user!.id, id);
        await this.load();
    }

    // --- Application passwords -----------------------------------------------------

    /** Returns whether the password was created; the form keeps its values otherwise. */
    @Server()
    async addToken(name: string, scope: 'read' | 'write'): Promise<boolean> {
        this.error = '';
        try {
            this.newToken = await createApiToken(this.user!.id, name, scope === 'read' ? 'read' : 'write');
            await this.load();
            return true;
        } catch (error) {
            this.error = (error as Error).message;
            return false;
        }
    }

    @Server()
    async deleteToken(id: string) {
        await revokeApiToken(this.user!.id, id);
        await this.load();
    }

    private authenticator(): TemplateResult {
        const codeInput = (id: string) => component(Input, { id, autocomplete: 'one-time-code', inputmode: 'numeric', maxlength: 20, placeholder: '123456', class: 'max-w-40',
            '.value': this.code, '@input': (event: Event) => { this.code = (event.target as HTMLInputElement).value; } });
        if (this.setup) return html`<div class="space-y-4">
            <ol class="list-decimal space-y-1 pl-5 text-sm text-foreground">
                <li>${__('Scan this code with an authenticator app, such as 1Password, Google Authenticator or Microsoft Authenticator.')}</li>
                <li>${__('Enter the 6-digit code the app shows.')}</li>
            </ol>
            <div class="flex flex-wrap items-start gap-6">
                <div class="size-44 rounded-md border border-border bg-white p-2 text-black [&_svg]:h-full [&_svg]:w-full" role="img" aria-label=${__('QR code for the authenticator app')}>${unsafeHTML(this.setup.qr)}</div>
                <div class="space-y-2 text-sm">
                    <p class="text-muted-foreground">${__('Cannot scan? Enter this key:')}</p>
                    <code class="block break-all rounded bg-muted px-2 py-1 text-xs" data-totp-secret>${this.setup.secret}</code>
                </div>
            </div>
            <form class="flex flex-wrap items-end gap-2" @submit=${(event: Event) => { event.preventDefault(); void this.finishSetup(this.code); }}>
                ${component(Field, { label: __('Code'), for: 'totp-confirm', control: () => codeInput('totp-confirm') })}
                ${component(Button, { type: 'submit', disabled: !this.code.trim() }, __('Turn on'))}
                ${component(Button, { type: 'button', variant: 'ghost', '@click': () => { this.setup = null; } }, __('Cancel'))}
            </form>
        </div>`;
        if (!this.status.totp) return html`<div class="space-y-3">
            <p class="text-sm text-muted-foreground">${__('After your password, sign-in asks for a code from an app on your phone, so a stolen password is not enough.')}</p>
            ${component(Button, { type: 'button', '@click': () => this.beginSetup() }, __('Set up an authenticator app'))}
        </div>`;
        return html`<div class="space-y-4">
            <p class="flex items-center gap-2 text-sm text-foreground">${component(Badge, { variant: 'success' }, __('On'))} ${__('Sign-in asks for a code from your authenticator app.')}</p>
            <p class="text-sm text-muted-foreground">${this.status.recoveryCodes} ${__('recovery codes left. Each works once, when you do not have your phone.')}</p>
            <form class="flex flex-wrap items-end gap-2" @submit=${(event: Event) => event.preventDefault()}>
                ${component(Field, { label: __('Current code'), for: 'totp-current', hint: __('From the app, or a recovery code.'), control: () => codeInput('totp-current') })}
                ${component(Button, { type: 'button', variant: 'outline', disabled: !this.code.trim(), '@click': () => this.regenerate(this.code) }, __('New recovery codes'))}
                ${component(Button, { type: 'button', variant: 'destructive', disabled: !this.code.trim(), '@click': () => this.turnOff(this.code) }, __('Turn off'))}
            </form>
        </div>`;
    }

    render() {
        if (!this.available && !this.tokensAvailable) return html`<div class="max-w-2xl space-y-4">
            <h1 class="text-2xl font-bold text-foreground">${__('Security')}</h1>
            <p class="text-sm text-muted-foreground">${__('This site signs in with passwords. Two-step sign-in and passkeys come with the CMS auth store.')}</p>
        </div>`;
        return html`<div class="max-w-3xl space-y-8">
            <div class="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h1 class="text-2xl font-bold text-foreground">${__('Security')}</h1>
                    <p class="mt-1 text-sm text-muted-foreground">${__('Protect your account, and connect apps to the content API.')}</p>
                </div>
                <a href="/dashboard/profile" class="text-sm text-muted-foreground hover:text-foreground">← ${__('Profile')}</a>
            </div>
            ${this.required ? component(Alert, { variant: 'warning' }, __('This site requires two-step sign-in. Add an authenticator app or a passkey to continue.')) : null}
            ${this.recovered ? component(Alert, { variant: 'warning' }, __('You signed in with a recovery code. If you lost your phone, turn the authenticator off and set it up again.')) : null}
            ${this.error ? component(Alert, { variant: 'destructive' }, this.error) : null}
            ${this.recoveryCodes.length ? component(Card, {}, html`${component(CardHeader, {}, html`<h2 class="text-base font-semibold text-foreground">${__('Your recovery codes')}</h2>`)}
                ${component(CardBody, { class: 'space-y-3' }, html`<p class="text-sm text-muted-foreground">${__('Save them somewhere safe. They are shown only now; each signs you in once without your phone.')}</p>
                    <ul class="grid grid-cols-2 gap-1 font-mono text-sm sm:grid-cols-5" data-recovery-codes>${this.recoveryCodes.map(code => html`<li class="rounded bg-muted px-2 py-1 text-center">${code}</li>`)}</ul>
                    ${component(Button, { type: 'button', variant: 'outline', size: 'sm', '@click': () => this.copyCodes() }, __('Copy'))}`)}`) : null}
            ${this.available ? component(Card, {}, html`${component(CardHeader, {}, html`<h2 class="text-base font-semibold text-foreground">${__('Two-step sign-in')}</h2>`)}
                ${component(CardBody, {}, this.authenticator())}`) : null}
            ${this.available ? component(Card, {}, html`${component(CardHeader, {}, html`<h2 class="text-base font-semibold text-foreground">${__('Passkeys')}</h2>
                <p class="text-sm text-muted-foreground">${__('Sign in with your fingerprint, face or device PIN instead of a password. Passkeys cannot be phished.')}</p>`)}
                ${component(CardBody, { class: 'space-y-4' }, html`
                    ${this.status.passkeys.length ? html`<ul class="divide-y divide-border rounded-md border border-border">${this.status.passkeys.map(passkey => html`<li class="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                        <span><span class="font-medium text-foreground">${passkey.name}</span> <span class="text-xs text-muted-foreground">· ${__('added')} ${date(passkey.createdAt)} · ${__('last used')} ${date(passkey.lastUsedAt)}${passkey.backedUp ? ` · ${__('synced')}` : ''}</span></span>
                        <button type="button" class="text-xs text-destructive hover:underline bg-transparent border-none p-0 cursor-pointer" @click=${() => this.deletePasskey(passkey.id)}>${__('Remove')}</button>
                    </li>`)}</ul>` : html`<p class="text-sm text-muted-foreground">${__('No passkeys yet.')}</p>`}
                    <div class="flex flex-wrap items-end gap-2">
                        ${component(Field, { label: __('Name'), for: 'passkey-name', control: attributes => component(Input, { ...attributes, maxlength: 80, placeholder: __('Such as Work laptop'),
                            '.value': this.passkeyName, '@input': (event: Event) => { this.passkeyName = (event.target as HTMLInputElement).value; } }) })}
                        ${component(Button, { type: 'button', variant: 'outline', '@click': () => this.addPasskey() }, __('Add a passkey'))}
                    </div>`)}`) : null}
            ${this.tokensAvailable ? component(Card, {}, html`${component(CardHeader, {}, html`<h2 class="text-base font-semibold text-foreground">${__('Application passwords')}</h2>
                <p class="text-sm text-muted-foreground">${__('Let apps and scripts use the content API as you: send the password as Authorization: Bearer. Revoke one to cut off its app.')}</p>`)}
                ${component(CardBody, {}, component(AppPasswords, { tokens: this.tokens, newToken: this.newToken,
                    onAdd: (name: string, scope: 'read' | 'write') => this.addToken(name, scope), onRevoke: (id: string) => this.deleteToken(id) }))}`) : null}
        </div>`;
    }
}

/** A default passkey name from the browser, such as `Chrome on macOS`. */
function navigatorName(): string {
    const agent = navigator.userAgent;
    const browser = /Edg\//.test(agent) ? 'Edge' : /Firefox\//.test(agent) ? 'Firefox' : /Chrome\//.test(agent) ? 'Chrome' : /Safari\//.test(agent) ? 'Safari' : 'Browser';
    const system = /Mac OS X/.test(agent) ? 'macOS' : /Windows/.test(agent) ? 'Windows' : /Android/.test(agent) ? 'Android' : /iPhone|iPad/.test(agent) ? 'iOS' : /Linux/.test(agent) ? 'Linux' : '';
    return system ? `${browser} on ${system}` : browser;
}
