import { html, component } from '@cossackframework/renderer';
import { Cossack, Component, ClientState, Client } from '@cossackframework/core';
import { Card } from '../../components/Card.js';
import { Switch } from '../../components/Switch.js';
import { Separator } from '../../components/Separator.js';
import { Input } from '../../components/Input.js';
import { Button } from '../../components/Button.js';
import { Badge } from '../../components/Badge.js';

export interface SettingsSection {
    /** Section heading. */
    title: string;
    /** Optional description below the heading. */
    description?: string;
    /** Rows of settings in this section. */
    rows: SettingsRow[];
}

export interface SettingsRow {
    /** Row label. */
    label: string;
    /** Helper text shown below the label. */
    hint?: string;
    /** Control type. */
    type: 'switch' | 'text' | 'button';
    /** Key into the values map. */
    key: string;
    /** For "button" type: the button label. */
    action?: string;
    /** Variant badge shown next to the label (e.g. "Beta"). */
    badge?: string;
}

export interface SettingsPanelProps {
    /** Section definitions. */
    sections: SettingsSection[];
    /** Initial values for switch/text controls: { key: boolean | string }. */
    values?: Record<string, boolean | string>;
    /** Called when any control changes, with the full values map. */
    onChange?: (values: Record<string, boolean | string>) => void;
    /** Called when a "button" row is clicked, with the row key. */
    onAction?: (key: string) => void;
    [key: string]: any;
}

/**
 * Settings Panel Block — shadcn-style settings page.
 *
 * Renders a vertical stack of Card sections, each containing labeled rows with
 * switch toggles, text inputs, or action buttons. Composes Card, Switch, Label,
 * Input, Button, Separator, and Badge from @cossackframework/ui.
 *
 *   ${component(SettingsPanel, {
 *       sections: [
 *           {
 *               title: 'Notifications',
 *               description: 'Configure how you receive updates.',
 *               rows: [
 *                   { label: 'Email notifications', hint: 'Get notified by email.', type: 'switch', key: 'email' },
 *                   { label: 'Push notifications', type: 'switch', key: 'push', badge: 'Beta' },
 *               ],
 *           },
 *           {
 *               title: 'Account',
 *               rows: [
 *                   { label: 'Display name', type: 'text', key: 'name' },
 *                   { label: 'Delete account', type: 'button', action: 'Delete', key: 'delete' },
 *               ],
 *           },
 *       ],
 *       values: { email: true, push: false, name: 'Jane' },
 *       onChange: (v) => { this.settings = v; },
 *       onAction: (key) => { if (key === 'delete') confirmDelete(); },
 *   })}
 */
@Component()
export class SettingsPanel extends Cossack {
    declare props: SettingsPanelProps;

    @ClientState() private values: Record<string, boolean | string> = {};

    onMount() {
        this.values = { ...this.props.values };
    }

    render() {
        const { sections = [] } = this.props;

        return html`
            <div class="cs-settings-panel w-full max-w-2xl mx-auto flex flex-col gap-6">
                ${sections.map((section) => html`
                    ${component(Card, {},
                        html`
                            <div class="flex flex-col gap-1.5 p-6">
                                <h3 class="text-base font-semibold text-card-foreground">${section.title}</h3>
                                ${section.description
                                    ? html`<p class="text-sm text-muted-foreground">${section.description}</p>`
                                    : null}
                            </div>
                            <div class="px-6 pb-6">
                                ${section.rows.map((row, i) => html`
                                    <div class="flex items-center justify-between gap-4 py-3">
                                        <div class="min-w-0">
                                            <div class="flex items-center gap-2">
                                                <span class="text-sm font-medium text-foreground">${row.label}</span>
                                                ${row.badge ? component(Badge, { variant: 'secondary' }, row.badge) : null}
                                            </div>
                                            ${row.hint ? html`<p class="text-xs text-muted-foreground mt-0.5">${row.hint}</p>` : null}
                                        </div>
                                        <div class="shrink-0">
                                            ${this.renderControl(row)}
                                        </div>
                                    </div>
                                    ${i < section.rows.length - 1 ? component(Separator, {}) : null}
                                `)}
                            </div>
                        `)}
                `)}
            </div>
        `;
    }

    private renderControl(row: SettingsRow) {
        const val = this.values[row.key];
        switch (row.type) {
            case 'switch':
                return component(Switch, {
                    checked: !!val,
                    '@change': (e: Event) => {
                        const checked = (e.target as HTMLInputElement).checked;
                        this.updateValue(row.key, checked);
                    },
                });
            case 'text':
                return component(Input, {
                    value: (val as string) || '',
                    class: 'w-48',
                    '@input': (e: InputEvent) => {
                        this.updateValue(row.key, (e.target as HTMLInputElement).value);
                    },
                });
            case 'button':
                return component(Button, {
                    variant: row.key === 'delete' ? 'destructive' : 'outline',
                    size: 'sm',
                    '@click': () => { this.props.onAction?.(row.key); },
                }, row.action || 'Action');
            default:
                return null;
        }
    }

    @Client()
    private updateValue(key: string, value: boolean | string) {
        this.values = { ...this.values, [key]: value };
        this.props.onChange?.(this.values);
    }
}
