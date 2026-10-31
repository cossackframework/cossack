import { Cossack, Page, State, Server, Client, type HeadValue } from '@cossackframework/core';
import { Badge, Button, Card, CardBody, Checkbox, Input, NativeSelect, Textarea, toast } from '@cossackframework/ui';
import { html, component, type TemplateResult } from '@cossackframework/renderer';
import { displayValue, formatSiteDate, isCmsError, isRows, PERMISSIONS, type FormField, type SubmissionShape, type SubmissionStatus } from '@cossackframework/cms';
import type { LoadedForm } from '@cossackframework/cms/server';
import { requireAny } from '../../../../../../../cms/guards';
import { notice, pageHeader } from '../../../../../../../cms/ui';

/** An answer; a repeater's rows as a table, one column per input of a row. */
interface Answer { label: string; value: string; rows?: { columns: string[]; cells: string[][] } }
interface View {
    id: string;
    status: SubmissionStatus;
    answers: Answer[];
    details: Answer[];
    note: string;
    /** The form's inputs and the answers as stored, for editing. */
    inputs: FormField[];
    values: Record<string, unknown>;
}

/**
 * One submission: every answer, when and from where it came, who sent it, and a note for
 * whoever handles it, and editing of the answers. Opening a new submission marks it read.
 * Needs `cms:submissions`.
 */
@Page({ transport: 'http', middlewares: [requireAny(PERMISSIONS.manageSubmissions)] })
export default class SubmissionPage extends Cossack {
    @State() form: { id: string; title: string } | null = null;
    @State() view: View | null = null;
    @State() note = '';
    @State() error = '';
    @State() editing = false;
    /** The answers being edited, as the form would post them. */
    @State() draft: Record<string, unknown> = {};
    @State() errors: Record<string, string> = {};

    head(): HeadValue {
        return { title: this.form ? `${__('Submission')}: ${this.form.title}` : __('Submission') };
    }

    async init() {
        await this.load(true);
        if (!this.view) this.c.status(404);
    }

    private async loaded(): Promise<LoadedForm | null> {
        return this.c.get('cms').forms.get(this.c.req.param('id') ?? '');
    }

    @Server()
    private async load(open = false) {
        const cms = this.c.get('cms');
        const principal = this.c.get('principal');
        const form = await this.loaded();
        this.form = form ? { id: form.ref.id, title: form.ref.title } : null;
        let submission = form ? await cms.forms.submission(form, this.c.req.param('submission') ?? '', principal) : null;
        if (!form || !submission) { this.view = null; return; }
        if (open && submission.status === 'new') {
            await cms.forms.setStatus(form, [submission.id], 'read', principal);
            submission = { ...submission, status: 'read' };
        }
        this.view = await this.describe(form, submission);
        this.note = submission.note;
    }

    private async describe(form: LoadedForm, submission: SubmissionShape): Promise<View> {
        const cms = this.c.get('cms');
        const settings = await cms.settings.all();
        const user = submission.user ? await cms.users.get(submission.user) : null;
        const meta = submission.meta;
        const details: Answer[] = [
            { label: __('Submitted'), value: formatSiteDate(submission.createdAt, settings, { time: settings['general.timeFormat'] }) },
            ...(user ? [{ label: __('User'), value: `${user.name} <${user.email}>` }] : []),
            ...(meta.page ? [{ label: __('Page'), value: meta.page }] : []),
            ...(meta.referrer ? [{ label: __('Referrer'), value: meta.referrer }] : []),
            ...(meta.ip ? [{ label: __('IP address'), value: meta.ip }] : []),
            ...(meta.userAgent ? [{ label: __('Browser'), value: meta.userAgent }] : []),
            ...(meta.locale ? [{ label: __('Language'), value: meta.locale }] : []),
            { label: __('ID'), value: submission.id },
        ];
        return {
            id: submission.id, status: submission.status, note: submission.note, details, inputs: [...form.ref.inputs], values: { ...submission.values },
            answers: form.ref.inputs.map(input => {
                const value = submission.values[input.name];
                // A multiple input's values read one per line.
                const answer: Answer = { label: input.label, value: input.multiple && Array.isArray(value) ? (value as readonly (string | number)[]).map(String).join('\n') : displayValue(input, value) };
                if (input.kind === 'rows' && isRows(value)) answer.rows = { columns: input.inputs.map(child => child.label), cells: value.map(row => input.inputs.map(child => displayValue(child, row[child.name]))) };
                return answer;
            }),
        };
    }

    @Server()
    async setStatus(status: SubmissionStatus | 'delete') {
        const cms = this.c.get('cms');
        const form = await this.loaded();
        const id = this.view?.id;
        if (!form || !id) return;
        this.error = '';
        try {
            if (status === 'delete') {
                await cms.forms.delete(form, [id], this.c.get('principal'));
                return this.redirect(`/dashboard/forms/${form.ref.id}/submissions`);
            }
            await cms.forms.setStatus(form, [id], status, this.c.get('principal'));
        } catch (error) { if (!isCmsError(error)) throw error; this.error = error.message; return; }
        await this.load();
    }

