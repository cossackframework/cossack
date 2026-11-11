import { Client, Cossack, Page, Server, State } from '@cossackframework/core';
import { Alert, Button } from '@cossackframework/ui';
import { html, component } from '@cossackframework/renderer';
import { authSessions, verifyEmail } from '../../../auth';
import { networkFor, siteUrl, type CmsBindings } from '../../../cms/index';
import { networkSite } from '@cossackframework/cms/server';

/**
 * The confirmation link of a new account. Opening it changes nothing: a button confirms, so a
 * mail scanner fetching the link does not spend it, and a link someone else sent cannot sign
 * this browser into their account. Then the account becomes active and signs in; a spent or
 * expired link says so.
 */
@Page({ transport: 'http' })
export default class VerifyPage extends Cossack {
    @State() token = '';
    @State() failed = false;
    /** The email is confirmed and the account waits for an administrator's approval. */
    @State() pending = false;

    async init() {
        this.token = (this.c.req.query('token') ?? '').trim();
        if (!/^[A-Za-z0-9_-]{20,128}$/.test(this.token)) { this.failed = true; this.c.status(400); }
    }

    @Client()
    async submit(event: Event) {
        event.preventDefault();
        await this.confirm(this.token);
    }

    @Server()
    async confirm(token: string) {
        const verified = await verifyEmail(String(token ?? '').trim());
        if (!verified) { this.failed = true; return; }
        // Confirmed, and an administrator still approves the account: no session yet.
        if (verified.pending) { this.pending = true; return; }
        const { headers } = await authSessions.create(verified.user, this.c);
        headers.forEach((value, key) => this.c.header(key, value));
        // Registered on the network for one of its sites: signed in here, the site's handoff takes them there.
        const record = verified.site ? await networkFor(this.c.env as CmsBindings).sites.get(verified.site).catch(() => null) : null;
        const target = record ? siteUrl(this.c.env as CmsBindings, networkSite(record)) : undefined;
        this.redirect(target ? `${target.replace(/\/+$/, '')}/auth/handoff?next=${encodeURIComponent('/dashboard?verified=1')}` : '/dashboard?verified=1');
    }

    render() {
        return html`
            <h3 class="mb-3 text-xl font-semibold text-foreground">${__('Confirm your email')}</h3>
            ${this.pending ? component(Alert, {}, __('Your email address is confirmed. An administrator approves new accounts on this site; we will email you when yours is ready.')) : this.failed ? component(Alert, { variant: 'destructive' }, __('This link is not valid any more. Register again with the same email to get a new one, or sign in if your account is already confirmed.')) : html`
                <form class="space-y-4" @submit=${(event: Event) => this.submit(event)}>
                    <p class="text-sm text-muted-foreground">${__('Confirm your email address to finish creating your account.')}</p>
                    ${component(Button, { type: 'submit', block: true }, __('Confirm email'))}
                </form>`}
            <p class="mt-6 text-center text-sm text-muted-foreground"><a href="/auth/login" class="text-primary font-medium hover:underline">${__('Sign in')}</a></p>
        `;
    }
}
