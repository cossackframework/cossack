import { html, component, repeat, live } from '@cossackframework/renderer';
import { Cossack, Component, ClientState, Client, createRef } from '@cossackframework/core';
import { Card } from '../../components/Card.js';
import { Switch } from '../../components/Switch.js';
import { Input } from '../../components/Input.js';
import { Button } from '../../components/Button.js';
import { Badge } from '../../components/Badge.js';
import type { GlobalAttributes } from '../../native-attributes.js';
import { ControlledValue } from '../../native-attributes.js';

export type SettingsValues = Readonly<Record<string, boolean | string>>;
type RowIdentity = {
    /** Stable key, unique across this panel, and default native field name. */
    readonly key: string;
    readonly label: string;
    readonly hint?: string;
    readonly badge?: string;
    readonly disabled?: boolean;
};
export type SettingsRow = RowIdentity & (
    { readonly type: 'switch'; readonly name?: string; readonly required?: boolean }
    | { readonly type: 'text'; readonly name?: string; readonly placeholder?: string; readonly autocomplete?: string; readonly readonly?: boolean; readonly required?: boolean }
    | { readonly type: 'button'; readonly action: string; readonly variant?: 'outline' | 'destructive' }
);
export interface SettingsSection {
    readonly id: string;
    readonly title: string;
    readonly description?: string;
    readonly rows: readonly SettingsRow[];
}
type SharedProps = Omit<GlobalAttributes<HTMLDivElement>, 'id' | 'tabindex'> & {
    /** Stable page-unique ID used for fields and descriptions. */
    id: string;
    sections: readonly SettingsSection[];
    disabled?: boolean;
    /** Required when button rows exist. Actions never submit or reset a form. */
    onAction?: (key: string) => unknown;
};
export type SettingsPanelProps = SharedProps & (
    { values: SettingsValues; defaultValues?: never; onValuesChange: (values: SettingsValues) => unknown }
    | { values?: never; defaultValues?: SettingsValues; onValuesChange?: (values: SettingsValues) => unknown }
);

/** Native settings controls. Applications own persistence, authorization and action errors. */
@Component()
export class SettingsPanel extends Cossack {
    declare props: SettingsPanelProps;
    @ClientState() private localValues: SettingsValues | undefined;
    private initialValues?: SettingsValues;
    private controlled?: boolean;
    // A controlled parent applies onValuesChange in a later render. Until it replaces
    // props, edits build on, and controls show, the last emitted values.
    private pending = new ControlledValue<Record<string, boolean | string>>();
    private root = createRef<HTMLDivElement>();
    private connected = false;
    private generation = 0;
    private document?: Document;
    private resetTimers = new Set<ReturnType<typeof setTimeout>>();
    private focusTimer?: ReturnType<typeof setTimeout>;

