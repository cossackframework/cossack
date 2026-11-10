import { icon } from '../cms/icons';

/**
 * The dashboard shell's own icons: the Dashboard link, the theme toggle, the account menu's
 * chevron and Sign out, the list tables' search box and the sessions list's devices.
 */
export type ShellIcons = Record<'home' | 'light' | 'dark' | 'expand' | 'logout' | 'search' | 'mobile' | 'tablet' | 'desktop', ReturnType<typeof icon>>;

/** The shell's icons in the site's icon style (Appearance → Customize), asked for on every render. */
export function shellIcons(): ShellIcons {
    return {
        home: icon('widget-2'), light: icon('sun'), dark: icon('moon'), expand: icon('alt-arrow-right'), logout: icon('logout-3'),
        search: icon('magnifier'), mobile: icon('smartphone'), tablet: icon('tablet'), desktop: icon('monitor'),
    };
}