    @Server()
    async saveNote(note: string) {
        const cms = this.c.get('cms');
        const form = await this.loaded();
        const id = this.view?.id;
        if (!form || !id) return;
        this.error = '';
        try {
            const saved = await cms.forms.setNote(form, id, note, this.c.get('principal'));
            this.view = await this.describe(form, saved);
            this.note = saved.note;
        } catch (error) { if (!isCmsError(error)) throw error; this.error = error.message; }
    }

    @Server()
    async saveValues(draft: Record<string, unknown>) {
        const cms = this.c.get('cms');
        const form = await this.loaded();
        const id = this.view?.id;
        if (!form || !id) return;
        this.error = '';
        this.errors = {};
        try {
            const saved = await cms.forms.setValues(form, id, draft, this.c.get('principal'));
            this.view = await this.describe(form, saved);
            this.editing = false;
        } catch (error) {
            if (!isCmsError(error)) throw error;
            this.error = error.message;
            this.errors = error.fields ? { ...error.fields } : {};
        }
    }

    @Client()
    startEditing() {
        this.draft = { ...(this.view?.values ?? {}) };
        this.errors = {};
        this.editing = true;
    }

    @Client()
    async submitValues(event: Event) {
        event.preventDefault();
        await this.saveValues(this.draft);
        if (this.error) toast.error(this.error); else toast.success(__('Answers saved.'));
    }

    @Client()
    private setAnswer(name: string, value: unknown) {
        this.draft = { ...this.draft, [name]: value };
    }

    /** A control for one input, by its kind; a repeater's rows and a multiple input's items are edited as text. */
    private control(input: FormField): TemplateResult {
        const id = `answer-${input.name}`;
        const value = this.draft[input.name];
        const set = (next: unknown) => this.setAnswer(input.name, next);
        const text = (event: Event) => set((event.target as HTMLInputElement | HTMLTextAreaElement).value);
        if (input.kind === 'rows') {
            // Rows as JSON: a list of objects, one per row, with the row inputs' values.
            const json = typeof value === 'string' ? value : JSON.stringify(Array.isArray(value) ? value : [], null, 2);
            return component(Textarea, { id, rows: 6, class: 'font-mono text-xs', '.value': json, '@input': (event: Event) => {
                const raw = (event.target as HTMLTextAreaElement).value;
                try { set(JSON.parse(raw)); } catch { set(raw); }
            } });
        }
        if (input.multiple) {
            const lines = Array.isArray(value) ? (value as unknown[]).map(String).join('\n') : typeof value === 'string' ? value : '';
            return component(Textarea, { id, rows: 3, '.value': lines, '@input': (event: Event) => set((event.target as HTMLTextAreaElement).value.split('\n').map(line => line.trim()).filter(Boolean)) });
        }
        switch (input.kind) {
            case 'boolean': return html`<label class="flex items-center gap-2 text-sm text-foreground cursor-pointer">${component(Checkbox, { id, checked: value === true, '@change': (event: Event) => set((event.target as HTMLInputElement).checked) })} ${input.label}</label>`;
            case 'choice': return component(NativeSelect, { id, '@change': text }, html`<option value="" ?selected=${!value}>—</option>${input.options.map(option => html`<option value=${option.value} ?selected=${option.value === value}>${option.label}</option>`)}`);
            case 'choices': {
                const chosen = new Set(Array.isArray(value) ? (value as unknown[]).map(String) : []);
                return html`<div class="space-y-1">${input.options.map(option => html`<label class="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                    ${component(Checkbox, { checked: chosen.has(option.value), '@change': (event: Event) => { const next = new Set(chosen); if ((event.target as HTMLInputElement).checked) next.add(option.value); else next.delete(option.value); set([...next]); } })} ${option.label}</label>`)}</div>`;
            }
            case 'text': return component(Textarea, { id, rows: 4, '.value': String(value ?? ''), '@input': text });
            case 'number': return component(Input, { id, type: 'number', '.value': value === undefined || value === null ? '' : String(value), '@input': text });
            case 'date': return component(Input, { id, type: 'date', '.value': String(value ?? ''), '@input': text });
            default: return component(Input, { id, type: input.kind === 'email' ? 'email' : input.kind === 'url' ? 'url' : input.kind === 'phone' ? 'tel' : 'text', '.value': String(value ?? ''), '@input': text });
        }
    }

    private editor(view: View): TemplateResult {
        return html`<form class="space-y-4 p-4" @submit=${(event: Event) => this.submitValues(event)}>
            ${view.inputs.map(input => html`<div class="space-y-1.5">
                ${input.kind === 'boolean' ? null : html`<label for=${`answer-${input.name}`} class="block text-sm font-medium text-foreground">${input.label}${input.required ? html`<span class="text-destructive"> *</span>` : null}</label>`}
                ${this.control(input)}
                ${this.errors[input.name] ? html`<p role="alert" class="text-xs text-destructive">${this.errors[input.name]}</p>` : null}
            </div>`)}
            ${Object.keys(this.errors).some(key => !view.inputs.some(input => input.name === key)) ? html`<ul role="alert" class="space-y-1 text-xs text-destructive">
                ${Object.entries(this.errors).filter(([key]) => !view.inputs.some(input => input.name === key)).map(([key, message]) => html`<li><code>${key}</code> ${message}</li>`)}</ul>` : null}
            <div class="flex flex-wrap gap-2">
                ${component(Button, { type: 'submit', size: 'sm' }, __('Save answers'))}
                ${component(Button, { type: 'button', size: 'sm', variant: 'ghost', '@click': () => { this.editing = false; this.errors = {}; } }, __('Cancel'))}
            </div>
        </form>`;
    }

