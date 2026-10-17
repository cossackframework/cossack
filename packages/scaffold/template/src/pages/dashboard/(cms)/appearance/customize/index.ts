import { Cossack, Page, State, Server, Client, type HeadValue } from '@cossackframework/core';
import { Button, Card, CardBody, toast } from '@cossackframework/ui';
import { html, component } from '@cossackframework/renderer';
import { isCmsError, PERMISSIONS } from '@cossackframework/cms';
import { requireAny } from '../../../../../cms/guards';
import { settingControl, settingInput, settingRows, type SettingRow, type SettingValues } from '../../../../../cms/settings-form';
import { linkButton, notice, pageHeader } from '../../../../../cms/ui';

/** The active theme's options, such as its accent colour. Saved as settings named after the theme. */
@Page({ transport: 'http', middlewares: [requireAny(PERMISSIONS.manageAppearance)] })
export default class CustomizePage extends Cossack {
    @State() theme = { name: '', label: '' };
    @State() rows: SettingRow[] = [];
    @State() values: SettingValues = {};
    @State() errors: Record<string, string> = {};
    @State() error = '';

    head(): HeadValue {
        return { title: __('Customize') };
    }

    async init() {
        const cms = this.c.get('cms');
        const name = await cms.activeTheme();
        const theme = cms.themes().find(entry => entry.name === name);
        if (!theme) return;
        this.theme = { name: theme.name, label: theme.label };
        if (theme.options) ({ rows: this.rows, values: this.values } = await settingRows(cms, theme.options, this.c.get('principal')));
    }

    @Client()
    set(name: string, value: string | boolean) {
        this.values = { ...this.values, [name]: value };
    }

    @Client()
    async submit(event: Event) {
        event.preventDefault();
        await this.save(this.values);
        if (this.error) toast.error(this.error); else toast.success(__('Your changes are live.'));
    }

    @Server()
    async save(values: SettingValues) {
        this.error = '';
        const cms = this.c.get('cms');
        const theme = cms.themes().find(entry => entry.name === this.theme.name);
        if (!theme?.options) { this.error = __('This theme has no options.'); return; }
        const { input, errors } = settingInput(theme.options, values);
        this.errors = errors;
        if (Object.keys(errors).length) { this.error = __('Some options are invalid.'); return; }
        try { await cms.settings.update(theme.options.id, input, { principal: this.c.get('principal') }); }
        catch (error) {
            this.errors = isCmsError(error) && error.fields ? { ...error.fields } : {};
            this.error = isCmsError(error) ? error.message : __('The options could not be saved.');
        }
    }

    render() {
        if (!this.theme.name) return html`<div class="space-y-4">${pageHeader(__('Customize'))}${notice(__('No theme is active. Activate one under Appearance → Themes.'))}</div>`;
        return html`<div class="max-w-3xl space-y-6">
            ${pageHeader(`${__('Customize')} ${this.theme.label}`, {
                description: __('Options of the active theme. Site title and tagline are General settings; menus have their own screen.'),
                actions: html`${linkButton(__('Menus'), '/dashboard/appearance/menus', 'outline')}<a href="/" target="_blank" rel="noopener" class="text-sm text-primary hover:underline">${__('View site')} ↗</a>`,
            })}
            ${this.error ? notice(this.error, 'error') : null}
            ${this.rows.length ? component(Card, {}, component(CardBody, {}, html`<form class="space-y-5" @submit=${(event: Event) => this.submit(event)}>
                ${this.rows.map(row => settingControl(row, this.values[row.name], this.errors[row.name], value => this.set(row.name, value)))}
                <div>${component(Button, { type: 'submit' }, __('Publish changes'))}</div>
            </form>`)) : notice(__('This theme has no options.'))}
        </div>`;
    }
}
