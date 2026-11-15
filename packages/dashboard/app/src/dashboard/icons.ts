import type { IconEntry } from '@cossackframework/solar-icons/types';
import { Widget2Icon } from '@cossackframework/solar-icons/widget-2/line';
import { SunIcon } from '@cossackframework/solar-icons/sun/line';
import { MoonIcon } from '@cossackframework/solar-icons/moon/line';
import { AltArrowRightIcon } from '@cossackframework/solar-icons/alt-arrow-right/line';
import { Logout3Icon } from '@cossackframework/solar-icons/logout-3/line';
import { MagnifierIcon } from '@cossackframework/solar-icons/magnifier/line';
import { SmartphoneIcon } from '@cossackframework/solar-icons/smartphone/line';
import { TabletIcon } from '@cossackframework/solar-icons/tablet/line';
import { MonitorIcon } from '@cossackframework/solar-icons/monitor/line';

/**
 * The dashboard shell's own icons: the Dashboard link, the theme toggle, the account menu's
 * chevron and Sign out, the list tables' search box and the sessions list's devices.
 */
export type ShellIcons = Record<'home' | 'light' | 'dark' | 'expand' | 'logout' | 'search' | 'mobile' | 'tablet' | 'desktop', IconEntry>;

const SHELL_ICONS: ShellIcons = Object.freeze({
    home: { line: Widget2Icon }, light: { line: SunIcon }, dark: { line: MoonIcon }, expand: { line: AltArrowRightIcon }, logout: { line: Logout3Icon },
    search: { line: MagnifierIcon }, mobile: { line: SmartphoneIcon }, tablet: { line: TabletIcon }, desktop: { line: MonitorIcon },
});

/**
 * The shell's icons, asked for on every render (server and client), so an application that
 * draws its icons in a style chosen per site (the CMS) can replace this module.
 */
export function shellIcons(): ShellIcons {
    return SHELL_ICONS;
}
