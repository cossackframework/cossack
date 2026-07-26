import { Cossack, Page, State, Server } from '@cossackframework/core';
import { Card, CardBody, CardHeader, Button, Badge, Tooltip, Icon } from '@cossackframework/ui';
import { html, component } from '@cossackframework/renderer';
import { getCookie } from 'hono/cookie';
import { MonitorSmartphoneIcon as monitorSmartphoneIconSvg } from '@cossackframework/solar-icons/monitor-smartphone/line';
import { SmartphoneIcon as smartphoneIconSvg } from '@cossackframework/solar-icons/smartphone/line';
import { LaptopIcon as laptopIconSvg } from '@cossackframework/solar-icons/laptop/line';
import { TabletIcon as tabletIconSvg } from '@cossackframework/solar-icons/tablet/line';
import { MonitorIcon as monitorIconSvg } from '@cossackframework/solar-icons/monitor/line';
import {
    listUserSessions,
    revokeSession,
    revokeAllUserSessions,
    expiredSessionCookie,
    SESSION_COOKIE_NAME,
    type SessionInfo,
} from '../../../auth';

const monitorSmartphoneIcon = { line: monitorSmartphoneIconSvg };
const smartphoneIcon = { line: smartphoneIconSvg };
const laptopIcon = { line: laptopIconSvg };
const tabletIcon = { line: tabletIconSvg };
const monitorIcon = { line: monitorIconSvg };

/**
 * Parses a User-Agent string into device type + human-readable browser/OS.
 * Intentionally lightweight (no dep) — good enough for a sessions list tooltip.
 */
function parseUserAgent(ua: string | null): {
    device: 'mobile' | 'tablet' | 'desktop';
    browser: string;
    os: string;
} {
    if (!ua) return { device: 'desktop', browser: 'Unknown', os: 'Unknown' };
    const lower = ua.toLowerCase();
    // OS
    let os = 'Unknown';
    if (/windows/.test(lower)) os = 'Windows';
    else if (/mac os|macintosh|iphone|ipad/.test(lower)) os = /ipad|iphone/.test(lower) ? 'iOS' : 'macOS';
    else if (/android/.test(lower)) os = 'Android';
    else if (/linux/.test(lower)) os = 'Linux';
    // Browser (order matters — check specific ones first)
    let browser = 'Unknown';
    if (/edg\//.test(lower)) browser = 'Edge';
    else if (/opr\/|opera/.test(lower)) browser = 'Opera';
    else if (/chrome/.test(lower) && !/chromium/.test(lower)) browser = 'Chrome';
    else if (/firefox/.test(lower)) browser = 'Firefox';
    else if (/safari/.test(lower)) browser = 'Safari';
    // Device type
    let device: 'mobile' | 'tablet' | 'desktop' = 'desktop';
    if (/ipad|tablet/.test(lower)) device = 'tablet';
    else if (/mobi|iphone|android.*mobile/.test(lower)) device = 'mobile';
    return { device, browser, os };
}

const DEVICE_ICON = {
    mobile: smartphoneIcon,
    tablet: tabletIcon,
    desktop: monitorIcon,
} as const;

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
        const iconBtn = 'inline-flex items-center justify-center [&_svg]:size-4';

        const renderRow = (s: SessionInfo) => {
            const ua = parseUserAgent(s.userAgent);
            const deviceLabel = ua.device === 'mobile' ? 'Mobile'
                : ua.device === 'tablet' ? 'Tablet'
                : 'Desktop';
            const uaSummary = `${deviceLabel} · ${ua.browser} · ${ua.os}`;
            const deviceEntry = (DEVICE_ICON as any)[ua.device] ?? monitorSmartphoneIcon;
            return html`
                <tr class="border-t border-border">
                    <td class="py-3 pr-4 text-sm text-foreground">
                        <span class="font-mono text-xs">${s.id.slice(0, 8)}…</span>
                    </td>
                    <td class="py-3 pr-4 text-sm text-muted-foreground">${this.formatDate(s.createdAt)}</td>
                    <td class="py-3 pr-4 text-sm text-muted-foreground">${this.formatDate(s.expiresAt)}</td>
                    <td class="py-3 pr-4 text-sm text-muted-foreground">
                        ${s.userAgent
                            ? component(Tooltip, { content: uaSummary }, html`
                                <span class=${iconBtn + ' cursor-help'}>
                                    ${component(Icon, { entry: deviceEntry, size: 16 })}
                                </span>`)
                            : html`<span class="text-muted-foreground">—</span>`}
                    </td>
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
        };

        return html`
            <div class="space-y-8 max-w-5xl">
                <div>
                    <h1 class="text-2xl font-bold text-foreground">${__('Sessions')}</h1>
                    <p class="mt-1 text-sm text-muted-foreground">${__('Devices currently signed in to your account.')}</p>
                </div>

                ${this.error ? html`<div class="text-sm text-destructive">${this.error}</div>` : null}

                ${component(Card, {}, html`
                    ${component(CardHeader, {}, html`<h2 class="text-base font-semibold text-foreground">${__('Active sessions')}</h2>`)}
                    ${component(CardBody, {}, html`
                        <div class="overflow-x-auto">
                            <table class="w-full">
                                <thead>
                                    <tr class="text-left text-xs uppercase tracking-wide text-muted-foreground">
                                        <th class="py-2 pr-4 font-medium">${__('Session')}</th>
                                        <th class="py-2 pr-4 font-medium">${__('Logged in')}</th>
                                        <th class="py-2 pr-4 font-medium">${__('Expires')}</th>
                                        <th class="py-2 pr-4 font-medium">${__('Device')}</th>
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
                        </div>
                        ${this.sessions.length === 0
                            ? html`<p class="py-6 text-center text-sm text-muted-foreground">${__('No active sessions.')}</p>`
                            : null}
                    `)}
                `)}

                <div class="flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-2">
                    ${component(Button, { variant: 'outline', size: 'sm', '@click': () => this.revokeAllExceptCurrent() },
                        __('Sign out other sessions'))}
                    ${component(Button, { variant: 'destructive', size: 'sm', '@click': () => this.revokeAll() },
                        __('Sign out everywhere'))}
                </div>
            </div>
        `;
    }
}