    private rows(): readonly SettingsRow[] { return this.props.sections.flatMap(section => section.rows); }
    private snapshot(source: SettingsValues): Record<string, boolean | string> {
        const result: Record<string, boolean | string> = {};
        for (const row of this.rows()) {
            if (row.type === 'button') continue;
            const value = Object.hasOwn(source, row.key) ? source[row.key] : row.type === 'switch' ? false : '';
            if (typeof value !== (row.type === 'switch' ? 'boolean' : 'string')) throw new Error(`SettingsPanel value for ${row.key} must match its control type.`);
            // Define rather than assign so keys such as __proto__ remain ordinary data.
            Object.defineProperty(result, row.key, { value, enumerable: true, configurable: true, writable: true });
        }
        return result;
    }
    private currentValues(): Record<string, boolean | string> {
        this.initialValues ??= { ...(this.props.values ?? this.props.defaultValues ?? {}) };
        return this.snapshot(this.props.values ?? this.localValues ?? this.initialValues);
    }
    private controlId(key: string) { return `${this.props.id}-field-${encodeURIComponent(key)}`; }
    /** Values the controls show and the next edit builds on: pending emitted values, then props. */
    private shownValues(): Record<string, boolean | string> { return this.pending.base(this.props, this.currentValues()); }
    private syncControls() {
        const values = this.shownValues();
        for (const input of this.root.value?.querySelectorAll<HTMLInputElement>('input[data-setting-control]') ?? []) {
            const key = input.dataset.settingControl!;
            if (!Object.hasOwn(values, key)) continue;
            if (input.type === 'checkbox') input.checked = values[key] as boolean;
            else if (input.value !== values[key]) input.value = values[key] as string;
        }
    }
    private resetListener = (event: Event) => {
        if (event.target !== this.root.value?.closest('form')) return;
        const generation = this.generation;
        const timer = setTimeout(() => {
            this.resetTimers.delete(timer);
            if (!this.connected || generation !== this.generation || event.defaultPrevented) return;
            const next = this.snapshot(this.initialValues ?? {});
            if (this.props.values === undefined) this.localValues = { ...this.initialValues };
            this.emitChange(next);
        }, 0);
        this.resetTimers.add(timer);
    };
    private connectRoot = (element: Element) => {
        this.root.value = element as HTMLDivElement;
        this.connectDocument();
    };
    private connectDocument() {
        const generation = this.generation;
        queueMicrotask(() => {
            if (!this.connected || generation !== this.generation || !this.root.value) return;
            const document = this.root.value.ownerDocument;
            if (this.document === document) return;
            this.document?.removeEventListener('reset', this.resetListener, true);
            this.document = document;
            document.addEventListener('reset', this.resetListener, true);
        });
    }
    onMount() {
        this.connected = true; this.generation++;
        this.connectDocument();
    }
    onCleanup() {
        this.connected = false; this.generation++;
        for (const timer of this.resetTimers) clearTimeout(timer);
        this.resetTimers.clear();
        clearTimeout(this.focusTimer);
        this.document?.removeEventListener('reset', this.resetListener, true);
        this.document = undefined; this.root.value = undefined;
    }
    render() {
        const { id, sections, values, defaultValues, onValuesChange, onAction, disabled = false, ...root } = this.props;
        if (typeof id !== 'string' || !id.trim() || /\s/.test(id)) throw new Error('SettingsPanel requires a stable id without whitespace.');
        if (!Array.isArray(sections)) throw new Error('SettingsPanel requires sections.');
        if (values !== undefined && (defaultValues !== undefined || typeof onValuesChange !== 'function')) throw new Error('Controlled SettingsPanel requires onValuesChange and no defaultValues.');
        for (const source of [values, defaultValues]) if (source !== undefined && (source === null || typeof source !== 'object' || Array.isArray(source))) throw new Error('SettingsPanel values must be records.');
        this.controlled ??= values !== undefined;
        if (this.controlled !== (values !== undefined)) throw new Error('SettingsPanel cannot change value ownership after first render.');
        if (this.children != null && this.children !== false && this.children !== '') throw new Error('SettingsPanel uses sections, not positional children.');
        const sectionIds = new Set<string>(), keys = new Set<string>();
        const text = (value: unknown) => typeof value === 'string' && !!value.trim();
        for (const section of sections) {
            if (!section || !text(section.id) || sectionIds.has(section.id) || !text(section.title) || !Array.isArray(section.rows)) throw new Error('SettingsPanel sections require unique IDs, titles and rows.');
            sectionIds.add(section.id);
            for (const row of section.rows) {
                if (!row || !text(row.key) || keys.has(row.key) || !text(row.label) || !['switch', 'text', 'button'].includes(row.type)) throw new Error('SettingsPanel rows require unique keys, labels and valid types.');
                keys.add(row.key);
                if (row.type === 'button') {
                    if (!text(row.action) || typeof onAction !== 'function') throw new Error('SettingsPanel button rows require action text and onAction.');
                    if (row.variant !== undefined && !['outline', 'destructive'].includes(row.variant)) throw new Error('SettingsPanel action variant must be outline or destructive.');
                } else if (row.name !== undefined && !text(row.name)) throw new Error('SettingsPanel field names must be nonempty.');
            }
        }
        const current = this.currentValues();
        const focused = this.root.value?.ownerDocument.activeElement;
        if (focused && this.root.value?.contains(focused)) {
            const generation = this.generation;
            clearTimeout(this.focusTimer);
            this.focusTimer = setTimeout(() => {
                const root = this.root.value;
                if (!this.connected || generation !== this.generation || !root) return;
                const active = root.ownerDocument.activeElement;
                if (active === root.ownerDocument.body || (active === focused && focused.matches(':disabled'))) {
                    const same = root.ownerDocument.getElementById(focused.id);
                    const target = same && root.contains(same) && !same.matches(':disabled') ? same
                        : root.querySelector<HTMLElement>('input:not(:disabled),button:not(:disabled)') ?? root;
                    target.focus({ preventScroll: true });
                }
            }, 0);
        }
        return html`<div id=${id} tabindex="-1" ref=${this.connectRoot} class="cs-settings-panel w-full max-w-2xl mx-auto flex flex-col gap-6" ...=${root}>
            ${repeat<SettingsSection>(sections, section => section.id, section => {
                const titleId = `${id}-section-${encodeURIComponent(section.id)}`;
                return html`<section aria-labelledby=${titleId}>
                    ${component(Card, { class: 'min-w-0' }, html`
                        <h3 id=${titleId} class="text-base font-semibold text-card-foreground break-words">${section.title}</h3>
                        ${section.description ? html`<p class="text-sm text-muted-foreground mt-1">${section.description}</p>` : null}
                        ${repeat<SettingsRow>(section.rows, row => row.key, row => {
                            const fieldId = this.controlId(row.key), labelId = `${fieldId}-label`, hintId = `${fieldId}-hint`;
                            const unavailable = disabled || row.disabled;
                            return html`<div data-setting-row=${row.key} class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-3 border-b last:border-b-0 border-border">
                                <div class="min-w-0 flex-1 break-words">
                                    <div class="flex items-center flex-wrap gap-2">
                                        ${row.type === 'button' ? html`<span id=${labelId} class="text-sm font-medium">${row.label}</span>` : html`<label id=${labelId} for=${fieldId} class="text-sm font-medium">${row.label}</label>`}
                                        ${row.badge ? component(Badge, { variant: 'secondary' }, row.badge) : null}
                                    </div>
                                    ${row.hint ? html`<p id=${hintId} class="text-xs text-muted-foreground mt-0.5">${row.hint}</p>` : null}
                                </div>
                                <div class="min-w-0 sm:w-48 sm:shrink-0">
                                    ${row.type === 'button' ? component(Button, {
                                        id: fieldId, type: 'button', variant: row.variant ?? 'outline', size: 'sm', disabled: unavailable,
                                        'aria-describedby': `${labelId}${row.hint ? ` ${hintId}` : ''}`,
                                        '@click': event => { if (!event.currentTarget.matches(':disabled')) this.props.onAction?.(row.key); },
                                    }, row.action) : row.type === 'switch' ? component(Switch, {
                                        id: fieldId, name: row.name ?? row.key, checked: current[row.key] as boolean,
                                        disabled: unavailable, required: row.required, 'data-setting-control': row.key,
                                        'aria-labelledby': labelId, 'aria-describedby': row.hint ? hintId : undefined,
                                        '@change': event => this.updateValue(row.key, event.currentTarget.checked, event.currentTarget),
                                    }) : component(Input, {
                                        id: fieldId, type: 'text', name: row.name ?? row.key, '.value': live(current[row.key] as string),
                                        disabled: unavailable, readonly: row.readonly, required: row.required,
                                        placeholder: row.placeholder, autocomplete: row.autocomplete, 'data-setting-control': row.key,
                                        'aria-describedby': row.hint ? hintId : undefined,
                                        '@input': event => this.updateValue(row.key, event.currentTarget.value, event.currentTarget),
                                    })}
                                </div>
                            </div>`;
                        })}
                    `)}
                </section>`;
            })}
        </div>`;
    }
    @Client()
    private updateValue(key: string, value: boolean | string, control: HTMLInputElement) {
        if (control.matches(':disabled') || control.readOnly) return;
        const next = { ...this.shownValues(), [key]: value };
        if (this.props.values === undefined) this.localValues = { ...this.initialValues, ...this.localValues, [key]: value };
        this.emitChange(next);
    }
    private emitChange(next: Record<string, boolean | string>) {
        // Controls show the emitted values until the parent re-renders. Writing
        // stale props back here would revert the keystroke and move the caret.
        this.pending.emit(this.props, next);
        try { this.props.onValuesChange?.({ ...next }); }
        catch (error) { this.pending.reset(); throw error; }
        finally { this.syncControls(); }
    }
}
