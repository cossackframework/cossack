import { Cossack, Page, State, Server, Client, type HeadValue } from '@cossackframework/core';
import { Button, Card, CardBody, CodeEditor, ColorPicker, Field, Input } from '@cossackframework/ui';
import { html, component, type TemplateResult } from '@cossackframework/renderer';
import { customCssProblem, hasPermission, isCmsError, PERMISSIONS, presetOverridesProblem, resolvePresets, slugify, type Preset } from '@cossackframework/cms';
import { requireAny } from '../../../../../cms/guards';
import { findSettingsMedia, settingControl, settingInput, settingRows, type SettingRow, type SettingValues } from '../../../../../cms/settings-form';
import { linkButton, notice, pageHeader } from '../../../../../cms/ui';

/** A palette color or a gradient as the screen edits it: the theme's value, and the site's when changed. */
interface ColorRow { slug: string; name: string; value: string; themeValue: string }

/**
 * The active theme's options, such as its accent color; its palette and gradients, which
 * blocks' Style tabs pick from, with the site's own; and the site's Additional CSS. Options
 * save as settings named after the theme; the preset changes and the CSS as Appearance settings.
 */
@Page({ transport: 'http', middlewares: [requireAny(PERMISSIONS.manageAppearance)] })
export default class CustomizePage extends Cossack {
    @State() theme = { name: '', label: '' };
    @State() rows: SettingRow[] = [];
    @State() values: SettingValues = {};
    @State() colors: ColorRow[] = [];
    @State() custom: Preset[] = [];
    @State() gradients: ColorRow[] = [];
    @State() customGradients: Preset[] = [];
    @State() customCss = '';
    @State() errors: Record<string, string> = {};
    @State() error = '';
    @State() mediaEnabled = false;
    @State() mediaUpload = false;
    private mediaEpoch = 0;
    /** What the last publish did. */
    @State() message = '';

    head(): HeadValue {
        return { title: __('Customize') };
    }

    async init() {
        const cms = this.c.get('cms');
        const principal = this.c.get('principal');
        this.mediaEnabled = !!cms.files && [PERMISSIONS.upload, PERMISSIONS.manageMedia, PERMISSIONS.manageUsers].some(permission => hasPermission(principal, permission));
        this.mediaUpload = !!cms.files && hasPermission(principal, PERMISSIONS.upload);
        const name = await cms.activeTheme();
        const theme = cms.themes().find(entry => entry.name === name);
        if (!theme) return;
        this.theme = { name: theme.name, label: theme.label };
        if (theme.options) ({ rows: this.rows, values: this.values } = await settingRows(cms, theme.options, this.c.get('principal')));
        const settings = await cms.settings.all();
        const overrides = settings['appearance.presets']?.[theme.name] ?? null;
        const themePresets = resolvePresets(theme.presets);
        this.colors = themePresets.colors.map(color => ({ slug: color.slug, name: color.name, themeValue: color.value, value: overrides?.colors?.[color.slug] ?? color.value }));
        this.custom = (overrides?.custom ?? []).filter(color => !themePresets.colors.some(entry => entry.slug === color.slug)).map(color => ({ ...color }));
        this.gradients = themePresets.gradients.map(gradient => ({ slug: gradient.slug, name: gradient.name, themeValue: gradient.value, value: overrides?.gradients?.[gradient.slug] ?? gradient.value }));
        this.customGradients = (overrides?.customGradients ?? []).filter(gradient => !themePresets.gradients.some(entry => entry.slug === gradient.slug)).map(gradient => ({ ...gradient }));
        this.customCss = settings['appearance.customCss'] ?? '';
    }

    @Client()
    setGradient(slug: string, value: string) {
        this.gradients = this.gradients.map(gradient => gradient.slug === slug ? { ...gradient, value } : gradient);
    }

    @Client()
    setCustomGradient(index: number, patch: Partial<Preset>) {
        this.customGradients = this.customGradients.map((gradient, at) => at === index ? { ...gradient, ...patch } : gradient);
    }

    /** A new gradient of the site's own, named once like a custom color. */
    @Client()
    addCustomGradient() {
        const taken = new Set([...this.gradients, ...this.customGradients].map(gradient => gradient.slug));
        let index = this.customGradients.length + 1;
        while (taken.has(`gradient-${index}`)) index += 1;
        this.customGradients = [...this.customGradients, { slug: `gradient-${index}`, name: `${__('Gradient')} ${index}`, value: 'linear-gradient(135deg, #2563eb 0%, #7c3aed 100%)' }];
    }

