import { describe, expect, it } from 'vitest';
import {
    blockedCrawlerGroups, blockLayoutProblem, blocksMarkdown, blockStyleAttributes, collectionProblems, collectionSeoProblems, crawlerOf, entryChecks, entryMarkdown, extendCollection, field, posts, renderSeoTemplate, richTextMarkdown, robotsDirectives, robotsTxtLines, schemaGraph, schemaProperties, taxonomyProblems, urlList,
    CORE_BLOCKS, CRAWLER_GROUPS, SCHEMA_PROPERTIES, SCHEMA_TYPES,
    type Block, type SchemaSite,
} from '../src/index';

const site: SchemaSite = { origin: 'https://example.com', name: 'Example', tagline: 'Just a site', locale: 'en', representation: 'organization', publisherName: 'Example Inc', logo: { url: 'https://example.com/logo.png', width: 200, height: 200 }, sameAs: ['https://x.com/example'] };

describe('SEO templates and robots', () => {
    it('renders templates and drops separators left by empty values', () => {
        const variables = { sep: '–', site: 'Example', tagline: 'Just a site', title: 'Hello' };
        expect(renderSeoTemplate('%title% %sep% %site%', variables)).toBe('Hello – Example');
        expect(renderSeoTemplate('%title% %sep% %site%', { ...variables, site: '' })).toBe('Hello');
        expect(renderSeoTemplate('%excerpt%', variables)).toBe('');
        expect(renderSeoTemplate('%site% %sep% %tagline%', variables)).toBe('Example – Just a site');
        // Page numbers are appended from the second page on, unless the template places them.
        expect(renderSeoTemplate('%title% %sep% %site%', { ...variables, page: 3 })).toBe('Hello – Example – Page 3');
        expect(renderSeoTemplate('%title% (%page%) %sep% %site%', { ...variables, page: 2 })).toBe('Hello (2) – Example');
        expect(renderSeoTemplate('%title% (%page%) %sep% %site%', { ...variables, page: 1 })).toBe('Hello () – Example');
        expect(renderSeoTemplate('%unknown% %title%', variables)).toBe('Hello');
        expect(renderSeoTemplate('%term% %sep% %site%', { ...variables, term: 'News', sep: '|' })).toBe('News | Example');
    });

    it('builds robots directives', () => {
        expect(robotsDirectives({})).toBe('');
        expect(robotsDirectives({ maxImagePreview: 'large' })).toBe('max-image-preview:large');
        expect(robotsDirectives({ maxImagePreview: 'standard' })).toBe('');
        expect(robotsDirectives({ hidden: true, maxImagePreview: 'large' })).toBe('noindex, nofollow');
        expect(robotsDirectives({ noindex: true, nofollow: true, maxSnippet: 160, maxImagePreview: 'large' })).toBe('noindex, nofollow, max-snippet:160, max-image-preview:large');
        expect(robotsDirectives({ nosnippet: true, maxSnippet: 160, noarchive: true })).toBe('nosnippet, noarchive');
        expect(robotsDirectives({ maxSnippet: -1 })).toBe('');
        expect(robotsDirectives({ maxSnippet: 0 })).toBe('max-snippet:0');
    });

    it('validates collection schema, robots and templates', () => {
        expect(collectionSeoProblems({})).toEqual([]);
        expect(collectionSeoProblems({ schema: { type: 'Product', map: { price: 'price' } }, fields: ['price'] })).toEqual([]);
        expect(collectionSeoProblems({ schema: { type: 'Thing' } })).toEqual([expect.stringContaining('one of')]);
        expect(collectionSeoProblems({ schema: { type: 'Product', map: { color: 'color' } } })).toEqual(['Product has no property color to map.']);
        expect(collectionSeoProblems({ schema: { type: 'Product', map: { price: 'cost' } }, fields: ['price'] })).toEqual(['Property price maps to cost, which is not a field.']);
        expect(collectionSeoProblems({ robots: { noindex: 'yes' } })).toEqual([expect.stringContaining('Robots')]);
        expect(collectionSeoProblems({ seoTemplates: { title: 'x'.repeat(301) } })).toEqual([expect.stringContaining('SEO templates')]);
        expect(collectionProblems({ ...posts, schema: { type: 'nope' as never } })).toEqual([expect.stringContaining('structured data type')]);
        // Built-in collections take the administrator's schema and robots.
        expect(extendCollection(posts, { schema: { type: 'NewsArticle' }, robots: { archiveNoindex: true } })).toMatchObject({ schema: { type: 'NewsArticle' }, robots: { archiveNoindex: true } });
        expect(posts.schema).toEqual({ type: 'BlogPosting' });
        expect(taxonomyProblems({ name: 'tags', label: 'Tags', singular: 'Tag', hierarchical: false, noindex: 'x' as never })).toEqual(['Noindex is on or off.']);
        for (const type of SCHEMA_TYPES) expect(Array.isArray(SCHEMA_PROPERTIES[type])).toBe(true);
    });

    it('reads URL lists', () => {
        expect(urlList('https://a.example\nnot a url\n https://b.example ')).toEqual(['https://a.example', 'https://b.example']);
        expect(urlList(['https://a.example', 'ftp://x', 3])).toEqual(['https://a.example']);
        expect(urlList(null)).toEqual([]);
    });
});

