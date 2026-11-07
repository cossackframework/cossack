/** The language form used by the unified Settings page. */
import { Client, ClientState, Component, Cossack } from '@cossackframework/core';
import { Button, Checkbox, NativeSelect } from '@cossackframework/ui';
import { component, html } from '@cossackframework/renderer';
import { isCmsError, languageName, LOCALE, type Principal } from '@cossackframework/cms';
import type { CmsHost } from '@cossackframework/cms/server';
import type { SettingsDraft } from './settings-draft';
import { CONTROL, notice } from './ui';

const COMMON = ['ar', 'bg', 'bn', 'cs', 'da', 'de', 'el', 'en', 'es', 'fa', 'fi', 'fr', 'he', 'hi', 'hu', 'id', 'it', 'ja', 'ko', 'ms', 'nb', 'nl', 'pl', 'pt', 'pt-br',
    'ro', 'ru', 'sk', 'sv', 'sw', 'th', 'tl', 'tr', 'uk', 'ur', 'vi', 'zh-hans', 'zh-hant'];

/** Language in URLs: `hide-default` keeps the default language's pages unprefixed, `all` gives every language its code. */
export type LanguageUrls = 'hide-default' | 'all';
export interface LanguageSettingsInput { main: string; others: string[]; urls: LanguageUrls }
export interface LanguageSettingsData extends LanguageSettingsInput { options: { code: string; label: string }[]; origin: string }
export interface LanguageSettingsResult { data: LanguageSettingsData | null; error: string }
interface LanguageDraft extends LanguageSettingsInput { custom: string; added: string[] }

export async function loadLanguageSettings(cms: CmsHost, origin: string): Promise<LanguageSettingsData> {
    const languages = await cms.languages();
    return { main: languages.default, others: [...languages.others], urls: await cms.settings.get('languages.urls') === 'all' ? 'all' : 'hide-default', origin,
        options: [...new Set([...COMMON, ...languages.all])].map(code => ({ code, label: `${languageName(code)} (${code})` })).sort((a, b) => a.label.localeCompare(b.label)) };
}

/** Called by the authorized page's server method; mutation authorization stays in CmsHost. */
export async function saveLanguageSettings(cms: CmsHost, principal: Principal, input: LanguageSettingsInput, origin: string): Promise<LanguageSettingsResult> {
    try {
        if (!input || typeof input.main !== 'string' || !Array.isArray(input.others) || input.others.some(code => typeof code !== 'string')) return { data: null, error: __('Use language codes such as en, fr or pt-br.') };
        if (input.urls !== undefined && input.urls !== 'hide-default' && input.urls !== 'all') return { data: null, error: __('Choose how URLs show the language.') };
        await cms.saveLanguages({ default: input.main, others: input.others, ...(input.urls ? { urls: input.urls } : {}) }, principal);
        return { data: await loadLanguageSettings(cms, origin), error: '' };
    } catch (error) { return { data: null, error: isCmsError(error) ? error.message : __('The languages could not be saved.') }; }
}

export type LanguagesSettingsProps = {
    draft: SettingsDraft;
    initial: LanguageSettingsData;
    /** Undefined shows all fields; otherwise these are the full matching setting keys. */
    fields?: readonly string[];
};

export const languageDraft = (data: LanguageSettingsData): LanguageDraft => ({ main: data.main, others: [...data.others], urls: data.urls, custom: '', added: [] });

/** What the Settings page's Save sends for the section's draft. */
export function languageInput(draft: SettingsDraft, initial: LanguageSettingsData): LanguageSettingsInput {
    const current = draft.section('languages', languageDraft(initial));
    return { main: current.main, others: current.others.filter(code => code !== current.main), urls: current.urls };
}

@Component()
export class LanguagesSettings extends Cossack {
    declare props: LanguagesSettingsProps;
    @ClientState() private revision = 0;
    @ClientState() private error = '';
    private unsubscribe?: () => void;

    onMount() {
        this.props.draft.initializeSection('languages', languageDraft(this.props.initial));
        this.unsubscribe = this.props.draft.subscribe(() => { this.revision++; });
    }

    onCleanup() { this.unsubscribe?.(); }

    @Client()
    set(patch: Partial<LanguageDraft>) {
        const current = this.props.draft.section('languages', languageDraft(this.props.initial));
        this.props.draft.setSection('languages', { ...current, ...patch });
        this.error = '';
    }