    @Client()
    async submitNote(event: Event) {
        event.preventDefault();
        await this.saveNote(this.note);
        if (this.error) toast.error(this.error); else toast.success(__('Note saved.'));
    }

    private list(entries: readonly Answer[]): TemplateResult {
        return html`<dl class="divide-y divide-border">${entries.map(entry => html`<div class="grid gap-1 px-4 py-3 sm:grid-cols-3">
            <dt class="text-sm font-medium text-muted-foreground">${entry.label}</dt>
            <dd class="whitespace-pre-wrap break-words text-sm text-foreground sm:col-span-2">${entry.rows ? html`<span>${entry.value}</span>
                <div class="mt-2 overflow-x-auto"><table class="w-full text-left text-xs"><thead><tr>${entry.rows.columns.map(column => html`<th class="border-b border-border px-2 py-1 font-medium text-muted-foreground">${column}</th>`)}</tr></thead>
                <tbody>${entry.rows.cells.map(cells => html`<tr>${cells.map(cell => html`<td class="border-b border-border px-2 py-1 align-top">${cell || html`<span class="text-muted-foreground">—</span>`}</td>`)}</tr>`)}</tbody></table></div>`
                : entry.value || html`<span class="text-muted-foreground">—</span>`}</dd>
        </div>`)}</dl>`;
    }

    render() {
        const back = `/dashboard/forms/${this.form?.id ?? ''}/submissions`;
        if (!this.view || !this.form) return html`<div class="space-y-4">${pageHeader(__('Submission'))}${notice(__('This submission does not exist.'), 'error')}
            <a href=${this.form ? back : '/dashboard/forms'} class="text-sm text-primary hover:underline">${__('Back to submissions')}</a></div>`;
        const view = this.view;
        const action = (label: string, status: SubmissionStatus | 'delete', variant: 'outline' | 'destructive' = 'outline') =>
            component(Button, { type: 'button', size: 'sm', variant, '@click': () => this.setStatus(status) }, label);
        const actions = view.status === 'spam' ? [action(__('Not spam'), 'read'), action(__('Delete permanently'), 'delete', 'destructive')]
            : view.status === 'trash' ? [action(__('Restore'), 'read'), action(__('Delete permanently'), 'delete', 'destructive')]
            : [action(__('Mark as unread'), 'new'), action(__('Mark as spam'), 'spam'), action(__('Move to trash'), 'trash', 'destructive')];
        return html`<div class="space-y-6">
            <a href=${back} class="text-sm text-primary hover:underline">← ${__('All submissions')}</a>
            ${pageHeader(`${__('Submission')}: ${this.form.title}`, { actions: html`${view.status === 'spam' ? component(Badge, { variant: 'destructive' }, __('Spam')) : view.status === 'trash' ? component(Badge, { variant: 'secondary' }, __('Trash')) : null}${actions}` })}
            ${this.error ? notice(this.error, 'error') : null}
            <div class="grid gap-6 lg:grid-cols-3">
                <div class="lg:col-span-2">${component(Card, {}, component(CardBody, { class: 'p-0' }, html`<div class="flex items-center justify-between border-b border-border px-4 py-2">
                    <h2 class="text-sm font-semibold text-foreground">${__('Answers')}</h2>
                    ${this.editing ? null : component(Button, { type: 'button', size: 'sm', variant: 'outline', '@click': () => this.startEditing() }, __('Edit'))}</div>
                    ${this.editing ? this.editor(view) : this.list(view.answers)}`))}</div>
                <div class="space-y-6">
                    ${component(Card, {}, component(CardBody, { class: 'p-0' }, html`<h2 class="border-b border-border px-4 py-3 text-sm font-semibold text-foreground">${__('Details')}</h2>${this.list(view.details)}`))}
                    ${component(Card, {}, component(CardBody, {}, html`<form class="space-y-2" @submit=${(event: Event) => this.submitNote(event)}>
                        <label for="submission-note" class="block text-sm font-semibold text-foreground">${__('Note')}</label>
                        ${component(Textarea, { id: 'submission-note', rows: 4, '.value': this.note, '@input': (event: Event) => { this.note = (event.target as HTMLTextAreaElement).value; } })}
                        <p class="text-xs text-muted-foreground">${__('Only people who handle submissions see it.')}</p>
                        ${component(Button, { type: 'submit', size: 'sm' }, __('Save note'))}
                    </form>`))}
                </div>
            </div>
        </div>`;
    }
}
