import { Cossack, Page, State, Server, Client, type HeadValue } from '@cossackframework/core';
import { Button, Card, CardBody, Checkbox, NativeSelect, toast } from '@cossackframework/ui';
import { html, component } from '@cossackframework/renderer';
import { isCmsError, languageName, LOCALE, PERMISSIONS } from '@cossackframework/cms';
import { requireAny } from '../../../../../cms/guards';
import { settingsFrame, settingsLinks, type SettingsLink } from '../../../../../cms/settings-nav';
import { CONTROL, notice, pageHeader } from '../../../../../cms/ui';

/** Languages offered by name; any other code can be added. */
const COMMON = ['ar', 'bg', 'bn', 'cs', 'da', 'de', 'el', 'en', 'es', 'fa', 'fi', 'fr', 'he', 'hi', 'hu', 'id', 'it', 'ja', 'ko', 'ms', 'nb', 'nl', 'pl', 'pt', 'pt-br',
    'ro', 'ru', 'sk', 'sv', 'sw', 'th', 'tl', 'tr', 'uk', 'ur', 'vi', 'zh-hans', 'zh-hant'];

/**
 * The site's languages. The default one has no URL prefix; the others live under
 * `/<code>/`. Entries get a language and can be translated from the editor's Languages box.
 */
@Page({ transport: 'http', middlewares: [requireAny(PERMISSIONS.manageSettings)] })
export default class LanguagesPage extends Cossack {
    @State() links: SettingsLink[] = [];
    @State() main = 'en';
    @State() others: string[] = [];
    @State() options: { code: string; label: string }[] = [];
    @State() custom = '';
    @State() origin = '';
    @State() error = '';

    head(): HeadValue {
        return { title: __('Language settings') };
    }

    async init() {
        const cms = this.c.get('cms');
        this.origin = new URL(this.c.req.url).origin;
        this.links = settingsLinks(cms);
        await this.load();
    }

    private async load() {
        const languages = await this.c.get('cms').languages();
        this.main = languages.default;
        this.others = [...languages.others];
        this.options = [...new Set([...COMMON, ...languages.all])].map(code => ({ code, label: `${languageName(code)} (${code})` })).sort((a, b) => a.label.localeCompare(b.label));
    }

    @Client()
    toggle(code: string, checked: boolean) {
        this.others = checked ? [...new Set([...this.others, code])] : this.others.filter(entry => entry !== code);
    }

    @Client()
    addCustom() {
        const code = this.custom.trim().toLowerCase();
        if (!LOCALE.test(code)) { toast.error(__('Use a code such as fr, pt-br or zh-hans.')); return; }
        if (!this.options.some(option => option.code === code)) this.options = [...this.options, { code, label: code }];
        this.toggle(code, true);
        this.custom = '';
    }

    @Client()
    async submit(event: Event) {
        event.preventDefault();
        await this.save(this.main, this.others.filter(code => code !== this.main));
        if (this.error) toast.error(this.error); else toast.success(__('Languages saved.'));
    }

    @Server()
    async save(main: string, others: string[]) {
        this.error = '';
        try {
            await this.c.get('cms').saveLanguages({ default: main, others }, this.c.get('principal'));
            await this.load();
        } catch (error) {
            this.error = isCmsError(error) ? error.message : __('The languages could not be saved.');
        }
    }

    render() {
        return settingsFrame(this.links, 'languages', html`<div class="space-y-6">
            ${pageHeader(__('Language settings'), { description: __('Publish entries in several languages. Each entry has one language; the editor links its translations.') })}
            ${this.error ? notice(this.error, 'error') : null}
            ${component(Card, {}, component(CardBody, {}, html`<form class="space-y-6" @submit=${(event: Event) => this.submit(event)}>
                <div class="space-y-1">
                    <label for="language-default" class="block text-sm font-medium text-foreground">${__('Default language')}</label>
                    ${component(NativeSelect, { id: 'language-default', '@change': (event: Event) => { this.main = (event.target as HTMLSelectElement).value; } }, html`
                        ${this.options.map(option => html`<option value=${option.code} ?selected=${option.code === this.main}>${option.label}</option>`)}`)}
                    <p class="text-xs text-muted-foreground">${__('Its entries keep their addresses, such as')} <code>${this.origin}/about</code>.</p>
                </div>
                <fieldset class="space-y-2">
                    <legend class="mb-1 text-sm font-medium text-foreground">${__('Other languages')}</legend>
                    <p class="text-xs text-muted-foreground">${__('Their entries live under the language code, such as')} <code>${this.origin}/fr/a-propos</code>.</p>
                    <div class="grid max-h-80 gap-1.5 overflow-y-auto rounded-md border border-border p-3 sm:grid-cols-2">
                        ${this.options.filter(option => option.code !== this.main).map(option => html`<label class="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                            ${component(Checkbox, { checked: this.others.includes(option.code), '@change': (event: Event) => this.toggle(option.code, (event.target as HTMLInputElement).checked) })} ${option.label}</label>`)}
                    </div>
                    <div class="flex gap-2">
                        <input class=${`${CONTROL} max-w-48`} aria-label=${__('Another language code')} placeholder=${__('Another code, such as eu')} .value=${this.custom}
                            @input=${(event: Event) => { this.custom = (event.target as HTMLInputElement).value; }}>
                        ${component(Button, { type: 'button', variant: 'outline', '@click': () => this.addCustom() }, __('Add'))}
                    </div>
                </fieldset>
                <p class="text-xs text-muted-foreground">${__('Entries written before you add languages take the default language. Terms, menu labels and settings are shared by all languages.')}</p>
                <div>${component(Button, { type: 'submit' }, __('Save changes'))}</div>
            </form>`))}
        </div>`);
    }
}
