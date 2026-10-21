import { Cossack, Page, State, type HeadValue } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';
import { isCmsError, type EntryView, type RecordShape, type ThemeData } from '@cossackframework/cms';
import { entryInput } from '../../../../../cms/content';
import { entryViews, themeData, themeState, type ThemeState } from '../../../../../cms/site';
import { entryTemplate, siteContent, siteTheme, themeHelpers } from '../../../../../cms/site-view';

/**
 * An entry as the site will show it, whatever its status. Its editors see their newest
 * autosave; anyone with a preview link (`?token=`) sees the saved entry. Never indexed or cached.
 */
@Page({ transport: 'http' })
export default class PreviewPage extends Cossack {
    @State() entry: EntryView | null = null;
    @State() status = '';
    @State() autosaved = false;
    @State() editUrl = '';
    @State() theme: ThemeState = { name: null, options: {} };
    @State() data: ThemeData = {};

    head(): HeadValue {
        return {
            title: this.entry ? `${__('Preview')}: ${this.entry.title}` : __('Preview'),
            meta: [{ tag: 'meta', attributes: { name: 'robots', content: 'noindex, nofollow' } }],
        };
    }

    async init() {
        const cms = this.c.get('cms');
        const principal = this.c.get('principal');
        const name = this.c.req.param('collection') ?? '';
        const id = this.c.req.param('id') ?? '';
        const token = this.c.req.query('token');
        this.c.header('cache-control', 'private, no-store');
        this.c.header('x-robots-tag', 'noindex');
        try {
            this.theme = await themeState(cms);
            const collection = cms.collection(name);
            const resourceId = `cms/${collection.name}`;
            let record: RecordShape | null = null;
            if (token) {
                const found = await cms.previewByToken(token);
                if (found?.resource.id === resourceId && found.record.id === id) record = found.record;
            } else {
                const repository = cms.resource(resourceId);
                const saved = await repository.get(id, { principal });
                if (saved && repository.canUpdate(saved, principal)) {
                    record = saved;
                    this.editUrl = `/dashboard/content/${collection.name}/${id}`;
                    // Unsaved changes from the editor show in place of the saved ones.
                    const autosave = await cms.latestAutosave(resourceId, id, principal);
                    if (autosave && autosave.at > saved.updatedAt && autosave.data && typeof autosave.data === 'object') {
                        const input = await entryInput(cms, collection.name, autosave.data as Record<string, unknown>).catch(() => null);
                        if (input) { record = { ...saved, ...input }; this.autosaved = true; }
                    }
                }
            }
            if (!record) {
                this.c.status(404);
                return;
            }
            this.status = String(record.status ?? '');
            this.entry = (await entryViews(cms, collection, [record], { full: true }))[0]!;
            this.data = await themeData(cms, this.theme, { kind: 'entry', collection: collection.name, template: this.entry.template }, this.entry, principal, this.entry.locale);
        } catch (error) {
            if (!isCmsError(error)) throw error;
            this.c.status(error.status === 503 ? 503 : 404);
        }
    }

    render() {
        if (!this.entry) return html`<section class="space-y-3 py-16 text-center">
            <h1 class="text-3xl font-bold text-foreground">${__('Preview not available')}</h1>
            <p class="text-muted-foreground">${__('The link expired, or you cannot edit this entry.')}</p>
        </section>`;
        const theme = siteTheme(this.theme);
        const helpers = themeHelpers(theme, { ...this.theme, data: { page: this.data } }, (path, exact) => this.isActive(path, exact));
        return html`<div role="status" class="mb-6 flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-foreground">
                <span><strong>${__('Preview')}</strong> · ${this.status === 'published' ? __('Published') : __('Not published')}${this.autosaved ? html` · ${__('with unsaved changes')}` : null}</span>
                ${this.editUrl ? html`<a href=${this.editUrl} class="text-primary hover:underline">${__('Back to the editor')}</a>` : null}
            </div>
            ${siteContent(entryTemplate(theme, this.entry.collection, this.entry.template)(this.entry, helpers))}`;
    }
}