describe('structured data graph', () => {
    it('links an article to its page, author and publisher', () => {
        const graph = schemaGraph(site, {
            kind: 'entry', url: 'https://example.com/posts/hello', title: 'Hello', description: 'A post', locale: 'en', type: 'BlogPosting',
            image: { url: 'https://example.com/media/1/a.jpg', width: 1200, height: 630, alt: 'A' }, published: '2026-10-01T00:00:00.000Z', modified: '2026-10-02T00:00:00.000Z',
            breadcrumbs: [{ name: 'Home', url: 'https://example.com/' }, { name: 'Posts', url: 'https://example.com/posts' }],
            author: { name: 'Ada', url: 'https://example.com/author/ada', description: 'Writes', jobTitle: 'Editor', website: 'https://ada.example', sameAs: ['https://x.com/ada'] },
            keywords: ['news'], section: 'News', about: [{ name: 'News', sameAs: 'https://www.wikidata.org/wiki/Q38926' }],
        });
        const nodes = graph['@graph'];
        const byType = (type: string) => nodes.find(node => node['@type'] === type)!;
        expect(graph['@context']).toBe('https://schema.org');
        expect(byType('Organization')).toMatchObject({ '@id': 'https://example.com/#organization', name: 'Example Inc', logo: { '@id': 'https://example.com/#logo' }, sameAs: ['https://x.com/example'] });
        expect(byType('WebSite')).toMatchObject({ '@id': 'https://example.com/#website', publisher: { '@id': 'https://example.com/#organization' } });
        expect(byType('WebPage')).toMatchObject({ '@id': 'https://example.com/posts/hello#webpage', isPartOf: { '@id': 'https://example.com/#website' }, primaryImageOfPage: { '@id': 'https://example.com/posts/hello#primaryimage' }, breadcrumb: { '@id': 'https://example.com/posts/hello#breadcrumb' } });
        expect(byType('WebPage')).not.toHaveProperty('mainEntity');
        expect(byType('BreadcrumbList').itemListElement).toEqual([
            { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://example.com/' }, { '@type': 'ListItem', position: 2, name: 'Posts', item: 'https://example.com/posts' }, { '@type': 'ListItem', position: 3, name: 'Hello' },
        ]);
        expect(byType('BlogPosting')).toMatchObject({
            '@id': 'https://example.com/posts/hello#article', headline: 'Hello', author: { '@id': 'https://example.com/author/ada#person' }, publisher: { '@id': 'https://example.com/#organization' },
            mainEntityOfPage: { '@id': 'https://example.com/posts/hello#webpage' }, datePublished: '2026-10-01T00:00:00.000Z', keywords: ['news'], articleSection: 'News', about: [{ '@type': 'Thing', name: 'News', sameAs: 'https://www.wikidata.org/wiki/Q38926' }],
        });
        expect(byType('Person')).toMatchObject({ '@id': 'https://example.com/author/ada#person', name: 'Ada', url: 'https://example.com/author/ada', jobTitle: 'Editor', sameAs: ['https://ada.example', 'https://x.com/ada'] });
        expect(nodes.filter(node => node['@type'] === 'ImageObject')).toHaveLength(2);
        // No author page: the author node hangs off the entry.
        const anonymous = schemaGraph({ ...site, representation: 'person', logo: null }, { kind: 'entry', url: 'https://example.com/p', title: 'P', description: '', locale: 'en', type: 'Article', author: { name: 'Bob', url: null } });
        expect(anonymous['@graph'].find(node => node['@type'] === 'Article')).toMatchObject({ author: { '@id': 'https://example.com/p#author' }, publisher: { '@id': 'https://example.com/#person' } });
        expect(anonymous['@graph'].filter(node => node['@type'] === 'Person').map(node => node['@id'])).toEqual(['https://example.com/#person', 'https://example.com/p#author']);
    });

    it('emits typed entities, profile pages and nothing for none', () => {
        const product = schemaGraph(site, { kind: 'entry', url: 'https://example.com/shop/skates', title: 'Skates', description: 'Fast', locale: 'en', type: 'Product', properties: { sku: 'SK-1', offers: { '@type': 'Offer', price: 99 } } });
        expect(product['@graph'].find(node => node['@type'] === 'WebPage')).toMatchObject({ mainEntity: { '@id': 'https://example.com/shop/skates#product' } });
        expect(product['@graph'].find(node => node['@type'] === 'Product')).toMatchObject({ name: 'Skates', sku: 'SK-1', offers: { price: 99 }, mainEntityOfPage: { '@id': 'https://example.com/shop/skates#webpage' } });
        const none = schemaGraph(site, { kind: 'entry', url: 'https://example.com/x', title: 'X', description: '', locale: 'en', type: 'none' });
        expect(none['@graph'].map(node => node['@type'])).toEqual(['Organization', 'ImageObject', 'WebSite']);
        const author = schemaGraph(site, { kind: 'author', url: 'https://example.com/author/ada', title: 'Ada', description: 'Writes', locale: 'en', profile: { name: 'Ada', url: 'https://example.com/author/ada' } });
        expect(author['@graph'].find(node => node['@type'] === 'ProfilePage')).toMatchObject({ mainEntity: { '@id': 'https://example.com/author/ada#person' } });
        expect(author['@graph'].find(node => node['@type'] === 'Person' && node.name === 'Ada')).toMatchObject({ '@id': 'https://example.com/author/ada#person' });
        const list = schemaGraph(site, { kind: 'term', url: 'https://example.com/category/news', title: 'News', description: '', locale: 'en' });
        expect(list['@graph'].map(node => node['@type'])).toContain('CollectionPage');
        const home = schemaGraph(site, { kind: 'home', url: 'https://example.com/', title: 'Example', description: 'Just a site', locale: 'en' });
        expect(home['@graph'].find(node => node['@type'] === 'WebPage')).toMatchObject({ about: { '@id': 'https://example.com/#organization' } });
        expect(JSON.stringify(home)).not.toContain('SearchAction');
    });

    it('shapes mapped properties', () => {
        const fields = { price: field.number(), currency: field.string(), stock: field.boolean(), photo: field.media(), starts: field.datetime(), prep: field.integer(), steps: field.text(), tags: field.list('string'), lat: field.number(), lng: field.number(), venue: field.string() };
        const record = { price: 12.5, currency: 'EUR', stock: true, photo: 'f1', starts: Date.UTC(2026, 0, 2), prep: 15, steps: 'Mix\nBake\n', tags: ['a', 'b'], lat: 1.5, lng: 2.5, venue: 'Hall' };
        const resolve = { mediaUrl: (id: string) => id === 'f1' ? 'https://example.com/media/f1/a.jpg' : null };
        expect(schemaProperties({ type: 'Product', map: { price: 'price', priceCurrency: 'currency', availability: 'stock', sku: 'missing' } }, record, fields, resolve))
            .toEqual({ offers: { '@type': 'Offer', price: 12.5, priceCurrency: 'EUR', availability: 'https://schema.org/InStock' } });
        expect(schemaProperties({ type: 'Event', map: { startDate: 'starts', locationName: 'venue', price: 'price', priceCurrency: 'currency' } }, record, fields, resolve))
            .toEqual({ startDate: '2026-01-02T00:00:00.000Z', location: { '@type': 'Place', name: 'Hall' }, offers: { '@type': 'Offer', price: 12.5, priceCurrency: 'EUR' } });
        expect(schemaProperties({ type: 'Recipe', map: { prepTime: 'prep', recipeInstructions: 'steps', recipeIngredient: 'tags' } }, record, fields, resolve))
            .toEqual({ prepTime: 'PT15M', recipeInstructions: [{ '@type': 'HowToStep', text: 'Mix' }, { '@type': 'HowToStep', text: 'Bake' }], recipeIngredient: ['a', 'b'] });
        expect(schemaProperties({ type: 'LocalBusiness', map: { latitude: 'lat', longitude: 'lng' } }, record, fields, resolve)).toEqual({ geo: { '@type': 'GeoCoordinates', latitude: 1.5, longitude: 2.5 } });
        expect(schemaProperties({ type: 'VideoObject', map: { thumbnailUrl: 'photo', duration: 'prep' } }, record, fields, resolve)).toEqual({ thumbnailUrl: 'https://example.com/media/f1/a.jpg', duration: 'PT15S' });
        // Properties the type does not have are ignored.
        expect(schemaProperties({ type: 'Article', map: { price: 'price' } }, record, fields, resolve)).toEqual({});
    });
});

describe('crawlers, robots.txt and Markdown output', () => {
    it('renders robots.txt from the crawler settings', () => {
        const open = { allowSearch: true, allowAiSearch: true, allowAiTraining: true, contentSignals: false };
        expect(robotsTxtLines({ hidden: true, crawlers: open, extra: 'x', sitemapUrl: 'https://e.com/sitemap.xml' })).toEqual(['User-agent: *', 'Disallow: /']);
        const lines = robotsTxtLines({ hidden: false, crawlers: open, extra: ' Disallow: /tmp/ ', sitemapUrl: 'https://e.com/sitemap.xml' });
        expect(lines[0]).toBe('User-agent: *');
        expect(lines).toContain('Disallow: /dashboard/');
        expect(lines).toContain('Disallow: /indexnow/');
        expect(lines.slice(-3)).toEqual(['Disallow: /tmp/', '', 'Sitemap: https://e.com/sitemap.xml']);
        expect(lines.join('\n')).not.toContain('GPTBot');
        const blocked = robotsTxtLines({ hidden: false, crawlers: { ...open, allowAiTraining: false, contentSignals: true }, extra: '', sitemapUrl: 'https://e.com/sitemap.xml' }).join('\n');
        expect(blocked).toContain('Content-Signal: search=yes, ai-input=yes, ai-train=no');
        expect(blocked).toMatch(/# AI training\nUser-agent: GPTBot\n(?:User-agent: [^\n]+\n)+Disallow: \//);
        expect(blocked).not.toContain('User-agent: OAI-SearchBot');
        expect(blockedCrawlerGroups({ ...open, allowSearch: false, allowAiSearch: false }).map(group => group.id)).toEqual(['search', 'aiSearch']);
        // Fetchers acting for a person cannot be blocked.
        expect(CRAWLER_GROUPS.find(group => group.id === 'fetchers')!.blockable).toBe(false);
        expect(blockLayoutProblem({ nosnippet: true })).toBeUndefined();
        expect(blockLayoutProblem({ nosnippet: 'yes' })).toContain('nosnippet');
        expect(blockStyleAttributes({ layout: { nosnippet: true } })).toMatchObject({ nosnippet: true, className: 'cms-block' });
    });

    it('turns rich text and blocks into Markdown', () => {
        const doc = {
            type: 'doc' as const, content: [
                { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Why' }] },
                { type: 'paragraph', content: [{ type: 'text', text: 'Bold', marks: [{ type: 'bold' }] }, { type: 'text', text: ' and ' }, { type: 'text', text: 'a link', marks: [{ type: 'link', attrs: { href: 'https://e.com' } }] }, { type: 'text', text: ' with *stars*' }] },
                { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }] }, { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'two' }] }] }] },
                { type: 'orderedList', attrs: { start: 3 }, content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'three' }] }] }] },
                { type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'quoted' }] }] },
                { type: 'codeBlock', attrs: { language: 'ts' }, content: [{ type: 'text', text: 'let x = 1;' }] },
                { type: 'image', attrs: { mediaId: 'f1', alt: 'A cat' } },
                { type: 'paragraph', content: [{ type: 'text', text: 'x.y', marks: [{ type: 'code' }] }] },
            ],
        };
        expect(richTextMarkdown(doc, { media: id => id === 'f1' ? 'https://e.com/media/f1/cat.jpg' : null })).toBe([
            '## Why', '**Bold** and [a link](https://e.com) with \\*stars\\*', '- one\n- two', '3. three', '> quoted', '```ts\nlet x = 1;\n```', '![A cat](https://e.com/media/f1/cat.jpg)', '`x.y`',
        ].join('\n\n'));
        const types = new Map(CORE_BLOCKS.map(block => [block.name, block]));
        const blocks: Block[] = [
            { _id: 'a', type: 'core/heading', data: { text: 'Steps', level: 'h3' } },
            { _id: 'b', type: 'core/paragraph', data: { text: 'First *one*.' } },
            { _id: 'c', type: 'core/list', data: { items: ['x', 'y'], ordered: true } },
            { _id: 'd', type: 'core/quote', data: { text: 'Said', citation: 'Ada' } },
            { _id: 'e', type: 'core/image', data: { image: 'f1', caption: 'Cap' } },
            { _id: 'f', type: 'core/group', data: {}, children: [{ _id: 'g', type: 'core/paragraph', data: { text: 'Inside' } }] },
            { _id: 'h', type: 'core/meta', data: { entries: [] } },
            { _id: 'i', type: 'core/richtext', data: { text: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Rich' }] }] } } },
        ];
        expect(blocksMarkdown(blocks, types, { media: id => id === 'f1' ? 'https://e.com/f1.jpg' : null, mediaAlt: () => 'Alt' })).toBe([
            '### Steps', 'First *one*.', '1. x\n2. y', '> Said\n>\n> — Ada', '![Alt](https://e.com/f1.jpg)\n\n*Cap*', 'Inside', 'Rich',
        ].join('\n\n'));
        const document = entryMarkdown({ title: 'Hello', url: 'https://e.com/posts/hello', site: 'E', description: 'A "quoted" summary', author: 'Ada', published: '2026-10-01T00:00:00.000Z', updated: '2026-10-02T00:00:00.000Z', terms: [{ label: 'Categories', terms: ['News'] }, { label: 'Tags', terms: [] }], body: 'Body.' });
        expect(document).toBe('---\ntitle: "Hello"\nurl: "https://e.com/posts/hello"\nsite: "E"\ndescription: "A \\"quoted\\" summary"\nauthor: "Ada"\npublished: 2026-10-01T00:00:00.000Z\nupdated: 2026-10-02T00:00:00.000Z\ncategories: ["News"]\n---\n\n# Hello\n\nA "quoted" summary\n\nBody.\n');
    });
});

