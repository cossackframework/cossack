import { Cossack, Page, State, Server } from '@cossackframework/core';
import { Card, CardBody, CardHeader, Button } from '@cossackframework/ui';
import { html, component } from '@cossackframework/renderer';
import { getCookie } from 'hono/cookie';
import {
    authSessions,
    listUserSessions,
    revokeSession,
    revokeAllUserSessions,
    expiredSessionCookie,
    type SessionInfo,
} from '../../../auth';
import { sessionTable } from '../../../dashboard/session-list';

@Page({ transport: 'http' })
export default class SessionsPage extends Cossack {
    @State() sessions: SessionInfo[] = [];
    @State() error = '';

    @Server()
    async init() {
        this.sessions = [];
        this.error = '';
        try {
            this.sessions = await listUserSessions(this.c);
        } catch {
            this.error = 'Could not load sessions.';
        }
    }

    @Server()
    async revoke(reference: string) {
        this.error = '';
        try {
            const revoked = await revokeSession(this.c, reference);
            this.sessions = await listUserSessions(this.c);
            if (!revoked) this.error = 'Could not revoke session.';
        } catch {
            this.error = 'Could not revoke session.';
        }
    }

    @Server()
    async rotateCurrent() {
        this.error = '';
        try {
            const result = await authSessions.rotate(getCookie(this.c, authSessions.cookieName) ?? '', this.c);
            if (!result) { this.error = 'Could not rotate session. Try again.'; return; }
            result.headers.forEach((value, key) => this.c.header(key, value));
            // Refresh with the replacement cookie before listing current sessions.
            this.redirect('/dashboard/sessions');
        } catch {
            this.error = 'Could not rotate session. Try again.';
        }
    }

    @Server()
    async revokeAllExceptCurrent() {
        this.error = '';
        try {
            await revokeAllUserSessions(this.c, true);
            this.sessions = await listUserSessions(this.c);
        } catch {
            this.error = 'Could not revoke sessions.';
        }
    }

    @Server()
    async revokeAll() {
        this.error = '';
        try {
            await revokeAllUserSessions(this.c);
            // Revoking the current session too — clear its cookie (mirror of
            // logout) and bounce to the login page.
            expiredSessionCookie().forEach((value, key) => this.c.header(key, value));
            this.redirect(config('auth.redirectAfterLogout'));
        } catch {
            this.error = 'Could not revoke sessions.';
        }
    }

    render() {
        return html`
            <div class="space-y-8 max-w-5xl">
                <div>
                    <h1 class="text-2xl font-bold text-foreground">${__('Sessions')}</h1>
                    <p class="mt-1 text-sm text-muted-foreground">${__('Devices currently signed in to your account.')}</p>
                </div>

                ${this.error ? html`<div class="text-sm text-destructive">${this.error}</div>` : null}

                ${component(Card, {}, html`
                    ${component(CardHeader, {}, html`<h2 class="text-base font-semibold text-foreground">${__('Active sessions')}</h2>`)}
                    ${component(CardBody, {}, sessionTable(this.sessions, { id: 'account-sessions', onRevoke: (reference) => this.revoke(reference) }))}
                `)}

                <div class="flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-2">
                    ${component(Button, { variant: 'outline', size: 'sm', '@click': () => this.rotateCurrent() },
                        __('Rotate current session'))}
                    ${component(Button, { variant: 'outline', size: 'sm', '@click': () => this.revokeAllExceptCurrent() },
                        __('Sign out other sessions'))}
                    ${component(Button, { variant: 'destructive', size: 'sm', '@click': () => this.revokeAll() },
                        __('Sign out everywhere'))}
                </div>
            </div>
        `;
    }
}
