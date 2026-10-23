import { Cossack, Page, State, Server, Client, type HeadValue } from '@cossackframework/core';
import { Badge, Button, Card, CardBody, Textarea, toast } from '@cossackframework/ui';
import { html, component, type TemplateResult } from '@cossackframework/renderer';
import { displayValue, formatSiteDate, isCmsError, PERMISSIONS, type SubmissionShape, type SubmissionStatus } from '@cossackframework/cms';
import type { LoadedForm } from '@cossackframework/cms/server';
import { requireAny } from '../../../../../../../cms/guards';
import { notice, pageHeader } from '../../../../../../../cms/ui';

interface Answer { label: string; value: string }
interface View {
    id: string;
    status: SubmissionStatus;
    answers: Answer[];
    details: Answer[];
    note: string;
}

/**
 * One submission: every answer, when and from where it came, who sent it, and a note for
 * whoever handles it. Opening a new submission marks it read. Needs `cms:submissions`.
 */
@Page({ transport: 'http', middlewares: [requireAny(PERMISSIONS.manageSubmissions)] })
export default class SubmissionPage extends Cossack {
    @State() form: { id: string; title: string } | null = null;
    @State() view: View | null = null;
    @State() note = '';
    @State() error = '';

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
            id: submission.id, status: submission.status, note: submission.note, details,
            answers: form.ref.inputs.map(input => ({ label: input.label, value: displayValue(input, submission.values[input.name]) })),
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

    @Client()
    async submitNote(event: Event) {
        event.preventDefault();
        await this.saveNote(this.note);
        if (this.error) toast.error(this.error); else toast.success(__('Note saved.'));
    }

    private list(entries: readonly Answer[]): TemplateResult {
        return html`<dl class="divide-y divide-border">${entries.map(entry => html`<div class="grid gap-1 px-4 py-3 sm:grid-cols-3">
            <dt class="text-sm font-medium text-muted-foreground">${entry.label}</dt>
            <dd class="whitespace-pre-wrap break-words text-sm text-foreground sm:col-span-2">${entry.value || html`<span class="text-muted-foreground">—</span>`}</dd>
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
                <div class="lg:col-span-2">${component(Card, {}, component(CardBody, { class: 'p-0' }, html`<h2 class="border-b border-border px-4 py-3 text-sm font-semibold text-foreground">${__('Answers')}</h2>${this.list(view.answers)}`))}</div>
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
