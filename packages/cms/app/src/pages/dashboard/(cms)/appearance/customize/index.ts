import { Cossack, Page, State, Server, Client, type HeadValue } from '@cossackframework/core';
import { Button, Card, CardBody, CodeEditor, ColorPicker, Input, toast } from '@cossackframework/ui';
import { html, component, type TemplateResult } from '@cossackframework/renderer';
import { customCssProblem, isCmsError, PERMISSIONS, presetOverridesProblem, resolvePresets, slugify, type Preset } from '@cossackframework/cms';
import { requireAny } from '../../../../../cms/guards';
import { settingControl, settingInput, settingRows, type SettingRow, type SettingValues } from '../../../../../cms/settings-form';
import { linkButton, notice, pageHeader } from '../../../../../cms/ui';

/** A palette color as the screen edits it: the theme's value, and the site's when changed. */
interface ColorRow { slug: string; name: string; value: string; themeValue: string }

/**
 * The active theme's options, such as its accent color; its palette, which blocks' Style tabs
 * pick from, with the site's own colors; and the site's Additional CSS. Options save as
 * settings named after the theme; the palette changes and the CSS as Appearance settings.
 */
@Page({ transport: 'http', middlewares: [requireAny(PERMISSIONS.manageAppearance)] })
export default class CustomizePage extends Cossack {
    @State() theme = { name: '', label: '' };
    @State() rows: SettingRow[] = [];
    @State() values: SettingValues = {};
    @State() colors: ColorRow[] = [];
    @State() custom: Preset[] = [];
    @State() customCss = '';
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
        const settings = await cms.settings.all();
        const overrides = settings['appearance.presets']?.[theme.name] ?? null;
        const themeColors = resolvePresets(theme.presets).colors;
        this.colors = themeColors.map(color => ({ slug: color.slug, name: color.name, themeValue: color.value, value: overrides?.colors?.[color.slug] ?? color.value }));
        this.custom = (overrides?.custom ?? []).filter(color => !themeColors.some(entry => entry.slug === color.slug)).map(color => ({ ...color }));
        this.customCss = settings['appearance.customCss'] ?? '';
    }

    @Client()
    set(name: string, value: string | boolean) {
        this.values = { ...this.values, [name]: value };
    }

    @Client()
    setColor(slug: string, value: string) {
        this.colors = this.colors.map(color => color.slug === slug ? { ...color, value } : color);
    }

    @Client()
    setCustom(index: number, patch: Partial<Preset>) {
        this.custom = this.custom.map((color, at) => at === index ? { ...color, ...patch } : color);
    }

    /** A new custom color: its slug comes from its name once, so blocks using it keep it when it is renamed. */
    @Client()
    addCustom() {
        const taken = new Set([...this.colors, ...this.custom].map(color => color.slug));
        let index = this.custom.length + 1;
        while (taken.has(`custom-${index}`)) index += 1;
        this.custom = [...this.custom, { slug: `custom-${index}`, name: `${__('Custom')} ${index}`, value: '#000000' }];
    }

    @Client()
    removeCustom(index: number) {
        this.custom = this.custom.filter((_, at) => at !== index);
    }

    @Client()
    async submit(event: Event) {
        event.preventDefault();
        await this.save(this.values, this.colors.map(color => ({ slug: color.slug, value: color.value })), this.custom, this.customCss);
        if (this.error) toast.error(this.error); else toast.success(__('Your changes are live.'));
    }

    @Server()
    async save(values: SettingValues, colors: { slug: string; value: string }[] = [], custom: Preset[] = [], customCss?: string) {
        this.error = '';
        this.errors = {};
        const cms = this.c.get('cms');
        const theme = cms.themes().find(entry => entry.name === this.theme.name);
        if (!theme) { this.error = __('No theme is active.'); return; }
        // The palette: only values that differ from the theme's are kept, so a theme update reaches untouched colors.
        const themeColors = resolvePresets(theme.presets).colors;
        const changed = Object.fromEntries(colors.filter(color => {
            const original = themeColors.find(entry => entry.slug === color.slug);
            return original && color.value.trim() && color.value.trim() !== original.value;
        }).map(color => [color.slug, color.value.trim()]));
        const added = custom.map(color => {
            const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(color.slug) ? color.slug : slugify(color.name) || 'custom';
            return { slug, name: color.name.trim(), value: color.value.trim() };
        });
        const overrides = { ...(Object.keys(changed).length ? { colors: changed } : {}), ...(added.length ? { custom: added } : {}) };
        const presetProblem = presetOverridesProblem(overrides);
        if (presetProblem) { this.errors = { colors: presetProblem }; this.error = __('Some colors are invalid.'); return; }
        const cssProblem = customCss === undefined ? undefined : customCssProblem(customCss);
        if (cssProblem) { this.errors = { customCss: cssProblem }; this.error = cssProblem; return; }
        if (theme.options) {
            const { input, errors } = settingInput(theme.options, values);
            if (Object.keys(errors).length) { this.errors = errors; this.error = __('Some options are invalid.'); return; }
            try { await cms.settings.update(theme.options.id, input, { principal: this.c.get('principal') }); }
            catch (error) {
                this.errors = isCmsError(error) && error.fields ? { ...error.fields } : {};
                this.error = isCmsError(error) ? error.message : __('The options could not be saved.');
                return;
            }
        }
        try {
            const presets = { ...((await cms.settings.get('appearance.presets')) ?? {}) };
            if (Object.keys(overrides).length) presets[theme.name] = overrides; else delete presets[theme.name];
            await cms.settings.update('appearance', { presets, ...(customCss === undefined ? {} : { customCss }) }, { principal: this.c.get('principal') });
        } catch (error) {
            this.error = isCmsError(error) ? error.message : __('The changes could not be saved.');
        }
    }

    private colorRow(color: Preset & { themeValue?: string }, change: (patch: Partial<Preset>) => void, remove?: () => void): TemplateResult {
        const changed = color.themeValue !== undefined && color.value !== color.themeValue;
        return html`<li class="flex flex-wrap items-center gap-2" data-color=${color.slug}>
            ${component(ColorPicker, { value: color.value, label: `${color.name} ${__('picker')}`, onChange: (value: string) => change({ value }) })}
            ${remove ? component(Input, { type: 'text', class: 'w-36', maxlength: 40, '.value': color.name, 'aria-label': __('Name'), '@input': (event: Event) => change({ name: (event.target as HTMLInputElement).value }) })
                : html`<span class="w-36 text-sm font-medium text-foreground">${color.name}</span>`}
            ${component(Input, { type: 'text', class: 'w-48 font-mono text-xs', maxlength: 80, '.value': color.value, 'aria-label': `${color.name} ${__('value')}`, '@input': (event: Event) => change({ value: (event.target as HTMLInputElement).value }) })}
            ${changed ? html`<button type="button" class="border-none bg-transparent text-xs text-muted-foreground hover:text-foreground cursor-pointer" @click=${() => change({ value: color.themeValue! })}>${__('Reset')}</button>` : null}
            ${remove ? html`<button type="button" class="border-none bg-transparent text-xs text-destructive hover:underline cursor-pointer" @click=${remove}>${__('Remove')}</button>` : null}
        </li>`;
    }

    private colorsSection(): TemplateResult {
        return html`<section class="space-y-3" aria-labelledby="customize-colors">
            <div>
                <h2 id="customize-colors" class="text-sm font-semibold text-foreground">${__('Colors')}</h2>
                <p class="text-xs text-muted-foreground">${__('The palette blocks pick from on their Style tab. Change a theme color, or add your own; blocks keep their choice when a value changes.')}</p>
            </div>
            ${this.colors.length || this.custom.length ? html`<ul class="space-y-2">
                ${this.colors.map(color => this.colorRow(color, patch => this.setColor(color.slug, patch.value ?? color.value)))}
                ${this.custom.map((color, index) => this.colorRow(color, patch => this.setCustom(index, patch), () => this.removeCustom(index)))}
            </ul>` : html`<p class="text-sm text-muted-foreground">${__('The theme has no palette yet.')}</p>`}
            ${this.errors.colors ? html`<p role="alert" class="text-xs text-destructive">${this.errors.colors}</p>` : null}
            ${this.custom.length < 12 ? component(Button, { type: 'button', variant: 'outline', size: 'sm', '@click': () => this.addCustom() }, __('Add color')) : null}
        </section>`;
    }

    private cssSection(): TemplateResult {
        return html`<section class="space-y-2" aria-labelledby="customize-css">
            <h2 id="customize-css" class="text-sm font-semibold text-foreground">${__('Additional CSS')}</h2>
            <p class="text-xs text-muted-foreground">${__('Added to every page of the site after the theme\'s styles. It cannot load other files or run scripts.')}</p>
            ${component(CodeEditor, { id: 'customize-custom-css', value: this.customCss, language: 'css', label: __('Additional CSS'), class: 'min-h-[12rem] rounded-md border border-input bg-background shadow-xs focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-[3px]', onChange: (value: string) => { this.customCss = value; } })}
            ${this.errors.customCss ? html`<p role="alert" class="text-xs text-destructive">${this.errors.customCss}</p>` : null}
        </section>`;
    }

    render() {
        if (!this.theme.name) return html`<div class="space-y-4">${pageHeader(__('Customize'))}${notice(__('No theme is active. Activate one under Appearance → Themes.'))}</div>`;
        return html`<div class="max-w-3xl space-y-6">
            ${pageHeader(`${__('Customize')} ${this.theme.label}`, {
                description: __('Options, colors and CSS of the active theme. Site title and tagline are General settings; menus have their own screen.'),
                actions: html`${linkButton(__('Menus'), '/dashboard/appearance/menus', 'outline')}<a href="/" target="_blank" rel="noopener" class="text-sm text-primary hover:underline">${__('View site')} ↗</a>`,
            })}
            ${this.error ? notice(this.error, 'error') : null}
            ${component(Card, {}, component(CardBody, {}, html`<form class="space-y-6" @submit=${(event: Event) => this.submit(event)}>
                ${this.rows.length ? html`<section class="space-y-5" aria-labelledby="customize-options">
                    <h2 id="customize-options" class="text-sm font-semibold text-foreground">${__('Options')}</h2>
                    ${this.rows.map(row => settingControl(row, this.values[row.name], this.errors[row.name], value => this.set(row.name, value)))}
                </section>` : null}
                ${this.colorsSection()}
                ${this.cssSection()}
                <div>${component(Button, { type: 'submit' }, __('Publish changes'))}</div>
            </form>`))}
        </div>`;
    }
}
