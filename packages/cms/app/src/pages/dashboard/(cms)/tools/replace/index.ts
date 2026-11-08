import { Cossack, Page, State, Server, Client, type HeadValue } from '@cossackframework/core';
import { Button, Card, CardBody, CardHeader, Checkbox, Field, Input, NativeSelect } from '@cossackframework/ui';
import { html, component } from '@cossackframework/renderer';
import { isCmsError, PERMISSIONS, recordTitle, type Block, type RichTextDoc, type RichTextNode } from '@cossackframework/cms';
import { requireAny } from '../../../../../cms/guards';
import { notice, pageHeader } from '../../../../../cms/ui';

interface Match { id: string; title: string; href: string; fields: string[]; count: number }

/**
 * Tools → Find and replace: a word or phrase across a collection's titles, excerpts, summaries,
 * Markdown and rich text, previewed before it is applied. Each changed entry gets a revision,
 * so a replacement can be undone entry by entry.
 */
@Page({ transport: 'http', middlewares: [requireAny(PERMISSIONS.manageSettings)] })
export default class ReplacePage extends Cossack {
    @State() collections: { name: string; label: string }[] = [];
    @State() collection = 'posts';
    @State() find = '';
    @State() replace = '';
    @State() matchCase = false;
    @State() matches: Match[] = [];
    @State() scanned = 0;
    @State() previewed = false;
    @State() message = '';
    @State() error = '';

    head(): HeadValue {
        return { title: 'Find and replace' };
    }

    async init() {
        this.collections = this.c.get('cms').collections().filter(collection => !collection.managed).map(collection => ({ name: collection.name, label: collection.label }));
        if (!this.collections.some(collection => collection.name === this.collection)) this.collection = this.collections[0]?.name ?? '';
    }

    @Client()
    async submit(event: Event, apply: boolean) {
        event.preventDefault();
        if (apply) await this.run(this.collection, this.find, this.replace, this.matchCase, true);
        else await this.run(this.collection, this.find, this.replace, this.matchCase, false);
    }

