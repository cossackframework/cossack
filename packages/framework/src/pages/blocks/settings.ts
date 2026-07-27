import { Cossack, Page, ClientState, HeadContext, HeadValue } from '@cossackframework/core';
import { html, component } from '@cossackframework/renderer';
import { SettingsPanel, type SettingsSection } from '@cossackframework/ui/blocks';

const SECTIONS: SettingsSection[] = [
    {
        title: 'Notifications',
        description: 'Configure how you receive updates.',
        rows: [
            { label: 'Email notifications', hint: 'Get notified by email when something happens.', type: 'switch', key: 'email' },
            { label: 'Push notifications', type: 'switch', key: 'push', badge: 'Beta' },
            { label: 'Weekly digest', hint: 'A summary of activity every Monday.', type: 'switch', key: 'digest' },
        ],
    },
    {
        title: 'Profile',
        rows: [
            { label: 'Display name', type: 'text', key: 'name' },
            { label: 'Username', type: 'text', key: 'username' },
        ],
    },
    {
        title: 'Danger zone',
        rows: [
            { label: 'Delete account', hint: 'This action is permanent and cannot be undone.', type: 'button', action: 'Delete', key: 'delete' },
        ],
    },
];

@Page({ transport: 'http' })
export default class SettingsBlocksPage extends Cossack {
    @ClientState() settings: Record<string, boolean | string> = {
        email: true,
        push: false,
        digest: true,
        name: 'Jane Doe',
        username: 'janedoe',
    };

    render() {
        return html`
            <main class="min-h-screen bg-background py-12 px-4">
                <div class="max-w-2xl mx-auto">
                    <h1 class="text-2xl font-bold text-foreground mb-1">Settings</h1>
                    <p class="text-sm text-muted-foreground mb-8">Manage your account preferences.</p>
                    ${component(SettingsPanel, {
                        sections: SECTIONS,
                        values: this.settings,
                        onChange: (v) => { this.settings = v; },
                        onAction: (key) => { console.log('action:', key); },
                    })}
                </div>
            </main>
        `;
    }

    head(_: HeadContext): HeadValue {
        return { title: 'Settings — Blocks' };
    }
}