    @Client()
    removeCustomGradient(index: number) {
        this.customGradients = this.customGradients.filter((_, at) => at !== index);
    }

    @Client()
    set(name: string, value: string | boolean | null) {
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
        this.mediaEpoch++;
        this.message = '';
        await this.save(this.values, this.colors.map(color => ({ slug: color.slug, value: color.value })), this.custom, this.customCss,
            this.gradients.map(gradient => ({ slug: gradient.slug, value: gradient.value })), this.customGradients);
        if (!this.error) this.message = __('Your changes are live.');
    }

    @Server()
    async findSettingFiles(search: string, kind: string) {
        return findSettingsMedia(this.c.get('cms'), this.c.get('principal'), search, kind);
    }

    @Server()
    async save(values: SettingValues, colors: { slug: string; value: string }[] = [], custom: Preset[] = [], customCss?: string, gradients: { slug: string; value: string }[] = [], customGradients: Preset[] = []) {
        this.error = '';
        this.errors = {};
        const cms = this.c.get('cms');
        const theme = cms.themes().find(entry => entry.name === this.theme.name);
        if (!theme) { this.error = __('No theme is active.'); return; }
        // The palette and the gradients: only values that differ from the theme's are kept, so a theme update reaches untouched ones.
        const themePresets = resolvePresets(theme.presets);
        const changes = (kind: 'colors' | 'gradients', list: { slug: string; value: string }[]) => Object.fromEntries(list.filter(entry => {
            const original = themePresets[kind].find(preset => preset.slug === entry.slug);
            return original && entry.value.trim() && entry.value.trim() !== original.value;
        }).map(entry => [entry.slug, entry.value.trim()]));
        const additions = (list: Preset[], fallback: string) => list.map(preset => {
            const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(preset.slug) ? preset.slug : slugify(preset.name) || fallback;
            return { slug, name: preset.name.trim(), value: preset.value.trim() };
        });
        const changed = changes('colors', colors);
        const added = additions(custom, 'custom');
        const changedGradients = changes('gradients', gradients);
        const addedGradients = additions(customGradients, 'gradient');
        const overrides = { ...(Object.keys(changed).length ? { colors: changed } : {}), ...(added.length ? { custom: added } : {}),
            ...(Object.keys(changedGradients).length ? { gradients: changedGradients } : {}), ...(addedGradients.length ? { customGradients: addedGradients } : {}) };
        const colorProblem = presetOverridesProblem({ ...(overrides.colors ? { colors: overrides.colors } : {}), ...(overrides.custom ? { custom: overrides.custom } : {}) });
        if (colorProblem) { this.errors = { colors: colorProblem }; this.error = __('Some colors are invalid.'); return; }
        const gradientProblem = presetOverridesProblem({ ...(overrides.gradients ? { gradients: overrides.gradients } : {}), ...(overrides.customGradients ? { customGradients: overrides.customGradients } : {}) });
        if (gradientProblem) { this.errors = { gradients: gradientProblem }; this.error = __('Some gradients are invalid.'); return; }
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
        // One row whatever the width: the name and the value shrink, the picker and the buttons do not.
        return html`<li class="flex items-center gap-2" data-color=${color.slug}>
            <span class="shrink-0">${component(ColorPicker, { value: color.value, label: `${color.name} ${__('picker')}`, onChange: (value: string) => change({ value }) })}</span>
            ${remove ? component(Input, { type: 'text', class: 'min-w-0', maxlength: 40, '.value': color.name, 'aria-label': __('Name'), '@input': (event: Event) => change({ name: (event.target as HTMLInputElement).value }) })
                : html`<span class="min-w-0 flex-1 truncate text-sm font-medium text-foreground" title=${color.name}>${color.name}</span>`}
            <span class="w-36 shrink-0">${component(Input, { type: 'text', class: 'font-mono text-xs', maxlength: 80, '.value': color.value, 'aria-label': `${color.name} ${__('value')}`, '@input': (event: Event) => change({ value: (event.target as HTMLInputElement).value }) })}</span>
            ${changed ? html`<button type="button" class="shrink-0 border-none bg-transparent text-xs text-muted-foreground hover:text-foreground cursor-pointer" @click=${() => change({ value: color.themeValue! })}>${__('Reset')}</button>` : null}
            ${remove ? html`<button type="button" class="shrink-0 border-none bg-transparent text-xs text-destructive hover:underline cursor-pointer" @click=${remove}>${__('Remove')}</button>` : null}
        </li>`;
    }

