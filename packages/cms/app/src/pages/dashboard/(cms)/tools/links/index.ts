import { Cossack, Page, State, type HeadValue } from '@cossackframework/core';
import { Badge, Card, CardBody, CardHeader } from '@cossackframework/ui';
import { html, component } from '@cossackframework/renderer';
import { ANONYMOUS, isCmsError, PERMISSIONS, recordTitle, type Block, type FieldFilter, type RecordShape, type RichTextDoc, type RichTextNode } from '@cossackframework/cms';
import { requireAny } from '../../../../../cms/guards';
import { notice, pageHeader } from '../../../../../cms/ui';

interface LinkedEntry { id: string; title: string; url: string; collection: string; edit: string; inbound: number; outbound: number; cornerstone: boolean }

const SCAN_LIMIT = 2000;

/**
 * Internal links across the site's published entries: which entries nothing links to
 * (orphans), which cornerstone entries have few links, and the most linked. Read on request
 * from the entries' content; sites with more than 2,000 entries are sampled.
 */
@Page({ transport: 'http', middlewares: [requireAny(PERMISSIONS.manageRedirects, PERMISSIONS.manageCollections)] })
export default class LinksPage extends Cossack {
    @State() entries: LinkedEntry[] = [];
    @State() scanned = 0;
    @State() sampled = false;
    @State() error = '';

    head(): HeadValue {
        return { title: __('Links') };
    }

    async init() {
        const cms = this.c.get('cms');
        try {
            const collections = cms.collections().filter(collection => typeof collection.path === 'string' && collection.slug !== false && !collection.managed);
            const found: { record: RecordShape; collection: typeof collections[number]; url: string; links: string[] }[] = [];
            for (const collection of collections) {
                const resource = cms.resourceById(`cms/${collection.name}`);
                const repository = cms.resource(resource.id);
                const where: { [field: string]: FieldFilter } = collection.publishable === false ? {} : { status: 'published' };
                for (let offset = 0; offset < SCAN_LIMIT && found.length < SCAN_LIMIT; offset += 100) {
                    const page = await repository.list({ where, limit: 100, offset, order: { field: 'updatedAt', direction: 'desc' } }, { principal: ANONYMOUS });
                    const urls = await cms.entryUrls(collection, page.records);
                    for (const record of page.records) {
                        const url = urls.get(record.id);
                        if (!url) continue;
                        const links: string[] = [];
                        for (const [name, declaration] of Object.entries(resource.fields)) {
                            const value = record[name];
                            if (declaration.kind === 'blocks' && Array.isArray(value)) collectBlockLinks(value as Block[], links);
                            else if (declaration.kind === 'richtext' && value && typeof value === 'object') collectRichTextLinks(value as RichTextDoc, links);
                            else if (declaration.kind === 'text' && declaration.format === 'markdown' && typeof value === 'string') collectMarkdownLinks(value, links);
                        }
                        found.push({ record, collection, url, links });
                    }
                    if (page.records.length < 100) break;
                    if (offset + 100 >= SCAN_LIMIT) this.sampled = true;
                }
            }
            this.scanned = found.length;
            const byUrl = new Map(found.map(entry => [entry.url, entry]));
            const inbound = new Map<string, number>();
            for (const entry of found) {
                for (const href of new Set(entry.links.map(link => internalPath(link, this.c.req.url)).filter((path): path is string => !!path))) {
                    const target = byUrl.get(path(href));
                    if (target && target !== entry) inbound.set(target.url, (inbound.get(target.url) ?? 0) + 1);
                }
            }
            this.entries = found.map(entry => ({
                id: entry.record.id, title: recordTitle(entry.record, 'title'), url: entry.url, collection: entry.collection.singular, edit: `/dashboard/content/${entry.collection.name}/${entry.record.id}`,
                inbound: inbound.get(entry.url) ?? 0, outbound: new Set(entry.links.map(link => internalPath(link, this.c.req.url)).filter(Boolean)).size,
                cornerstone: (entry.record.seo as { cornerstone?: boolean } | null)?.cornerstone === true,
            }));
        } catch (error) {
            if (!isCmsError(error)) throw error;
            this.error = error.message;
        }
    }

