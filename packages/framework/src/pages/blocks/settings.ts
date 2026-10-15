import { Cossack, Page, ClientState, HeadContext, HeadValue } from '@cossackframework/core';
import { html, component } from '@cossackframework/renderer';
import { SettingsPanel, type SettingsSection, type SettingsValues } from '@cossackframework/ui/blocks';

const SECTIONS: readonly SettingsSection[] = [
    {
        id: 'notifications', title: 'Notifications',
        description: 'Configure how you receive updates.',
        rows: [
            { label: 'Email notifications', hint: 'Get notified by email when something happens.', type: 'switch', key: 'email' },
            { label: 'Push notifications', type: 'switch', key: 'push', badge: 'Beta' },
            { label: 'Weekly digest', hint: 'A summary of activity every Monday.', type: 'switch', key: 'digest' },
        ],
    },
    {
        id: 'profile', title: 'Profile',
        rows: [
            { label: 'Display name', type: 'text', key: 'name' },
            { label: 'Username', type: 'text', key: 'username' },
        ],
    },
    {
        id: 'danger', title: 'Danger zone',
        rows: [
            { label: 'Delete account', hint: 'This action is permanent and cannot be undone.', type: 'button', action: 'Delete', variant: 'destructive', key: 'delete' },
        ],
    },
];

@Page({ transport: 'http' })
export default class SettingsBlocksPage extends Cossack {
    @ClientState() lastAction = '';
    @ClientState() settings: SettingsValues = {
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
                        id: 'account-settings', sections: SECTIONS,
                        values: this.settings,
                        onValuesChange: (v) => { this.settings = v; },
                        onAction: (key) => { this.lastAction = key; },
                    })}
                    <p role="status" class="text-sm text-muted-foreground mt-4">${this.lastAction ? `Requested action: ${this.lastAction}. This demo does not persist changes.` : ''}</p>
                </div>
            </main>
        `;
    }

    head(_: HeadContext): HeadValue {
        return { title: 'Settings — Blocks' };
    }
}