    @Client()
    toggle(code: string, checked: boolean) {
        const current = this.props.draft.section('languages', languageDraft(this.props.initial));
        this.set({ others: checked ? [...new Set([...current.others, code])] : current.others.filter(entry => entry !== code) });
    }

    @Client()
    addCustom() {
        const current = this.props.draft.section('languages', languageDraft(this.props.initial));
        const code = current.custom.trim().toLowerCase();
        if (!LOCALE.test(code)) { this.error = __('Use a code such as fr, pt-br or zh-hans.'); return; }
        this.set({ added: [...new Set([...current.added, code])], others: [...new Set([...current.others, code])], custom: '' });
    }

    render() {
        const form = this.props.draft.section('languages', languageDraft(this.props.initial));
        const show = (field: string) => !this.props.fields || this.props.fields.includes(`languages.${field}`);
        const origin = this.props.initial.origin;
        const options = [...new Set([...this.props.initial.options.map(option => option.code), form.main, ...form.others, ...form.added])]
            .map(code => ({ code, label: `${languageName(code)} (${code})` })).sort((a, b) => a.label.localeCompare(b.label));
        return html`<div class="space-y-5">
            <p class="text-sm text-muted-foreground">${__('Publish entries in several languages. Each entry has one language; the editor links its translations.')}</p>
            ${this.error ? notice(this.error, 'error') : null}
            <fieldset class="min-w-0 space-y-5" ?disabled=${this.props.draft.saving}>
                ${show('default') ? html`<div class="space-y-1">
                    <label for="language-default" class="block text-sm font-medium text-foreground">${__('Default language')}</label>
                    ${component(NativeSelect, { id: 'language-default', '@change': (event: Event) => this.set({ main: (event.target as HTMLSelectElement).value }) }, html`
                        ${options.map(option => html`<option value=${option.code} ?selected=${option.code === form.main}>${option.label}</option>`)}`)}
                    <p class="text-xs text-muted-foreground">${__('Its entries are at addresses such as')} <code>${origin}${form.urls === 'all' && form.others.some(code => code !== form.main) ? `/${form.main}` : ''}/about</code>.</p>
                </div>` : null}
                ${show('others') ? html`<fieldset id="language-others" class="min-w-0 space-y-2">
                    <legend class="mb-1 text-sm font-medium text-foreground">${__('Other languages')}</legend>
                    <p class="text-xs text-muted-foreground">${__('Their entries live under the language code, such as')} <code>${origin}/fr/a-propos</code>.</p>
                    <div class="grid max-h-80 gap-1.5 overflow-y-auto rounded-md border border-border p-3 sm:grid-cols-2">
                        ${options.filter(option => option.code !== form.main).map(option => html`<label class="flex cursor-pointer items-center gap-2 text-sm text-foreground">
                            ${component(Checkbox, { checked: form.others.includes(option.code), '@change': (event: Event) => this.toggle(option.code, (event.target as HTMLInputElement).checked) })} ${option.label}</label>`)}
                    </div>
                    <div class="flex gap-2">
                        <input class=${`${CONTROL} min-w-0 max-w-48`} aria-label=${__('Another language code')} placeholder=${__('Another code, such as eu')} .value=${form.custom}
                            @input=${(event: Event) => this.set({ custom: (event.target as HTMLInputElement).value })}>
                        ${component(Button, { type: 'button', variant: 'outline', '@click': this.addCustom }, __('Add'))}
                    </div>
                </fieldset>` : null}
                ${show('urls') ? html`<fieldset id="language-urls" class="min-w-0 space-y-2">
                    <legend class="mb-1 text-sm font-medium text-foreground">${__('Language in URLs')}</legend>
                    ${([['hide-default', __('Hide the default language\'s code'), `${origin}/about · ${origin}/fr/a-propos`], ['all', __('Every language has its code'), `${origin}/${form.main}/about · ${origin}/fr/a-propos`]] as const).map(([value, label, example]) => html`<label class="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3 has-[:checked]:border-primary">
                        <input type="radio" name="language-urls" class="mt-1" .checked=${form.urls === value} @change=${() => this.set({ urls: value })}>
                        <span><span class="block text-sm font-medium text-foreground">${label}</span><code class="break-all text-xs text-muted-foreground">${example}</code></span>
                    </label>`)}
                    <p class="text-xs text-muted-foreground">${__('Applies when the site has several languages. Addresses in the other form redirect.')}</p>
                </fieldset>` : null}
            </fieldset>
        </div>`;
    }
}
