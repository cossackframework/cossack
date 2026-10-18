/**
 * The table of a user's signed-in sessions, shared by the Sessions page and the Sessions tab
 * of the user screen. The caller's own session is marked current and cannot be ended here.
 */
import { Badge, Button, Icon, Tooltip } from '@cossackframework/ui';
import { html, component, type TemplateResult } from '@cossackframework/renderer';
import { SmartphoneIcon as smartphoneIconSvg } from '@cossackframework/solar-icons/smartphone/line';
import { TabletIcon as tabletIconSvg } from '@cossackframework/solar-icons/tablet/line';
import { MonitorIcon as monitorIconSvg } from '@cossackframework/solar-icons/monitor/line';
import type { SessionInfo } from '../auth';

const DEVICE_ICON = {
    mobile: { line: smartphoneIconSvg },
    tablet: { line: tabletIconSvg },
    desktop: { line: monitorIconSvg },
} as const;

/**
 * Parses a User-Agent string into device type + human-readable browser/OS.
 * Intentionally lightweight (no dep) — good enough for a sessions list tooltip.
 */
export function parseUserAgent(ua: string | null): {
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

function formatDate(iso: string): string {
    try {
        return new Date(iso).toLocaleString();
    } catch {
        return iso;
    }
}

/** The sessions, the current one first, each with a button that ends it. */
export function sessionTable(sessions: readonly SessionInfo[], options: { id: string; onRevoke(reference: string): unknown }): TemplateResult {
    const iconBtn = 'inline-flex items-center justify-center [&_svg]:size-4';
    const ordered = [...sessions.filter((s) => s.current), ...sessions.filter((s) => !s.current)];
    const row = (s: SessionInfo) => {
        const ua = parseUserAgent(s.userAgent);
        const deviceLabel = ua.device === 'mobile' ? __('Mobile') : ua.device === 'tablet' ? __('Tablet') : __('Desktop');
        const tip = `${options.id}-${encodeURIComponent(s.reference)}-agent-tip`;
        return html`
            <tr class="border-t border-border">
                <td class="py-3 pr-4 text-sm text-foreground">
                    ${s.userAgent
                        ? component(Tooltip, { id: tip, label: `${deviceLabel} · ${ua.browser} · ${ua.os}` }, html`
                            <span tabindex="0" aria-describedby=${tip} class="inline-flex items-center gap-2 cursor-help">
                                <span class=${iconBtn}>${component(Icon, { entry: DEVICE_ICON[ua.device], size: 16 })}</span>
                                <span>${ua.browser} · ${ua.os}</span>
                            </span>`)
                        : html`<span class="text-muted-foreground">${__('Unknown device')}</span>`}
                </td>
                <td class="py-3 pr-4 text-sm text-muted-foreground">${formatDate(s.createdAt)}</td>
                <td class="py-3 pr-4 text-sm text-muted-foreground">${formatDate(s.expiresAt)}</td>
                <td class="py-3 pr-4 text-sm text-muted-foreground">${s.location ?? '—'}</td>
                <td class="py-3 pr-4 text-sm text-muted-foreground truncate max-w-[16rem]">${s.ipAddress ?? '—'}</td>
                <td class="py-3 text-right">
                    ${s.current
                        ? component(Badge, {}, __('Current'))
                        : component(Button, { variant: 'destructive', size: 'sm', '@click': () => options.onRevoke(s.reference) }, __('Sign out'))}
                </td>
            </tr>
        `;
    };
    return html`
        <div class="overflow-x-auto">
            <table class="w-full" id=${options.id}>
                <thead>
                    <tr class="text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <th class="py-2 pr-4 font-medium">${__('Device')}</th>
                        <th class="py-2 pr-4 font-medium">${__('Signed in')}</th>
                        <th class="py-2 pr-4 font-medium">${__('Expires')}</th>
                        <th class="py-2 pr-4 font-medium">${__('Location')}</th>
                        <th class="py-2 pr-4 font-medium">${__('IP')}</th>
                        <th class="py-2 text-right font-medium"><span class="sr-only">${__('Actions')}</span></th>
                    </tr>
                </thead>
                <tbody>${ordered.map(row)}</tbody>
            </table>
        </div>
        ${sessions.length === 0 ? html`<p class="py-6 text-center text-sm text-muted-foreground">${__('No active sessions.')}</p>` : null}
    `;
}
