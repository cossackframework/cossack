import { Cossack, Page, State, Server, type HeadValue } from '@cossackframework/core';
import { Button, Card, CardBody, CodeEditor, NativeSelect } from '@cossackframework/ui';
import { html, component, type TemplateResult } from '@cossackframework/renderer';
import { compareRecords, isCmsError, recordTitle, type FieldChange } from '@cossackframework/cms';
import { routeResource } from '../../../../../../../cms/content';
import { notice, pageHeader, shortDate } from '../../../../../../../cms/ui';

interface RevisionOption { revision: number; at: number; actor: string }

/** Fields every write changes; comparing them says nothing. */
const UNCOMPARED = new Set(['translationGroup']);

/**
 * Compare two revisions of an entry field by field: text and JSON in a code editor's diff, with
 * the words added and removed beneath prose, and restore an older one. Restoring keeps the
 * entry's status, publication time, URL and language.
 */
@Page({ transport: 'http' })
export default class RevisionsPage extends Cossack {
    @State() route = '';
    @State() id = '';
    @State() title = '';
    @State() singular = '';
    @State() current = 0;
    @State() revisions: RevisionOption[] = [];
    @State() from = 0;
    @State() to = 0;
    @State() changes: FieldChange[] = [];
    @State() canRestore = false;
    @State() error = '';

    head(): HeadValue {
        return { title: `${__('Revisions')}: ${this.title}` };
    }

    async init() {
        this.route = this.c.req.param('collection') ?? '';
        this.id = this.c.req.param('id') ?? '';
        const cms = this.c.get('cms');
        const principal = this.c.get('principal');
        try {
            const { resource, collection } = routeResource(cms, this.route);
            const repository = cms.resource(resource.id);
            const record = await repository.get(this.id, { principal });
            if (!record) { this.error = __('This entry does not exist or you cannot read it.'); this.c.status(404); return; }
            this.title = recordTitle(record, resource.titleField);
            this.singular = collection?.singular ?? __('Entry');
            this.current = record.rev;
            this.canRestore = repository.canUpdate(record, principal);
            const revisions = await repository.revisions(this.id, { principal }, { limit: 50 });
            const actors = await cms.users.getMany(revisions.map(entry => entry.actor ?? '').filter(Boolean));
            this.revisions = revisions.map(entry => ({ revision: entry.revision, at: entry.at, actor: actors.get(entry.actor ?? '')?.name ?? entry.actor ?? '' }));
            const wanted = (name: string, fallback: number) => {
                const value = Number(this.c.req.query(name));
                return this.revisions.some(entry => entry.revision === value) ? value : fallback;
            };
            this.to = wanted('to', this.revisions[0]?.revision ?? 0);
            this.from = wanted('from', this.revisions.find(entry => entry.revision < this.to)?.revision ?? 0);
            const [before, after] = await Promise.all([
                this.from ? repository.revision(this.id, this.from, { principal }) : null,
                repository.revision(this.id, this.to, { principal }),
            ]);
            if (after) {
                const fields = Object.fromEntries(Object.entries(resource.fields).filter(([name]) => !UNCOMPARED.has(name)));
                this.changes = compareRecords(fields, before?.data ?? null, after.data);
            }
        } catch (error) {
            this.error = isCmsError(error) ? error.message : __('The revisions could not be loaded.');
        }
    }

    @Server()
    async restore(revision: number) {
        const cms = this.c.get('cms');
        try {
            const { resource } = routeResource(cms, this.route);
            await cms.resource(resource.id).restore(this.id, revision, { principal: this.c.get('principal'), expectedRevision: this.current });
            return this.redirect(`/dashboard/content/${this.route}/${this.id}?saved=1`);
        } catch (error) {
            this.error = isCmsError(error) ? error.message : __('The revision could not be restored.');
        }
    }

