/**
 * `cossack cms import wxr <file>`: a WordPress export (WXR) into the site through the management
 * API, as the signed-in user. Categories and tags become terms, posts and pages become entries
 * (their HTML as a Custom HTML block, or paragraphs when the content is plain text), and an old
 * permalink that differs from the new address becomes a redirect. Attachments, comments and
 * authors are reported, not imported: media stays where WordPress serves it until the files are
 * uploaded, and comments have no management endpoint yet.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createClient, resolveTarget } from './client.js';

const coded = (code, message) => Object.assign(new Error(message), { code });

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" };

/** The text of an XML element: CDATA unwrapped, entities decoded; the first match or ''. */
function tagText(xml, name) {
  const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(xml);
  return match ? decode(match[1]) : '';
}

function decode(text) {
  const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(text);
  const raw = cdata ? cdata[1] : text;
  return raw.replace(/&(amp|lt|gt|quot|apos|#39|#(\d+)|#x([0-9a-fA-F]+));/g, (whole, name, decimal, hex) =>
    decimal ? String.fromCodePoint(Number(decimal)) : hex ? String.fromCodePoint(parseInt(hex, 16)) : ENTITIES[name] ?? whole);
}

function all(xml, name) {
  return [...xml.matchAll(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'g'))].map(match => match[0]);
}

/** Parse a WXR document into terms and items; tolerant of the versions WordPress has written since 1.0. */
export function parseWxr(xml) {
  if (typeof xml !== 'string' || !/<rss[\s>]/.test(xml) || !/xmlns:wp=/.test(xml)) throw coded('COSSACK_CMS_IMPORT_INVALID', 'The file is not a WordPress export (WXR).');
  const channel = xml.replace(/<item>[\s\S]*?<\/item>/g, '');
  const categories = all(channel, 'wp:category').map(entry => ({
    slug: tagText(entry, 'wp:category_nicename'), name: tagText(entry, 'wp:cat_name') || tagText(entry, 'wp:category_nicename'),
    parent: tagText(entry, 'wp:category_parent') || null, description: tagText(entry, 'wp:category_description'),
  })).filter(entry => entry.slug);
  const tags = all(channel, 'wp:tag').map(entry => ({ slug: tagText(entry, 'wp:tag_slug'), name: tagText(entry, 'wp:tag_name') || tagText(entry, 'wp:tag_slug'), parent: null, description: tagText(entry, 'wp:tag_description') })).filter(entry => entry.slug);
  const authors = all(channel, 'wp:author').map(entry => ({ login: tagText(entry, 'wp:author_login'), email: tagText(entry, 'wp:author_email'), name: tagText(entry, 'wp:author_display_name') }));
  const items = all(xml, 'item').map(item => {
    const terms = [...item.matchAll(/<category\s+domain="([^"]+)"\s+nicename="([^"]+)"[^>]*>([\s\S]*?)<\/category>/g)];
    const date = tagText(item, 'wp:post_date_gmt') || tagText(item, 'wp:post_date');
    const parsed = date && date !== '0000-00-00 00:00:00' ? Date.parse(`${date.replace(' ', 'T')}Z`) : NaN;
    return {
      title: tagText(item, 'title'), slug: tagText(item, 'wp:post_name'), type: tagText(item, 'wp:post_type'), status: tagText(item, 'wp:status'),
      date: Number.isFinite(parsed) ? parsed : null, link: tagText(item, 'link'), content: tagText(item, 'content:encoded'), excerpt: tagText(item, 'excerpt:encoded'),
      categories: terms.filter(term => term[1] === 'category').map(term => term[2]), tags: terms.filter(term => term[1] === 'post_tag').map(term => term[2]),
      parent: tagText(item, 'wp:post_parent'), order: Number(tagText(item, 'wp:menu_order')) || 0, attachment: tagText(item, 'wp:attachment_url'),
    };
  });
  return { title: tagText(channel, 'title'), link: tagText(channel, 'link'), authors, categories, tags, items };
}

const STATUS = { publish: 'published', future: 'scheduled', draft: 'draft', 'auto-draft': 'draft', pending: 'pending', private: 'draft' };

/** WordPress HTML as blocks: block comments dropped; plain text becomes Markdown paragraphs, markup a Custom HTML block. */
export function contentBlocks(html) {
  const text = html.replace(/<!--\s*\/?wp:[^>]*-->/g, '').trim();
  if (!text) return [];
  if (!/<[a-z][\s\S]*>/i.test(text)) return text.split(/\n{2,}/).map((paragraph, index) => ({ _id: `p${index + 1}`, type: 'core/paragraph', data: { text: paragraph.trim() } })).filter(block => block.data.text);
  return [{ _id: 'html', type: 'core/html', data: { html: text } }];
}

/** The path of a permalink, or null when it is not a URL. */
function pathOf(link) {
  try { return new URL(link).pathname.replace(/\/+$/, '') || '/'; } catch { return null; }
}

/**
 * Run the import. `request(method, path, body)` is the management API; the report counts what
 * was made and lists what was skipped. With `dryRun`, nothing is written.
 */
