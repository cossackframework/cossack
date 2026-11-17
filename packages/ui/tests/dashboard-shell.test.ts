import { expect, it } from 'vitest';
import { html, renderToString, component } from '@cossackframework/renderer';
import { DashboardShell } from '../src/blocks/index';

const base = {
    brand: { name: 'Acme', logo: '/logo.svg' },
    account: { name: 'Ada', email: 'ada@example.com' },
    navigation: [{ value: 'home', label: 'Dashboard', href: '/dashboard', active: true }, { value: 'reports', label: 'Reports', href: '/dashboard/reports' }],
    collapsed: false,
    onCollapsedChange: () => {},
    onLogout: () => {},
};
const text = (markup: string) => markup.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

it('frames the screen with the navigation, the account menu and the taskbar, from props alone', () => {
    const output = renderToString(component(DashboardShell, { ...base, accountLinks: [{ label: 'Profile', href: '/dashboard/profile' }],
        notices: [{ id: 'n1', tone: 'warning', message: 'Backups are off.', href: '/dashboard/settings' }],
        statuses: [{ id: 'comments', label: 'Comments', href: '/dashboard/comments', count: 3, tone: 'warning' }] }, html`<h1>Reports screen</h1>`));
    expect(output).toContain('id="dashboard-navigation"');
    expect(output).toContain('href="/dashboard/reports"');
    expect(output).toContain('href="/dashboard/profile"');
    expect(output).toContain('ada@example.com');
    expect(output).toContain('Reports screen');
    expect(output).toContain('data-notice-id="n1"');
    expect(output).toContain('data-status="comments"');
    expect(text(output)).toContain('Log out');
    expect(output).toContain('data-dashboard-taskbar');
    // No palette without commands, no theme toggle without its callback.
    expect(output).not.toContain('id="dashboard-commands"');
    expect(output).not.toContain('Switch between light and dark mode');
});

it('adds the palette and the theme toggle when asked, and takes translated labels', () => {
    const output = renderToString(component(DashboardShell, { ...base, onThemeToggle: () => {}, commands: [{ id: '/dashboard/reports', label: 'Reports', group: 'Screens' }],
        taskbar: false, error: 'Could not sign out.', labels: { logOut: 'Abmelden', lightMode: 'Hell' } }, html`<p>Body</p>`));
    expect(output).toContain('id="dashboard-commands"');
    expect(output).toContain('Switch between light and dark mode');
    expect(text(output)).toContain('Abmelden');
    expect(text(output)).toContain('Hell');
    expect(output).not.toContain('data-dashboard-taskbar');
    expect(output).toContain('Could not sign out.');
});
