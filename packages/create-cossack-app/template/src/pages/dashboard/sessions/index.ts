import { Cossack, Page, State, Server } from '@cossackframework/core';
import { html, component } from '@cossackframework/renderer';
import { getCookie } from 'hono/cookie';
import { Card, CardBody, CardHeader, Button, Badge } from '@cossackframework/ui';
import {
    listUserSessions,
    revokeSession,
    revokeAllUserSessions,
    expiredSessionCookie,
    SESSION_COOKIE_NAME,
    type SessionInfo,
} from '../../../auth';

@Page({ transport: 'http' })
export default class SessionsPage extends Cossack {
    @State() sessions: SessionInfo[] = [];
    @State() error = '';

    @Server()
    async init() {
        const currentId = getCookie(this.c, SESSION_COOKIE_NAME);
        this.sessions = await listUserSessions(this.user!.id, currentId);
    }

    @Server()
    async revoke(id: string) {
        try {
            await revokeSession(id);
            const currentId = getCookie(this.c, SESSION_COOKIE_NAME);
            this.sessions = await listUserSessions(this.user!.id, currentId);
        } catch (e: any) {
            this.error = e?.message || 'Could not revoke session';
        }
    }

    @Server()
    async revokeAllExceptCurrent() {
        try {
            const currentId = getCookie(this.c, SESSION_COOKIE_NAME);
            await revokeAllUserSessions(this.user!.id, currentId);
            this.sessions = await listUserSessions(this.user!.id, currentId);
        } catch (e: any) {
            this.error = e?.message || 'Could not revoke sessions';
        }
    }

    @Server()
    async revokeAll() {
        try {
            await revokeAllUserSessions(this.user!.id);
            // Revoking the current session too — clear its cookie (mirror of
            // logout) and bounce to the login page.
            expiredSessionCookie().forEach((value, key) => this.c.header(key, value));
            this.redirect(config('auth.redirectAfterLogout'));
        } catch (e: any) {
            this.error = e?.message || 'Could not revoke sessions';
        }
    }

    private formatDate(iso: string): string {
        try {
            return new Date(iso).toLocaleString();
        } catch {
            return iso;
        }
    }

    render() {
        const current = this.sessions.find((s) => s.current);
        const others = this.sessions.filter((s) => !s.current);
        const renderRow = (s: SessionInfo) => html`
            <tr class="border-t border-border">
                <td class="py-3 pr-4 text-sm text-foreground">
                    <span class="font-mono text-xs">${s.id.slice(0, 8)}…</span>
                </td>
                <td class="py-3 pr-4 text-sm text-muted-foreground">${this.formatDate(s.expiresAt)}</td>
                <td class="py-3 pr-4 text-sm text-muted-foreground">${s.location ?? '—'}</td>
                <td class="py-3 pr-4 text-sm text-muted-foreground truncate max-w-[16rem]">${s.ipAddress ?? '—'}</td>
                <td class="py-3 text-right">
                    ${s.current
                        ? component(Badge, {}, __('Current'))
                        : component(Button, {
                              variant: 'destructive',
                              size: 'sm',
                              '@click': () => this.revoke(s.id),
                          }, __('Revoke'))}
                </td>
            </tr>
        `;

        return html`
            <div class="space-y-8 max-w-5xl">
                <div class="flex items-start justify-between gap-4">
                    <div>
                        <h1 class="text-2xl font-bold text-foreground">${__('Sessions')}</h1>
                        <p class="mt-1 text-sm text-muted-foreground">${__('Devices currently signed in to your account.')}</p>
                    </div>
                    <div class="flex flex-col gap-2 shrink-0">
                        ${component(Button, { variant: 'outline', size: 'sm', '@click': () => this.revokeAllExceptCurrent() },
                            __('Sign out other sessions'))}
                        ${component(Button, { variant: 'destructive', size: 'sm', '@click': () => this.revokeAll() },
                            __('Sign out everywhere'))}
                    </div>
                </div>

                ${this.error ? html`<div class="text-sm text-destructive">${this.error}</div>` : null}

                ${component(Card, {}, html`
                    ${component(CardHeader, {}, html`<h2 class="text-base font-semibold text-foreground">${__('Active sessions')}</h2>`)}
                    ${component(CardBody, {}, html`
                        <table class="w-full">
                            <thead>
                                <tr class="text-left text-xs uppercase tracking-wide text-muted-foreground">
                                    <th class="py-2 pr-4 font-medium">${__('Session')}</th>
                                    <th class="py-2 pr-4 font-medium">${__('Expires')}</th>
                                    <th class="py-2 pr-4 font-medium">${__('Location')}</th>
                                    <th class="py-2 pr-4 font-medium">${__('IP')}</th>
                                    <th class="py-2 text-right font-medium"></th>
                                </tr>
                            </thead>
                            <tbody>
                                ${current ? renderRow(current) : null}
                                ${others.map(renderRow)}
                            </tbody>
                        </table>
                        ${this.sessions.length === 0
                            ? html`<p class="py-6 text-center text-sm text-muted-foreground">${__('No active sessions.')}</p>`
                            : null}
                    `)}
                `)}
            </div>
        `;
    }
}
