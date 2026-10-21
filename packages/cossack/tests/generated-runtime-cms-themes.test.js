// CMS themes past templates: a portfolio child theme ships its projects collection, lists
// related projects through a loader under its grant and links its own stylesheet; widget areas;
// a template chosen for one page; and editing blocks on the public page, which visitors never
// see or download.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect as browserExpect } from '@playwright/test';
import { cleanupRoots, cossack, productionServer, project, typecheck, vite } from './fixtures/generated-app.js';
import { browserless, lacks, visible } from './fixtures/cms-client.js';
import { writePortfolioTheme } from './fixtures/cms-portfolio-theme.js';
import { liveFastDBTests, startFastDBService } from '../../fastdb/src/testing.ts';

afterEach(cleanupRoots);

const EDITOR = 'dashboard/(cms)/content/[collection]/[id]/index.ts';
const SITE = '(site)/[...path]/index.ts';

/** The scripts a page loads: its script tags and module preloads. */
const scriptsOf = html => [...html.matchAll(/<(?:script|link)\b[^>]*?(?:src|href)="?([^"\s>]+\.js)/g)].map(match => match[1]).sort();

/** Files under a directory, recursively, with their text for .js and .css files. */
async function readTree(directory) {
  const files = new Map();
  for (const entry of await fs.readdir(directory, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !/\.(?:js|css)$/.test(entry.name)) continue;
    const file = path.join(entry.parentPath, entry.name);
    files.set(path.relative(directory, file).split(path.sep).join('/'), await fs.readFile(file, 'utf8'));
  }
  return files;
}