    /** A gradient: its swatch, its name (editable for the site's own), its CSS value, and Reset or Remove. */
    private gradientRow(gradient: Preset & { themeValue?: string }, change: (patch: Partial<Preset>) => void, remove?: () => void): TemplateResult {
        const changed = gradient.themeValue !== undefined && gradient.value !== gradient.themeValue;
        return html`<li class="flex items-center gap-2" data-gradient=${gradient.slug}>
            <span aria-hidden="true" class="inline-block h-8 w-14 shrink-0 rounded border border-border" style=${`background: ${gradient.value}`}></span>
            ${remove ? html`<span class="w-28 shrink-0">${component(Input, { type: 'text', maxlength: 40, '.value': gradient.name, 'aria-label': __('Name'), '@input': (event: Event) => change({ name: (event.target as HTMLInputElement).value }) })}</span>`
                : html`<span class="w-28 shrink-0 truncate text-sm font-medium text-foreground" title=${gradient.name}>${gradient.name}</span>`}
            ${component(Input, { type: 'text', class: 'min-w-0 flex-1 font-mono text-xs', maxlength: 400, '.value': gradient.value, 'aria-label': `${gradient.name} ${__('value')}`, '@input': (event: Event) => change({ value: (event.target as HTMLInputElement).value }) })}
            ${changed ? html`<button type="button" class="shrink-0 border-none bg-transparent text-xs text-muted-foreground hover:text-foreground cursor-pointer" @click=${() => change({ value: gradient.themeValue! })}>${__('Reset')}</button>` : null}
            ${remove ? html`<button type="button" class="shrink-0 border-none bg-transparent text-xs text-destructive hover:underline cursor-pointer" @click=${remove}>${__('Remove')}</button>` : null}
        </li>`;
    }

    private gradientsSection(): TemplateResult {
        return html`<section class="space-y-3" aria-labelledby="customize-gradients">
            <div>
                <h2 id="customize-gradients" class="text-sm font-semibold text-foreground">${__('Gradients')}</h2>
                <p class="text-xs text-muted-foreground">${__('Backgrounds for groups, columns and grids, under Advanced background on their Style tab. A CSS gradient, which may use the palette: linear-gradient(135deg, var(--cms-color-primary), #7c3aed).')}</p>
            </div>
            ${this.gradients.length || this.customGradients.length ? html`<ul class="space-y-2">
                ${this.gradients.map(gradient => this.gradientRow(gradient, patch => this.setGradient(gradient.slug, patch.value ?? gradient.value)))}
                ${this.customGradients.map((gradient, index) => this.gradientRow(gradient, patch => this.setCustomGradient(index, patch), () => this.removeCustomGradient(index)))}
            </ul>` : null}
            ${this.errors.gradients ? html`<p role="alert" class="text-xs text-destructive">${this.errors.gradients}</p>` : null}
            ${this.customGradients.length < 12 ? component(Button, { type: 'button', variant: 'outline', size: 'sm', '@click': () => this.addCustomGradient() }, __('Add gradient')) : null}
        </section>`;
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
            ${this.message ? notice(this.message, 'success') : null}
            ${this.error ? notice(this.error, 'error') : null}
            ${component(Card, {}, component(CardBody, {}, html`<form class="space-y-6" @submit=${(event: Event) => this.submit(event)}>
                ${this.rows.length ? html`<section class="space-y-5" aria-labelledby="customize-options">
                    <h2 id="customize-options" class="text-sm font-semibold text-foreground">${__('Options')}</h2>
                    ${this.rows.map(row => settingControl(row, this.values[row.name], this.errors[row.name], value => this.set(row.name, value), this.mediaEnabled ? {
                        find: (search, kind) => this.findSettingFiles(search, kind), canUpload: this.mediaUpload, epoch: () => this.mediaEpoch,
                    } : undefined))}
                </section>` : null}
                ${this.colorsSection()}
                ${this.gradientsSection()}
                ${this.cssSection()}
                <div>${component(Button, { type: 'submit' }, __('Publish changes'))}</div>
            </form>`))}
        </div>`;
    }
}
