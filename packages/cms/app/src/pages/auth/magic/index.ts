import { Client, Cossack, Page, Server, State } from '@cossackframework/core';
import { Alert, Button } from '@cossackframework/ui';
import { html, component } from '@cossackframework/renderer';
import { setCookie } from 'hono/cookie';
import { authSessions, beginTwoFactor, consumeMagicLink, SignInPasskeyError, TWO_FACTOR_COOKIE } from '../../../auth';

/**
 * A sign-in link from the email. Opening it signs nobody in: a button does, so a link someone
 * else sent cannot sign this browser into their account, and a mail scanner fetching the link
 * does not spend it. Spent once, the link signs the account in, or starts the second factor's
 * step for an account with one, as a password does; a spent or expired link says so.
 */
@Page({ transport: 'http' })
export default class MagicLinkPage extends Cossack {
    @State() token = '';
    @State() failed = false;
    /** Why the link did not sign in, when it was valid: the account signs in with its passkey. */
    @State() message = '';

    async init() {
        this.token = (this.c.req.query('token') ?? '').trim();
        if (!/^[A-Za-z0-9_-]{20,128}$/.test(this.token)) { this.failed = true; this.c.status(400); }
    }

    @Client()
    async submit(event: Event) {
        event.preventDefault();
        await this.signIn(this.token);
    }

    @Server()
    async signIn(token: string) {
        const userId = await consumeMagicLink(String(token ?? '').trim());
        if (!userId) { this.failed = true; return; }
        // The email stands in for the password only: an enrolled authenticator is still asked for.
        let pending: string | null;
        try { pending = await beginTwoFactor(userId); }
        catch (error) {
            if (!(error instanceof SignInPasskeyError)) throw error;
            this.failed = true; this.message = error.message; return;
        }
        if (pending) {
            setCookie(this.c, TWO_FACTOR_COOKIE, pending, { path: '/', httpOnly: true, sameSite: 'Lax', maxAge: 300, secure: new URL(this.c.req.url).protocol === 'https:' });
            this.redirect('/auth/two-factor');
            return;
        }
        const { headers } = await authSessions.create(userId, this.c);
        headers.forEach((value, key) => this.c.header(key, value));
        this.redirect('/dashboard');
    }

    render() {
        return html`
            <h3 class="mb-3 text-xl font-semibold text-foreground">${__('Sign in')}</h3>
            ${this.failed ? component(Alert, { variant: 'destructive' }, this.message || __('This sign-in link is not valid any more. Ask for a new one from the sign-in page.')) : html`
                <form class="space-y-4" @submit=${(event: Event) => this.submit(event)}>
                    <p class="text-sm text-muted-foreground">${__('Continue to sign in with the link from your email.')}</p>
                    ${component(Button, { type: 'submit', block: true }, __('Sign in'))}
                </form>`}
            <p class="mt-6 text-center text-sm text-muted-foreground"><a href="/auth/login" class="text-primary font-medium hover:underline">${__('Back to sign in')}</a></p>
        `;
    }
}
