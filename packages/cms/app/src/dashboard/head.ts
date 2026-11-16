import type { HeadValue } from '@cossackframework/core';
import { getRequestContext } from '@cossackframework/core';
import { DASHBOARD_ACCENTS, DASHBOARD_PALETTES } from '@cossackframework/cms';
import { UI_PALETTE_META } from '@cossackframework/ui';
import { ICON_STYLE_META, iconStyle } from '../cms/icons';

/** The `ui-palette` meta content for Settings → Interface: `<base> <accent>`, neutral for anything unknown. */
export function dashboardPalette(palette: unknown, accent: unknown): string {
    const base = DASHBOARD_PALETTES.find(entry => entry === palette) ?? 'neutral';
    const tint = DASHBOARD_ACCENTS.find(entry => entry === accent) ?? 'neutral';
    return `${base} ${tint}`;
}

/** The palettes of this page: the middleware's on the server, the server-drawn meta on the client. */
function palette(): string {
    if (typeof document !== 'undefined') return document.querySelector(`meta[name="${UI_PALETTE_META}"]`)?.getAttribute('content') ?? dashboardPalette(undefined, undefined);
    return getRequestContext()?.get('cms.palette') ?? dashboardPalette(undefined, undefined);
}

/**
 * The dashboard's meta tags: the icon style, so client renders draw what the server drew, and
 * the palettes `@cossackframework/ui/theme/palettes.css` applies (Settings → Interface).
 */
export function dashboardHead(): NonNullable<HeadValue['meta']> {
    return [
        { tag: 'meta', attributes: { name: ICON_STYLE_META, content: iconStyle() } },
        { tag: 'meta', attributes: { name: UI_PALETTE_META, content: palette() } },
    ];
}