    private change(change: FieldChange): TemplateResult {
        const part = (kind: string, text: string) => kind === 'added' ? html`<ins class="rounded-sm bg-emerald-500/15 text-emerald-800 no-underline dark:text-emerald-300">${text}</ins>`
            : kind === 'removed' ? html`<del class="rounded-sm bg-destructive/10 text-destructive">${text}</del>` : html`<span>${text}</span>`;
        return html`<section class="space-y-2" data-field=${change.name}>
            <h3 class="text-sm font-semibold text-foreground">${change.label}</h3>
            ${change.structured || change.kind === 'text' ? html`
                ${component(CodeEditor, { id: `diff-${change.name}`, value: change.after, original: change.before, language: change.structured ? 'json' : 'markdown', label: `${change.label} ${__('changes')}`, class: 'rounded-md border border-border bg-background' })}
                ${change.kind === 'text' && !change.structured ? html`<details class="text-sm"><summary class="cursor-pointer text-xs text-muted-foreground">${__('Words changed')}</summary>
                    <div class="mt-2 whitespace-pre-wrap break-words rounded-md border border-border bg-background p-3 leading-6 text-foreground">${change.parts.map(entry => part(entry.kind, entry.text))}</div></details>` : null}`
                : html`<div class="grid gap-2 text-sm sm:grid-cols-2">
                    <div class="rounded-md border border-border bg-destructive/5 p-3"><span class="block text-xs text-muted-foreground">${__('Before')}</span><span class="whitespace-pre-wrap break-words">${change.before || '—'}</span></div>
                    <div class="rounded-md border border-border bg-emerald-500/5 p-3"><span class="block text-xs text-muted-foreground">${__('After')}</span><span class="whitespace-pre-wrap break-words">${change.after || '—'}</span></div>
                </div>`}
        </section>`;
    }

    render() {
        const base = `/dashboard/content/${this.route}/${this.id}`;
        if (!this.revisions.length) return html`<div class="space-y-4">${notice(this.error || __('This entry has no revisions.'), this.error ? 'error' : 'info')}<a href=${base} class="text-sm text-primary hover:underline">← ${__('Back to the editor')}</a></div>`;
        const option = (entry: RevisionOption, selected: number) => html`<option value=${entry.revision} ?selected=${entry.revision === selected}>#${entry.revision} · ${shortDate(entry.at)}${entry.actor ? ` · ${entry.actor}` : ''}${entry.revision === this.current ? ` (${__('current')})` : ''}</option>`;
        const target = this.revisions.find(entry => entry.revision === this.to);
        return html`<div class="max-w-5xl space-y-6">
            ${pageHeader(`${__('Compare revisions of')} “${this.title}”`, { actions: html`<a href=${base} class="text-sm text-muted-foreground hover:text-foreground">← ${__('Back to the editor')}</a>` })}
            ${this.error ? notice(this.error, 'error') : null}
            ${component(Card, {}, component(CardBody, {}, html`<form method="get" class="flex flex-wrap items-end gap-3">
                <label class="space-y-1 text-sm"><span class="block font-medium text-foreground">${__('From')}</span>
                    ${component(NativeSelect, { name: 'from' }, html`<option value="0" ?selected=${!this.from}>${__('Nothing (the first version)')}</option>${this.revisions.map(entry => option(entry, this.from))}`)}</label>
                <label class="space-y-1 text-sm"><span class="block font-medium text-foreground">${__('To')}</span>
                    ${component(NativeSelect, { name: 'to' }, html`${this.revisions.map(entry => option(entry, this.to))}`)}</label>
                ${component(Button, { type: 'submit', variant: 'outline' }, __('Compare'))}
            </form>`))}
            <div class="flex flex-wrap items-center justify-between gap-3">
                <p class="text-sm text-muted-foreground">${target ? html`${__('Revision')} #${target.revision} ${__('by')} ${target.actor || __('the system')}, ${shortDate(target.at)}` : null}</p>
                ${this.canRestore && this.to !== this.current ? component(Button, { type: 'button', '@click': () => this.restore(this.to) }, `${__('Restore revision')} #${this.to}`) : null}
            </div>
            ${this.changes.length ? html`<div class="space-y-6">${this.changes.map(change => this.change(change))}</div>`
                : notice(__('These revisions have the same content.'))}
        </div>`;
    }
}