    /** Scan up to a thousand entries; with `apply`, write the replacement to every matching entry. */
    @Server()
    async run(collection: string, find: string, replace: string, matchCase: boolean, apply: boolean) {
        this.error = '';
        this.message = '';
        this.collection = collection;
        this.find = find.slice(0, 200);
        this.replace = replace.slice(0, 2000);
        this.matchCase = matchCase;
        this.matches = [];
        this.scanned = 0;
        this.previewed = false;
        if (!this.find) { this.error = __('Enter the text to find.'); return; }
        const cms = this.c.get('cms');
        const principal = this.c.get('principal');
        const definition = cms.collections().find(entry => entry.name === collection);
        if (!definition) { this.error = __('Choose a collection.'); return; }
        const resource = cms.resource(`cms/${collection}`);
        const fields = Object.entries(cms.resourceById(`cms/${collection}`).fields).filter(([, declaration]) => declaration.kind === 'string' && !declaration.media && !declaration.taxonomy && !declaration.multiple || declaration.kind === 'text' || declaration.kind === 'richtext' || declaration.kind === 'blocks');
        const pattern = new RegExp(this.find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), matchCase ? 'g' : 'gi');
        try {
            for (let offset = 0; offset < 1000; offset += 100) {
                const page = await resource.list({ limit: 100, offset, order: { field: 'updatedAt', direction: 'desc' } }, { principal });
                for (const record of page.records) {
                    this.scanned++;
                    const changed: Record<string, unknown> = {};
                    const touched: string[] = [];
                    let count = 0;
                    for (const [name, declaration] of fields) {
                        const value = record[name];
                        const result = declaration.kind === 'richtext' ? replaceInDoc(value as RichTextDoc | null, pattern, this.replace)
                            : declaration.kind === 'blocks' ? replaceInBlocks(value as Block[] | null, pattern, this.replace)
                            : typeof value === 'string' ? replaceInText(value, pattern, this.replace) : null;
                        if (!result || !result.count) continue;
                        changed[name] = result.value;
                        touched.push(declaration.label ?? name);
                        count += result.count;
                    }
                    if (!count) continue;
                    if (apply) await resource.update(record.id, changed, { principal, expectedRevision: record.rev as number });
                    this.matches.push({ id: record.id, title: recordTitle(record, 'title'), href: `/dashboard/content/${collection}/${record.id}`, fields: touched, count });
                }
                if (page.records.length < 100) break;
            }
            this.previewed = !apply;
            const total = this.matches.reduce((sum, match) => sum + match.count, 0);
            if (apply) this.message = this.matches.length ? `${__('Replaced')} ${total} ${__('occurrence(s) in')} ${this.matches.length} ${__('entry(ies)')}.` : __('Nothing matched, so nothing changed.');
        } catch (error) {
            this.error = isCmsError(error) ? error.message : __('The scan failed.');
        }
    }

    render() {
        const total = this.matches.reduce((sum, match) => sum + match.count, 0);
        return html`<div class="space-y-6">
            ${pageHeader(__('Find and replace'), { description: __('Change a word or phrase across a collection. Preview first; every changed entry keeps a revision.') })}
            ${this.message ? notice(this.message, 'success') : null}
            ${this.error ? notice(this.error, 'error') : null}
            ${component(Card, {}, component(CardBody, {}, html`<form class="grid gap-4 md:grid-cols-[12rem_1fr_1fr]" @submit=${(event: Event) => this.submit(event, false)}>
                ${component(Field, { label: __('Collection'), for: 'replace-collection', control: attributes => component(NativeSelect, { ...attributes, '@change': (event: Event) => { this.collection = (event.target as HTMLSelectElement).value; } }, html`
                    ${this.collections.map(collection => html`<option value=${collection.name} ?selected=${collection.name === this.collection}>${collection.label}</option>`)}`) })}
                ${component(Field, { label: __('Find'), for: 'replace-find', control: attributes => component(Input, { ...attributes, required: true, maxlength: 200, '.value': this.find, '@input': (event: Event) => { this.find = (event.target as HTMLInputElement).value; } }) })}
                ${component(Field, { label: __('Replace with'), for: 'replace-with', control: attributes => component(Input, { ...attributes, maxlength: 2000, '.value': this.replace, '@input': (event: Event) => { this.replace = (event.target as HTMLInputElement).value; } }) })}
                <div class="md:col-span-3">${component(Checkbox, { label: __('Match case'), checked: this.matchCase, '@change': (event: Event) => { this.matchCase = (event.target as HTMLInputElement).checked; } })}</div>
                <div class="flex flex-wrap gap-2 md:col-span-3">
                    ${component(Button, { type: 'submit', variant: 'outline' }, __('Preview'))}
                    ${component(Button, { type: 'button', variant: 'destructive', disabled: !this.previewed || !this.matches.length, '@click': (event: Event) => this.submit(event, true) }, __('Replace in every matching entry'))}
                </div>
            </form>`))}
            ${this.previewed || this.message ? component(Card, {}, html`${component(CardHeader, {}, html`<h2 class="text-base font-semibold text-foreground">${this.previewed ? __('Would change') : __('Changed')} ${this.matches.length} ${__('of')} ${this.scanned} ${__('entries')} · ${total} ${__('occurrence(s)')}</h2>`)}
                ${component(CardBody, { class: 'p-0' }, this.matches.length ? html`<ul class="divide-y divide-border" data-testid="replace-matches">${this.matches.map(match => html`<li class="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
                    <a href=${match.href} class="font-medium text-foreground hover:underline">${match.title}</a><span class="text-xs text-muted-foreground">${match.count} × ${__('in')} ${match.fields.join(', ')}</span></li>`)}</ul>`
                    : html`<p class="px-4 py-6 text-sm text-muted-foreground">${__('No entry contains the text.')}</p>`)}`) : null}
        </div>`;
    }
}

function replaceInText(value: string, pattern: RegExp, replacement: string): { value: string; count: number } {
    let count = 0;
    const next = value.replace(pattern, () => { count++; return replacement; });
    return { value: next, count };
}

function replaceInDoc(doc: RichTextDoc | null, pattern: RegExp, replacement: string): { value: RichTextDoc; count: number } | null {
    if (!doc || !Array.isArray(doc.content)) return null;
    let count = 0;
    const visit = (node: RichTextNode): RichTextNode => {
        if (node.type === 'text' && typeof node.text === 'string') {
            const result = replaceInText(node.text, pattern, replacement);
            count += result.count;
            return result.count && result.value ? { ...node, text: result.value } : node;
        }
        return node.content ? { ...node, content: node.content.map(visit) } : node;
    };
    const content = doc.content.map(visit);
    return { value: { ...doc, content }, count };
}

function replaceInBlocks(blocks: Block[] | null, pattern: RegExp, replacement: string): { value: Block[]; count: number } | null {
    if (!Array.isArray(blocks)) return null;
    let count = 0;
    const visit = (block: Block): Block => {
        const data: Record<string, unknown> = { ...block.data };
        for (const [name, value] of Object.entries(data)) {
            if (typeof value === 'string' && !/^[A-Za-z0-9_-]{16,}$/.test(value)) {
                const result = replaceInText(value, pattern, replacement);
                if (result.count) { data[name] = result.value; count += result.count; }
            } else if (value && typeof value === 'object' && !Array.isArray(value) && 'type' in (value as object) && (value as RichTextDoc).type === 'doc') {
                const result = replaceInDoc(value as RichTextDoc, pattern, replacement);
                if (result?.count) { data[name] = result.value; count += result.count; }
            }
        }
        return { ...block, data, ...(block.children ? { children: block.children.map(visit) } : {}) };
    };
    return { value: blocks.map(visit), count };
}