describe('editorial checks and answer blocks', () => {
    const types = new Map(CORE_BLOCKS.map(block => [block.name, block]));
    const paragraph = (text: string, id = 'p'): Block => ({ _id: id, type: 'core/paragraph', data: { text } });
    const heading = (text: string, level = 'h2', id = 'h'): Block => ({ _id: id, type: 'core/heading', data: { text, level } });

    it('reports titles, descriptions, summaries, headings, sources and links', () => {
        const empty = entryChecks({ title: '', blocks: [], types });
        expect(empty.map(check => [check.id, check.status])).toEqual([['title', 'warn'], ['description', 'info'], ['summary', 'warn'], ['content', 'info']]);
        const long = 'word '.repeat(70).trim();
        const checks = entryChecks({
            title: 'A title that goes on and on well past the sixty characters results show', description: 'Short', summary: 'An answer. In two sentences.',
            blocks: [heading('Why does this matter?'), paragraph(long), heading('Details', 'h4', 'h2'), paragraph('See [the study](https://research.example/paper) and [our guide](/guides/one).', 'p2'), { _id: 'c', type: 'core/claim', data: { text: '42% of sites', kind: 'statistic', sourceName: 'Study', sourceUrl: 'https://research.example/paper' } }],
            types, host: 'example.com',
        });
        const byId = Object.fromEntries(checks.map(check => [check.id, check]));
        expect(byId.title).toMatchObject({ status: 'warn' });
        expect(byId.description).toMatchObject({ status: 'info', message: expect.stringContaining('short') });
        expect(byId.summary).toMatchObject({ status: 'ok' });
        expect(byId.first).toMatchObject({ status: 'info', message: expect.stringContaining('opens with a heading') });
        expect(byId.headings).toMatchObject({ status: 'warn', message: expect.stringContaining('skips a level') });
        expect(byId.questions).toMatchObject({ status: 'ok' });
        expect(byId.sources).toMatchObject({ status: 'ok' });
        expect(byId.internal).toMatchObject({ status: 'ok', message: '1 internal link.' });
        // A page (not an article) is not asked for a summary, questions or sources.
        const page = entryChecks({ title: 'Contact', blocks: [paragraph('Write to us.')], types, article: false });
        expect(page.map(check => check.id)).toEqual(['title', 'description', 'first', 'internal', 'length']);
        // Rich text counts too.
        const rich: Block = { _id: 'r', type: 'core/richtext', data: { text: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Direct answer here.' }, { type: 'text', text: 'link', marks: [{ type: 'link', attrs: { href: 'https://example.com/other' } }] }] }, { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Big' }] }] } } };
        const richChecks = Object.fromEntries(entryChecks({ title: 'T', summary: 'S. S.', blocks: [rich], types, host: 'example.com' }).map(check => [check.id, check]));
        expect(richChecks.first).toMatchObject({ status: 'ok' });
        expect(richChecks.headings).toMatchObject({ status: 'warn', message: expect.stringContaining('H1') });
        expect(richChecks.internal).toMatchObject({ status: 'ok' });
    });

    it('declares the answer blocks and renders them as Markdown', () => {
        for (const name of ['core/answer', 'core/faq', 'core/faq-item', 'core/steps', 'core/step', 'core/claim', 'core/definition']) expect(types.has(name), name).toBe(true);
        expect(types.get('core/faq')!.children).toEqual({ allowed: ['core/faq-item'], max: 50 });
        expect(types.get('core/faq-item')!.parent).toEqual(['core/faq']);
        const blocks: Block[] = [
            { _id: 'a', type: 'core/answer', data: { text: 'Yes, in short.', label: 'Quick answer' } },
            { _id: 'f', type: 'core/faq', data: { schema: true }, children: [{ _id: 'f1', type: 'core/faq-item', data: { question: 'Why?', answer: 'Because.' } }] },
            { _id: 's', type: 'core/steps', data: {}, children: [{ _id: 's1', type: 'core/step', data: { title: 'Mix', text: 'Stir well.' } }] },
            { _id: 'c', type: 'core/claim', data: { text: '42%', kind: 'statistic', sourceName: 'Study', sourceUrl: 'https://r.example', date: '2026' } },
            { _id: 'd', type: 'core/definition', data: { term: 'GEO', definition: 'Being cited by generative engines.' } },
        ];
        expect(blocksMarkdown(blocks, types)).toBe(['**Quick answer** Yes, in short.', '### Why?\n\nBecause.', '### Mix\n\nStir well.', '> 42%\n>\n> — [Study](https://r.example), 2026', '**GEO**: Being cited by generative engines.'].join('\n\n'));
        const graph = schemaGraph(site, { kind: 'entry', url: 'https://example.com/p', title: 'P', description: 'D', locale: 'en', type: 'Article', abstract: 'In short.', faq: [{ question: 'Why?', answer: 'Because.' }] });
        expect(graph['@graph'].find(node => node['@type'] === 'Article')).toMatchObject({ abstract: 'In short.' });
        expect(graph['@graph'].find(node => node['@type'] === 'FAQPage')).toMatchObject({ mainEntity: [{ '@type': 'Question', name: 'Why?', acceptedAnswer: { '@type': 'Answer', text: 'Because.' } }] });
    });
});

describe('crawler classification', () => {
    it('names known crawlers and ignores browsers', () => {
        expect(crawlerOf('Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)')).toEqual({ agent: 'GPTBot', group: 'aiTraining' });
        expect(crawlerOf('Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot)')).toEqual({ agent: 'OAI-SearchBot', group: 'aiSearch' });
        expect(crawlerOf('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)')).toEqual({ agent: 'Googlebot', group: 'search' });
        expect(crawlerOf('Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)')).toEqual({ agent: 'Bingbot', group: 'search' });
        expect(crawlerOf('Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot')).toEqual({ agent: 'ChatGPT-User', group: 'fetchers' });
        expect(crawlerOf('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36')).toBeNull();
        expect(crawlerOf('')).toBeNull();
    });
});