    private table(rows: LinkedEntry[], empty: string) {
        if (!rows.length) return html`<p class="text-sm text-muted-foreground">${empty}</p>`;
        return html`<table class="w-full text-sm">
            <thead><tr class="text-left text-xs uppercase text-muted-foreground"><th class="py-1 pr-3 font-medium">${__('Entry')}</th><th class="py-1 pr-3 font-medium">${__('Links in')}</th><th class="py-1 font-medium">${__('Links out')}</th></tr></thead>
            <tbody>${rows.map(row => html`<tr class="border-t border-border">
                <td class="py-1.5 pr-3"><a href=${row.edit} class="text-primary hover:underline">${row.title}</a> <span class="text-xs text-muted-foreground">${row.collection}${row.cornerstone ? html` · ${component(Badge, { variant: 'secondary' }, __('Cornerstone'))}` : ''}</span>
                    <div class="truncate text-xs text-muted-foreground">${row.url}</div></td>
                <td class="py-1.5 pr-3 tabular-nums">${row.inbound}</td><td class="py-1.5 tabular-nums">${row.outbound}</td></tr>`)}</tbody></table>`;
    }

    render() {
        const orphans = this.entries.filter(entry => entry.inbound === 0).sort((a, b) => a.title.localeCompare(b.title));
        const weakCornerstones = this.entries.filter(entry => entry.cornerstone && entry.inbound < 3).sort((a, b) => a.inbound - b.inbound);
        const top = [...this.entries].sort((a, b) => b.inbound - a.inbound).slice(0, 20);
        return html`<div class="space-y-6">
            ${pageHeader(__('Links'), { description: `${__('Internal links between the site\'s entries')}: ${this.scanned} ${__('entries read')}${this.sampled ? ` (${__('the newest 2,000')})` : ''}.` })}
            ${this.error ? notice(this.error, 'error') : null}
            ${weakCornerstones.length ? component(Card, {}, html`
                ${component(CardHeader, {}, html`<h2 class="text-base font-semibold text-foreground">${__('Cornerstone entries with few links')}</h2>
                    <p class="text-sm text-muted-foreground">${__('Your most important entries should be the most linked. Link to them from related entries and from menus.')}</p>`)}
                ${component(CardBody, {}, this.table(weakCornerstones, ''))}`) : null}
            ${component(Card, {}, html`
                ${component(CardHeader, {}, html`<h2 class="text-base font-semibold text-foreground">${__('Orphaned entries')} <span class="text-sm font-normal text-muted-foreground">(${orphans.length})</span></h2>
                    <p class="text-sm text-muted-foreground">${__('No other entry links to these. Engines find them through the sitemap alone and rank them lower; add a link from a related entry.')}</p>`)}
                ${component(CardBody, {}, this.table(orphans, __('Every entry is linked from another one.')))}`)}
            ${component(Card, {}, html`
                ${component(CardHeader, {}, html`<h2 class="text-base font-semibold text-foreground">${__('Most linked')}</h2>`)}
                ${component(CardBody, {}, this.table(top, __('No entries yet.')))}`)}
        </div>`;
    }
}

/** A link's path on this site, or null for outbound and non-page links. */
function internalPath(href: string, requestUrl: string): string | null {
    if (href.startsWith('/') && !href.startsWith('//')) return href;
    try {
        const url = new URL(href);
        return url.host === new URL(requestUrl).host ? url.pathname : null;
    } catch { return null; }
}

function path(href: string): string {
    const clean = href.split(/[?#]/)[0]!;
    return clean.length > 1 ? clean.replace(/\/+$/, '') : clean;
}

function collectBlockLinks(blocks: readonly Block[], into: string[]): void {
    for (const block of blocks) {
        for (const [name, value] of Object.entries(block.data)) {
            if (typeof value === 'string' && ['url', 'link', 'sourceUrl'].includes(name)) into.push(value);
            else if (typeof value === 'string' && value.includes('](')) collectMarkdownLinks(value, into);
            else if (value && typeof value === 'object' && (value as RichTextDoc).type === 'doc') collectRichTextLinks(value as RichTextDoc, into);
        }
        if (block.children) collectBlockLinks(block.children, into);
    }
}

function collectRichTextLinks(doc: RichTextDoc, into: string[]): void {
    const visit = (nodes: readonly RichTextNode[]) => {
        for (const node of nodes) {
            for (const mark of node.marks ?? []) if (mark.type === 'link' && typeof mark.attrs?.href === 'string') into.push(mark.attrs.href);
            if (node.content) visit(node.content);
        }
    };
    visit(doc.content ?? []);
}

function collectMarkdownLinks(text: string, into: string[]): void {
    for (const match of text.matchAll(/\]\(([^)\s]+)\)/g)) into.push(match[1]!);
}