describe.skipIf(!liveFastDBTests())('CMS themes', () => {
  it('serves a portfolio child theme, widgets and chosen templates, and edits blocks on the public page', async () => {
    const root = await project('node', ['cms']);
    await writePortfolioTheme(root);
    // The theme reads its own collection and the posts its manifest requests: it passes the policy lints.
    const check = JSON.parse((await cossack(root, ['plugins', 'check', '--json'])).stdout);
    expect(check.data.plugins).toEqual([expect.objectContaining({ plugin: 'default-theme', errors: 0 }), { plugin: 'portfolio', files: 6, errors: 0 }]);
    await cossack(root, ['config', '--generate']);
    await typecheck(root, 'cms theme application');
    await vite(root, []);
    await vite(root, ['--ssr', 'src/index.ts', '--outDir', 'dist/server']);
    // The site editor is a chunk of its own.
    const client = await readTree(path.join(root, 'dist/client'));
    const editorChunks = [...client].filter(([, text]) => text.includes('Someone saved this entry since you started.')).map(([file]) => file);
    expect(editorChunks).toHaveLength(1);
    const editorChunk = path.basename(editorChunks[0]);
    const routeIds = JSON.parse(await fs.readFile(path.join(root, 'dist/client/cossack-routes.json'), 'utf8')).filePathToId;

    const database = await startFastDBService();
    const server = await productionServer(root, { APP_SECRET: 'generated-cms-themes-secret-0123456789abcdef', FASTDB_URL: database.url, FASTDB_TOKEN: database.token,
      CMS_SETUP_CODE: 'setup-code-for-tests', FASTDB_PENDING_DIR: path.join(root, '.cossack/fastdb-pending'), MEDIA_DIR: path.join(root, 'storage/media') });
    let browser;
    try {
      const web = browserless(server.origin, routeIds, () => server.diagnostics());
      const visitor = browserless(server.origin, routeIds, () => server.diagnostics());
      await web.post('/auth/setup', { code: 'setup-code-for-tests', siteTitle: 'Folio Site', name: 'Ada', email: 'ada@example.com', password: 'long password' });

      // Templates need no grant: the theme is usable at once, its loaders' data empty.
      expect(await web.page('/dashboard/plugins')).toMatch(/data-plugin="?portfolio"? data-version="?1\.0\.0"? data-active="?false/);
      const themes = await web.action('dashboard/(cms)/appearance/index.ts', 'activate', ['portfolio']);
      expect(themes.error).toBe('');
      expect(await web.page('/dashboard/appearance')).toContain('Child theme of Cossack Default');
      await web.action(EDITOR, 'save', [{ title: 'Hello from the blog', slug: '', status: 'draft', publishedAt: '' }, 'publish', 0],
        { params: { collection: 'posts', id: 'new' }, state: { route: 'posts', id: 'new' } });
      // A template chosen for one page; the editor offers the theme's templates and refuses others.
      expect(await web.page('/dashboard/content/pages/new')).toMatch(/value="?entry-wide/);
      const refused = await web.action(EDITOR, 'save', [{ title: 'Nope', slug: '', status: 'draft', publishedAt: '', template: 'entry-nope' }, 'publish', 0],
        { params: { collection: 'pages', id: 'new' }, state: { route: 'pages', id: 'new' } });
      expect(refused.errors).toMatchObject({ template: 'is not a template of the active theme.' });
      const wide = await web.action(EDITOR, 'save', [{ title: 'Wide page', slug: '', status: 'draft', publishedAt: '', template: 'entry-wide' }, 'publish', 0],
        { params: { collection: 'pages', id: 'new' }, state: { route: 'pages', id: 'new' } });
      expect(wide._cossack_redirect).toMatch(/\?saved=1$/);
      const ungranted = await visitor.page('/wide-page');
      expect(ungranted).toMatch(/data-template="?entry-wide/);
      expect(ungranted).toMatch(/<ul data-latest><\/ul>/);

      // The theme ships its collection: hidden until the plugin is enabled, then like posts.
      expect(await web.page('/dashboard')).not.toMatch(/href="?\/dashboard\/content\/projects"?[\s>]/);
      expect((await visitor.request('/projects')).status).toBe(404);
      await web.post('/dashboard/plugins', { plugin: 'portfolio', _action: 'grant' });
      expect(await web.page('/dashboard')).toMatch(/href="?\/dashboard\/content\/projects"?[\s>]/);
      // With the grant, the wide template's loader reads posts.
      expect(await visitor.page('/wide-page')).toMatch(/<ul data-latest><li>Hello from the blog<\/li><\/ul>/);

      const project = async (title, client, sections) => {
        const saved = await web.action(EDITOR, 'save', [{ title, slug: '', status: 'draft', publishedAt: '', client, year: '2026', sections }, 'publish', 0],
          { params: { collection: 'projects', id: 'new' }, state: { route: 'projects', id: 'new' } });
        expect(saved._cossack_redirect, JSON.stringify(saved.errors ?? saved.error)).toMatch(/^\/dashboard\/content\/projects\/[0-9a-f-]{36}\?saved=1$/);
        return saved._cossack_redirect.split('/')[4].split('?')[0];
      };
      const rocket = await project('Rocket', 'ACME', [
        { id: 's1', type: 'core/paragraph', data: { text: 'First section' } },
        { id: 's2', type: 'core/quote', data: { text: 'Second section', citation: '' } },
      ]);
      await project('Skates', 'Road Runner', []);

      // Visitors see the child theme's template over the parent's layout, its typed fields, the
      // loader's related projects and its stylesheet; no edit markup.
      const page = await visitor.request('/projects/rocket');
      expect(page.headers.get('cache-control') ?? '').not.toContain('private');
      // Production HTML is minified: attributes may be unquoted.
      const html = visible(await page.text());
      expect(html).toMatch(/data-template="?entry-projects/);
      expect(html).toMatch(/data-theme="?default-theme/);
      expect(html).toMatch(/<p data-strapline>Selected work<\/p>/);
      expect(html).toMatch(/<p data-client>ACME<\/p>/);
      expect(html).toMatch(/<p data-year>2026<\/p>/);
      expect(html).toMatch(/<ul data-related><li><a href="?\/projects\/skates"?>Skates<\/a><\/li><\/ul>/);
      expect(html).toMatch(/<meta name="?theme-color"? content="?#123456/);
      const head = html.slice(html.indexOf('<head'), html.indexOf('</head>'));
      const stylesheet = /<link rel="?stylesheet"? href="?([^"\s>]*portfolio[^"\s>]*)/.exec(head)?.[1];
      expect(stylesheet, `theme stylesheet link in ${head}`).toBeTruthy();
      const css = await fetch(server.origin + stylesheet);
      expect(css.status).toBe(200);
      expect(css.headers.get('content-type')).toContain('text/css');
      // Minified: the theme's rule, with its colour.
      expect(await css.text()).toMatch(/\.portfolio-project\{border-top:4px solid #123456;?\}/);
      for (const text of ['data-cms-edit', 'Edit this page', editorChunk]) lacks(html, text);
      // An editor's page loads the same scripts as a visitor's; the editor is not among them.
      const editorView = visible(await (await web.request('/projects/rocket')).text());
      expect(editorView).toContain('Edit this page');
      expect(scriptsOf(html).length).toBeGreaterThan(0);
      expect(scriptsOf(editorView)).toEqual(scriptsOf(html));

      // Layout blocks: columns with a span and a column hidden on phones, rendered as a grid
      // that responds to the content root's width. The hidden column stays in the HTML.
      // The left column and the right paragraph carry styles: preset slugs of the parent theme's palette.
      await project('Layout', 'Wile E.', [{ id: 'cols', type: 'core/columns', data: { gap: 'small', stack: 'mobile' }, children: [
        { id: 'left', type: 'core/column', data: { span: '4', verticalAlign: 'top' }, style: { background: 'secondary', padding: 'large' }, layout: { anchor: 'aside' }, children: [{ id: 'lh', type: 'core/heading', data: { text: 'Left heading', level: 'h3' } }] },
        { id: 'right', type: 'core/column', data: { span: '', verticalAlign: 'top' }, layout: { hide: ['sm'] }, children: [{ id: 'rp', type: 'core/paragraph', data: { text: 'Right column' }, style: { text: 'primary', align: 'center' }, layout: { className: 'lead' } }] },
      ] }]);
      const layoutHtml = visible(await visitor.page('/projects/layout'));
      expect(layoutHtml).toMatch(/class="?cms-content"?/);
      expect(layoutHtml).toMatch(/class="?cms-columns"? data-gap="?small"? data-stack="?mobile/);
      expect(layoutHtml).toMatch(/--cms-span: ?4/);
      expect(layoutHtml).toMatch(/--cms-span: ?8/);
      expect(layoutHtml).toMatch(/data-hide="?sm"?/);
      expect(layoutHtml.indexOf('Left heading')).toBeLessThan(layoutHtml.indexOf('Right column'));
      // Styles: one wrapper per styled block with its classes and the palette's variables; the root carries the palette.
      expect(layoutHtml).toMatch(/class="?cms-block cms-bg-secondary cms-p-large cms-column-box"? id="?aside"? style="?background-color: ?var\(--cms-color-secondary\); ?padding: ?var\(--cms-space-large\); ?--cms-span: ?4/);
      expect(layoutHtml).toMatch(/class="?cms-block cms-text-primary cms-align-center lead"? style="?color: ?var\(--cms-color-primary\); ?text-align: ?center/);
      expect(layoutHtml).toMatch(/--cms-color-primary: ?#2563eb/);
      expect(layoutHtml).toMatch(/--cms-space-large: ?3rem/);
      // The layout rules ship in the application stylesheet, as container queries.
      const appCss = [...layoutHtml.matchAll(/<link rel="?stylesheet"? href="?([^"\s>]+\.css)/g)].map(match => match[1]).find(href => !href.includes('portfolio'));
      expect(appCss, 'application stylesheet').toBeTruthy();
      const appCssText = await (await fetch(server.origin + appCss)).text();
      expect(appCssText).toContain('@container');
      expect(appCssText).toContain('.cms-columns');

      // Customize changes a palette colour and adds Additional CSS: the page recolours without a resave.
      const customize = 'dashboard/(cms)/appearance/customize/index.ts';
      const refusedCss = await web.action(customize, 'save', [{}, [{ slug: 'primary', value: '#0a0a0a' }], [], '@import url(evil.css);'], { state: { theme: { name: 'portfolio', label: 'Portfolio' } } });
      expect(refusedCss.error).toBe('Additional CSS cannot use @import.');
      const customized = await web.action(customize, 'save', [{}, [{ slug: 'primary', value: '#0a0a0a' }], [{ slug: 'custom-1', name: 'Mine', value: '#123456' }], '.lead { letter-spacing: 0.05em }'], { state: { theme: { name: 'portfolio', label: 'Portfolio' } } });
      expect(customized.error).toBe('');
      const recoloured = visible(await visitor.page('/projects/layout'));
      expect(recoloured).toMatch(/--cms-color-primary: ?#0a0a0a/);
      expect(recoloured).toMatch(/--cms-color-custom-1: ?#123456/);
      // Production HTML is minified, the inline CSS with it.
      expect(recoloured).toMatch(/<style data-cms-custom-css[^>]*>[^<]*\.lead\s*\{\s*letter-spacing:\s*0?\.05em;?\s*\}[^<]*<\/style>/);
      const customizePage = visible(await web.page('/dashboard/appearance/customize'));
      expect(customizePage).toContain('Additional CSS');
      expect(customizePage).toMatch(/data-color="?custom-1/);

      // A widget in the parent theme's footer area.
      const widgets = 'dashboard/(cms)/appearance/widgets/index.ts';
      const loaded = await web.action(widgets, 'load', []);
      const footer = loaded.areas.find(area => area.name === 'footer');
      expect(footer).toMatchObject({ active: true, revision: 0, blocks: [] });
      const saved = await web.action(widgets, 'save', ['footer'], { state: { ...loaded, areas: loaded.areas.map(area => area.name === 'footer'
        ? { ...area, changed: true, blocks: [{ id: 'w1', type: 'core/paragraph', data: { text: 'Footer **note**' } }] } : area) } });
      expect(saved.error).toBe('');
      expect(await visitor.page('/projects/rocket')).toContain('<strong>note</strong>');
      // The Widgets screen lists the block in its tree, with an inserter.
      const widgetsPage = visible(await web.page('/dashboard/appearance/widgets'));
      expect(widgetsPage).toContain('Footer note');
      expect(widgetsPage).toContain('Add block');

      const beforeEdit = visible(await (await visitor.request('/projects/rocket')).text());

      // Editing on the public page, in the browser.
      browser = await chromium.launch({ headless: true });
      const context = await browser.newContext();
      await context.addCookies([...web.jar].map(([name, value]) => ({ name, value, url: server.origin })));
      const tab = await context.newPage();
      const errors = [];
      const scripts = [];
      tab.on('pageerror', error => errors.push(error.message));
      tab.on('request', request => { if (request.resourceType() === 'script') scripts.push(request.url()); });
      const response = await tab.goto(server.origin + '/projects/rocket');
      expect(response.headers()['cache-control']).toContain('private');
      await tab.waitForFunction(() => window.__cossackReady === true);
      expect(scripts.some(url => url.endsWith(editorChunk)), 'the editor loads only in edit mode').toBe(false);
      await tab.getByRole('button', { name: 'Edit this page' }).click();
      const bar = tab.getByRole('region', { name: 'Editing' });
      await browserExpect(bar.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
      expect(scripts.some(url => url.endsWith(editorChunk))).toBe(true);
      const sections = tab.locator('[data-sections]');
      await browserExpect(sections.locator('[data-cms-edit="block"]')).toHaveCount(2);

      // Reorder with the keyboard in the Blocks panel: the page follows.
      await bar.getByRole('button', { name: 'Blocks', exact: true }).click();
      await tab.getByRole('button', { name: /^Move Paragraph\./ }).focus();
      await tab.keyboard.press('ArrowDown');
      await browserExpect(sections.locator('[data-cms-edit="block"]').first()).toHaveAttribute('data-block-id', 's2');

      // Layout on the page: add a group, move it above the first paragraph and move that
      // paragraph into it with the right arrow. The page shows the paragraph inside the group.
      await tab.getByRole('button', { name: 'Add block', exact: true }).click();
      await tab.getByRole('button', { name: 'Group', exact: true }).click();
      // The new group's form opens once the page shows it; Escape closes it and keeps the panel.
      await browserExpect(tab.getByRole('dialog', { name: 'Edit Group' })).toBeVisible();
      await tab.keyboard.press('Escape');
      await browserExpect(tab.getByRole('dialog', { name: 'Edit Group' })).toHaveCount(0);
      await browserExpect(tab.locator('[data-site-block]')).toHaveCount(3);
      await tab.locator('[data-site-block] [data-handle]').last().focus();
      await tab.keyboard.press('ArrowUp');
      await tab.locator('[data-site-block="s1"] [data-handle]').focus();
      await tab.keyboard.press('ArrowRight');
      await browserExpect(tab.locator('[data-site-block="s1"]')).toHaveAttribute('data-depth', '1');
      await browserExpect(sections.locator('[data-cms-edit="block"] [data-cms-edit="block"][data-block-id="s1"]')).toHaveCount(1);
      // The device toggle narrows the content root; the layout blocks follow it.
      await bar.getByRole('button', { name: 'Phone', exact: true }).click();
      await browserExpect(tab.locator('html')).toHaveAttribute('data-cms-device', 'phone');
      expect(await tab.evaluate(() => document.querySelector('.cms-content').getBoundingClientRect().width)).toBeLessThanOrEqual(384);
      await bar.getByRole('button', { name: 'Desktop', exact: true }).click();
      expect(await tab.evaluate(() => document.querySelector('.cms-content').getBoundingClientRect().width)).toBeGreaterThan(384);
      await bar.getByRole('button', { name: 'Blocks', exact: true }).click();

      // Edit a block in place: click it on the page, change its text in the popover.
      await sections.getByText('First section').click();
      const form = tab.getByRole('dialog', { name: 'Edit Paragraph' });
      await form.getByLabel('Text').fill('First section, edited on the site');
      await form.getByRole('button', { name: 'Apply' }).click();
      await browserExpect(sections.getByText('First section, edited on the site')).toBeVisible();
      await browserExpect(bar.getByRole('status')).toHaveText('Unsaved changes');
      // The Style tab: a background from the palette wraps the block on the page.
      await sections.getByText('First section, edited on the site').click();
      const styled = tab.getByRole('dialog', { name: 'Edit Paragraph' });
      await styled.getByRole('tab', { name: 'Style' }).click();
      await styled.getByRole('radiogroup', { name: 'Background' }).getByRole('radio', { name: 'Mine' }).click();
      await styled.getByRole('button', { name: 'Apply' }).click();
      await browserExpect(sections.locator('.cms-block.cms-bg-custom-1')).toHaveCount(1);
      expect(await sections.locator('.cms-block.cms-bg-custom-1').evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(18, 52, 86)');
      // An edit in progress changes nothing for visitors.
      expect(visible(await (await visitor.request('/projects/rocket')).text())).toBe(visible(await (await visitor.request('/projects/rocket')).text()));
      expect(visible(await (await visitor.request('/projects/rocket')).text())).toBe(beforeEdit);
      await bar.getByRole('button', { name: 'Save', exact: true }).click();
      await browserExpect(bar.getByRole('status')).toHaveText('No unsaved changes');
      expect(errors).toEqual([]);

      // Visitors see the saved order and text; the dashboard lists the new revision.
      const after = await visitor.page('/projects/rocket');
      // The order within the sections (the head's description also carries the text): the quote, then the group holding the paragraph.
      const sectionsHtml = after.slice(after.indexOf('data-sections'));
      expect(sectionsHtml.indexOf('Second section')).toBeLessThan(sectionsHtml.indexOf('cms-group'));
      expect(sectionsHtml.indexOf('cms-group')).toBeLessThan(sectionsHtml.indexOf('First section, edited on the site'));
      expect(sectionsHtml).toMatch(/cms-block cms-bg-custom-1/);
      lacks(after, 'data-cms-edit');
      const editorPage = await web.page(`/dashboard/content/projects/${rocket}`);
      expect(editorPage).toMatch(/#2 · [^<]*<span class="?text-foreground"?>Ada<\/span>/);

      // A save made elsewhere meanwhile is a conflict, offered for reload.
      await tab.getByText('First section, edited on the site').click();
      await tab.getByRole('dialog', { name: 'Edit Paragraph' }).getByLabel('Text').fill('Changed in the browser');
      await tab.getByRole('dialog', { name: 'Edit Paragraph' }).getByRole('button', { name: 'Apply' }).click();
      await web.action(EDITOR, 'save', [{ title: 'Rocket, renamed elsewhere' }, 'update', 2], { params: { collection: 'projects', id: rocket }, state: { route: 'projects', id: rocket } });
      await bar.getByRole('button', { name: 'Save', exact: true }).click();
      await browserExpect(bar.getByRole('alert')).toContainText('Someone saved this entry since you started.');
      await bar.getByRole('button', { name: 'Reload' }).click();
      await browserExpect(tab.getByRole('heading', { name: 'Rocket, renamed elsewhere' })).toBeVisible();
      await browserExpect(sections.getByText('First section, edited on the site')).toBeVisible();
      expect(errors).toEqual([]);
    } finally {
      await browser?.close();
      await server.close();
      await database.stop();
    }
  }, 600_000);
});
