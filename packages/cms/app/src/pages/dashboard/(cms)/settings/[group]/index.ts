import { Cossack, Page, State, Server, Client, type HeadValue } from '@cossackframework/core';
import { Button, Card, CardBody, toast } from '@cossackframework/ui';
import { html, component } from '@cossackframework/renderer';
import { isCmsError, PERMISSIONS } from '@cossackframework/cms';
import { requireAny } from '../../../../../cms/guards';
import { settingsFrame, settingsLinks, type SettingsLink } from '../../../../../cms/settings-nav';
import { settingControl, settingInput, settingRows, type SettingRow, type SettingValues } from '../../../../../cms/settings-form';
import { notice, pageHeader } from '../../../../../cms/ui';

/** Site settings, one group per tab: General, Writing, Reading, Media and those plugins add. */
@Page({ transport: 'http', middlewares: [requireAny(PERMISSIONS.manageSettings)] })
export default class SettingsPage extends Cossack {
    @State() group = '';
    @State() links: SettingsLink[] = [];
    @State() label = '';
    @State() rows: SettingRow[] = [];
    @State() values: SettingValues = {};
    @State() errors: Record<string, string> = {};
    @State() error = '';

    head(): HeadValue {
        return { title: `${this.label || __('Settings')} ${__('settings')}` };
    }

    async init() {
        const cms = this.c.get('cms');
        // Appearance and theme options have their own screens.
        const own = cms.settings.groups.filter(group => (group.permission ?? PERMISSIONS.manageSettings) === PERMISSIONS.manageSettings);
        this.links = settingsLinks(cms);
        const group = own.find(entry => entry.id === this.c.req.param('group'));
        if (!group) { this.error = __('These settings do not exist.'); this.c.status(404); return; }
        this.group = group.id;
        this.label = group.label;
        ({ rows: this.rows, values: this.values } = await settingRows(cms, group, this.c.get('principal')));
    }

    @Client()
    set(name: string, value: string | boolean) {
        this.values = { ...this.values, [name]: value };
    }

    @Client()
    async submit(event: Event) {
        event.preventDefault();
        await this.save(this.values);
        if (this.error) toast.error(this.error); else toast.success(__('Settings saved.'));
    }

    @Server()
    async save(values: SettingValues) {
        this.error = '';
        const cms = this.c.get('cms');
        const group = cms.settings.group(this.c.req.param('group') ?? '');
        const { input, errors } = settingInput(group, values);
        this.errors = errors;
        if (Object.keys(errors).length) { this.error = __('Some settings are invalid.'); return; }
        try { await cms.settings.update(group.id, input, { principal: this.c.get('principal') }); }
        catch (error) {
            this.errors = isCmsError(error) && error.fields ? { ...error.fields } : {};
            this.error = isCmsError(error) ? error.message : __('The settings could not be saved.');
        }
    }

    render() {
        if (!this.group) return notice(this.error || __('These settings do not exist.'), 'error');
        return settingsFrame(this.links, this.group, html`<div class="space-y-6">
            ${pageHeader(`${this.label} ${__('settings')}`)}
            ${this.error ? notice(this.error, 'error') : null}
            ${component(Card, {}, component(CardBody, {}, html`<form class="space-y-5" @submit=${(event: Event) => this.submit(event)}>
                ${this.rows.map(row => settingControl(row, this.values[row.name], this.errors[row.name], value => this.set(row.name, value)))}
                <div>${component(Button, { type: 'submit' }, __('Save changes'))}</div>
            </form>`))}
        </div>`);
    }
}