export async function importWxr(data, request, options = {}) {
  const posts = options.posts ?? 'posts';
  const pages = options.pages ?? 'pages';
  const report = { terms: 0, entries: 0, redirects: 0, skipped: [], dryRun: options.dryRun === true };
  const collections = (await request('GET', '/api/cms/collections')).items;
  const collection = name => collections.find(entry => entry.name === name);
  if (!collection(posts)) throw coded('COSSACK_CMS_IMPORT_COLLECTION', `No collection named ${posts}; pass --posts <collection>.`);
  // Terms: existing ones by slug, the rest created, parents first.
  const termIds = { categories: new Map(), tags: new Map() };
  for (const [taxonomy, declared] of [['categories', data.categories], ['tags', data.tags]]) {
    if (!declared.length) continue;
    const existing = await request('GET', `/api/cms/terms/${taxonomy}?perPage=200`).catch(() => ({ items: [] }));
    for (const term of existing.items ?? []) termIds[taxonomy].set(term.slug, term.id);
    const pending = [...declared];
    let progress = true;
    while (pending.length && progress) {
      progress = false;
      for (const term of [...pending]) {
        if (termIds[taxonomy].has(term.slug)) { pending.splice(pending.indexOf(term), 1); progress = true; continue; }
        if (term.parent && !termIds[taxonomy].has(term.parent)) continue;
        if (!report.dryRun) {
          const created = await request('POST', `/api/cms/terms/${taxonomy}`, { name: term.name, slug: term.slug, ...(term.description ? { description: term.description } : {}), ...(term.parent ? { parent: termIds[taxonomy].get(term.parent) } : {}) }).catch(error => { report.skipped.push(`${taxonomy} ${term.slug}: ${error.message}`); return null; });
          if (created) termIds[taxonomy].set(term.slug, created.id ?? created.term?.id ?? term.slug);
        } else termIds[taxonomy].set(term.slug, `dry:${term.slug}`);
        report.terms++;
        pending.splice(pending.indexOf(term), 1);
        progress = true;
      }
    }
    for (const term of pending) report.skipped.push(`${taxonomy} ${term.slug}: its parent ${term.parent} was not found`);
  }
  for (const item of data.items) {
    // Attachments are counted once at the end; media is not imported.
    if (item.type === 'attachment') continue;
    const target = item.type === 'post' ? posts : item.type === 'page' ? pages : null;
    if (!target || !collection(target)) { report.skipped.push(`${item.type || 'item'} "${item.title}": not a post or page`); continue; }
    const status = STATUS[item.status];
    if (!status) { report.skipped.push(`${item.type} "${item.title}": status ${item.status}`); continue; }
    const fields = { title: item.title || '(untitled)', slug: item.slug || undefined, status, content: contentBlocks(item.content), excerpt: item.excerpt.replace(/<[^>]+>/g, '').trim() };
    if (item.date && (status === 'published' || status === 'scheduled')) fields.publishedAt = item.date;
    if (item.type === 'post') {
      const declared = collection(target);
      const taxonomies = (declared.taxonomies ?? []).concat();
      if (taxonomies.includes('categories')) fields.categories = item.categories.map(slug => termIds.categories.get(slug)).filter(Boolean);
      if (taxonomies.includes('tags')) fields.tags = item.tags.map(slug => termIds.tags.get(slug)).filter(Boolean);
    }
    if (item.type === 'page') fields.menuOrder = item.order;
    let created = null;
    if (!report.dryRun) {
      created = await request('POST', `/api/cms/content/${target}`, fields).catch(error => { report.skipped.push(`${item.type} "${item.title}": ${error.message}`); return null; });
      if (!created) continue;
    }
    report.entries++;
    const oldPath = pathOf(item.link);
    const newUrl = created?.item?.url ?? null;
    const newPath = newUrl ? pathOf(newUrl.startsWith('/') ? `https://x${newUrl}` : newUrl) : null;
    if (oldPath && newPath && oldPath !== newPath && oldPath !== '/' && status === 'published') {
      if (!report.dryRun) await request('POST', '/api/cms/redirects', { source: oldPath, target: newPath, status: 301, note: 'WordPress import' }).catch(error => { report.skipped.push(`redirect ${oldPath}: ${error.message}`); return null; });
      report.redirects++;
    }
  }
  const attachments = data.items.filter(item => item.type === 'attachment').length;
  if (attachments) report.skipped.push(`${attachments} attachment(s): media is not imported; upload the files and update the links`);
  return report;
}

/** The CLI command: read the file, sign in through the stored login, import, report. */
export async function importWxrCommand({ positionals = [], flags, env = process.env, cwd = process.cwd(), out = () => {}, fetch = globalThis.fetch }) {
  const file = positionals[0];
  if (!file) throw coded('COSSACK_CMS_IMPORT_FILE', 'Pass the export file: cossack cms import wxr <file.xml>.');
  const xml = await fs.readFile(path.resolve(cwd, file), 'utf8').catch(() => { throw coded('COSSACK_CMS_IMPORT_FILE', `Cannot read ${file}.`); });
  const data = parseWxr(xml);
  const target = await resolveTarget({ flags, env, cwd, needToken: true });
  const client = createClient({ url: target.url, site: target.site, token: target.token, fetch });
  const request = async (method, requestPath, body) => (await client.request(method, requestPath, body === undefined ? {} : { body })).data;
  out(`Importing ${data.items.length} item(s) and ${data.categories.length + data.tags.length} term(s) from "${data.title}"${flags['dry-run'] ? ' (dry run)' : ''}…`);
  const report = await importWxr(data, request, { dryRun: flags['dry-run'] === true, posts: flags.posts, pages: flags.pages });
  out(`${report.dryRun ? 'Would import' : 'Imported'} ${report.entries} entr(ies), ${report.terms} term(s) and ${report.redirects} redirect(s).`);
  for (const line of report.skipped) out(`Skipped ${line}`);
  return report;
}
