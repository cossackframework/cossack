import { describe, expect, it } from 'vitest';
import { contentBlocks, importWxr, parseWxr } from '../src/cms/import-wxr.js';

const WXR = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:excerpt="http://wordpress.org/export/1.2/excerpt/" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:wp="http://wordpress.org/export/1.2/">
<channel>
  <title>Old Blog</title>
  <link>https://old.example.com</link>
  <wp:author><wp:author_login><![CDATA[ada]]></wp:author_login><wp:author_email><![CDATA[ada@example.com]]></wp:author_email><wp:author_display_name><![CDATA[Ada]]></wp:author_display_name></wp:author>
  <wp:category><wp:term_id>3</wp:term_id><wp:category_nicename><![CDATA[news]]></wp:category_nicename><wp:category_parent><![CDATA[]]></wp:category_parent><wp:cat_name><![CDATA[News &amp; Notes]]></wp:cat_name></wp:category>
  <wp:category><wp:term_id>4</wp:term_id><wp:category_nicename><![CDATA[releases]]></wp:category_nicename><wp:category_parent><![CDATA[news]]></wp:category_parent><wp:cat_name><![CDATA[Releases]]></wp:cat_name></wp:category>
  <wp:tag><wp:term_id>7</wp:term_id><wp:tag_slug><![CDATA[cms]]></wp:tag_slug><wp:tag_name><![CDATA[CMS]]></wp:tag_name></wp:tag>
  <item>
    <title>Hello again</title>
    <link>https://old.example.com/2024/05/hello-again/</link>
    <wp:post_date_gmt><![CDATA[2024-05-01 10:00:00]]></wp:post_date_gmt>
    <content:encoded><![CDATA[<!-- wp:paragraph --><p>Back with <strong>news</strong>.</p><!-- /wp:paragraph -->]]></content:encoded>
    <excerpt:encoded><![CDATA[<p>Short.</p>]]></excerpt:encoded>
    <wp:post_name><![CDATA[hello-again]]></wp:post_name>
    <wp:status><![CDATA[publish]]></wp:status>
    <wp:post_type><![CDATA[post]]></wp:post_type>
    <category domain="category" nicename="releases"><![CDATA[Releases]]></category>
    <category domain="post_tag" nicename="cms"><![CDATA[CMS]]></category>
  </item>
  <item>
    <title>About</title>
    <link>https://old.example.com/about/</link>
    <wp:post_date_gmt><![CDATA[2024-01-01 00:00:00]]></wp:post_date_gmt>
    <content:encoded><![CDATA[Just text.

Two paragraphs.]]></content:encoded>
    <wp:post_name><![CDATA[about]]></wp:post_name>
    <wp:status><![CDATA[draft]]></wp:status>
    <wp:post_type><![CDATA[page]]></wp:post_type>
    <wp:menu_order>2</wp:menu_order>
  </item>
  <item>
    <title>logo.png</title>
    <wp:post_type><![CDATA[attachment]]></wp:post_type>
    <wp:status><![CDATA[inherit]]></wp:status>
    <wp:attachment_url><![CDATA[https://old.example.com/wp-content/uploads/logo.png]]></wp:attachment_url>
  </item>
</channel>
</rss>`;

describe('WordPress import', () => {
  it('parses terms, items and their fields', () => {
    const data = parseWxr(WXR);
    expect(data.title).toBe('Old Blog');
    expect(data.categories).toEqual([{ slug: 'news', name: 'News & Notes', parent: null, description: '' }, { slug: 'releases', name: 'Releases', parent: 'news', description: '' }]);
    expect(data.tags).toEqual([{ slug: 'cms', name: 'CMS', parent: null, description: '' }]);
    expect(data.items.map(item => [item.type, item.slug, item.status])).toEqual([['post', 'hello-again', 'publish'], ['page', 'about', 'draft'], ['attachment', '', 'inherit']]);
    expect(data.items[0]).toMatchObject({ date: Date.UTC(2024, 4, 1, 10), categories: ['releases'], tags: ['cms'], link: 'https://old.example.com/2024/05/hello-again/' });
    expect(() => parseWxr('<html></html>')).toThrow(/WordPress export/);
  });

  it('turns markup into a Custom HTML block and plain text into paragraphs', () => {
    expect(contentBlocks('<!-- wp:paragraph --><p>Hi</p><!-- /wp:paragraph -->')).toEqual([{ _id: 'html', type: 'core/html', data: { html: '<p>Hi</p>' } }]);
    expect(contentBlocks('One.\n\nTwo.')).toEqual([{ _id: 'p1', type: 'core/paragraph', data: { text: 'One.' } }, { _id: 'p2', type: 'core/paragraph', data: { text: 'Two.' } }]);
    expect(contentBlocks('  ')).toEqual([]);
  });

  it('creates terms (parents first), entries and redirects through the API, and reports the rest', async () => {
    const calls = [];
    const request = async (method, path, body) => {
      calls.push([method, path, body]);
      if (path === '/api/cms/collections') return { items: [{ name: 'posts', taxonomies: ['categories', 'tags'] }, { name: 'pages', taxonomies: [] }] };
      if (method === 'POST' && path.startsWith('/api/cms/terms/')) return { id: `${path.split('/')[4]}-${body.slug}` };
      if (path.startsWith('/api/cms/terms/categories?')) return { items: [{ id: 'cat-news', slug: 'news' }] };
      if (path.startsWith('/api/cms/terms/')) return { items: [] };
      if (method === 'POST' && path === '/api/cms/content/posts') return { item: { id: 'e1', url: '/posts/hello-again' } };
      if (method === 'POST' && path === '/api/cms/content/pages') return { item: { id: 'e2', url: '/about' } };
      if (method === 'POST' && path === '/api/cms/redirects') return { item: { id: 'r1' } };
      throw new Error(`unexpected ${method} ${path}`);
    };
    const report = await importWxr(parseWxr(WXR), request);
    expect(report).toMatchObject({ terms: 2, entries: 2, redirects: 1 });
    expect(report.skipped).toEqual(['1 attachment(s): media is not imported; upload the files and update the links']);
    const posts = calls.filter(([method, path]) => method === 'POST' && path.startsWith('/api/cms/terms/'));
    expect(posts.map(([, path, body]) => [path, body.slug, body.parent])).toEqual([['/api/cms/terms/categories', 'releases', 'cat-news'], ['/api/cms/terms/tags', 'cms', undefined]]);
    const [, , post] = calls.find(([method, path]) => method === 'POST' && path === '/api/cms/content/posts');
    expect(post).toMatchObject({ title: 'Hello again', slug: 'hello-again', status: 'published', publishedAt: Date.UTC(2024, 4, 1, 10), categories: ['categories-releases'], tags: ['tags-cms'], excerpt: 'Short.' });
    expect(post.content).toEqual([{ _id: 'html', type: 'core/html', data: { html: '<p>Back with <strong>news</strong>.</p>' } }]);
    const [, , page] = calls.find(([method, path]) => method === 'POST' && path === '/api/cms/content/pages');
    expect(page).toMatchObject({ title: 'About', status: 'draft', menuOrder: 2 });
    expect(page.publishedAt).toBeUndefined();
    expect(calls.find(([method, path]) => method === 'POST' && path === '/api/cms/redirects')[2]).toEqual({ source: '/2024/05/hello-again', target: '/posts/hello-again', status: 301, note: 'WordPress import' });
  });

  it('writes nothing on a dry run', async () => {
    const calls = [];
    const request = async (method, path) => {
      calls.push(method);
      if (path === '/api/cms/collections') return { items: [{ name: 'posts', taxonomies: ['categories', 'tags'] }, { name: 'pages' }] };
      return { items: [] };
    };
    const report = await importWxr(parseWxr(WXR), request, { dryRun: true });
    expect(report).toMatchObject({ dryRun: true, terms: 3, entries: 2 });
    expect(calls.filter(method => method !== 'GET')).toEqual([]);
  });
});
