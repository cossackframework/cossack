// A portfolio theme for the CMS theme suites: a child of the default theme that ships its
// projects collection, lists related projects through a loader, links its own stylesheet from
// assets/ and offers a wide template for single entries, which lists the latest posts through a
// loader under a requested grant.
import fs from 'node:fs/promises';
import path from 'node:path';

export const PORTFOLIO_CSS = '.portfolio-project { border-top: 4px solid #123456; }\n';

const files = {
  'plugin.json': JSON.stringify({
    schemaVersion: 1,
    name: 'portfolio',
    version: '1.0.0',
    description: 'A portfolio theme with projects.',
    theme: { label: 'Portfolio', extends: 'default-theme', options: { strapline: { kind: 'string', max: 80, default: 'Selected work', label: 'Strapline' } } },
    permissions: { resources: { 'cms/posts': ['read'] } },
    collections: [{
      name: 'projects', label: 'Projects', singular: 'Project', path: 'projects', icon: 'case',
      fields: {
        client: { kind: 'string', max: 120, label: 'Client' },
        year: { kind: 'integer', label: 'Year' },
        sections: { kind: 'blocks', label: 'Sections' },
      },
    }],
  }, null, 2),
  'server.ts': `import type { ThemeLoaders } from '@cossackframework/cms/server';

/** Other published projects, for the related list under a project. */
export const loaders: ThemeLoaders = {
    'entry-projects': async (entry, { cms, principal }) => {
        const list = await cms.resource('cms/projects').list({ where: { status: 'published' }, order: { field: 'title', direction: 'asc' }, limit: 10 }, { principal });
        return { related: list.records.filter(record => record.id !== (entry as { id: string }).id).map(record => ({ title: String(record.title), url: '/projects/' + String(record.slug) })) };
    },
    /** Posts are not the theme's own: reading them needs the grant its manifest requests. */
    'entry-wide': async (_entry, { cms, principal }) => {
        const list = await cms.resource('cms/posts').list({ where: { status: 'published' }, limit: 3 }, { principal });
        return { latest: list.records.map(record => String(record.title)) };
    },
};
`,
  'templates/entry-projects.ts': `import { html, type TemplateResult } from '@cossackframework/renderer';
import type { EntryView, ThemeHelpers } from '@cossackframework/cms';

export default function project(entry: EntryView, helpers: ThemeHelpers): TemplateResult {
    const related = (helpers.data.page.related as { title: string; url: string }[] | undefined) ?? [];
    return html\`<article class="portfolio-project" data-template="entry-projects">
        <p data-strapline>\${String(helpers.options.strapline ?? '')}</p>
        <h1>\${entry.title}</h1>
        <p data-client>\${String(entry.fields.client ?? '')}</p>
        <p data-year>\${String(entry.fields.year ?? '')}</p>
        <div data-sections>\${entry.blocks.map(block => helpers.block(block))}</div>
        <aside><h2>Related projects</h2><ul data-related>\${related.map(item => html\`<li><a href=\${item.url}>\${item.title}</a></li>\`)}</ul></aside>
    </article>\`;
}
`,
  'templates/entry-wide.ts': `import { html, type TemplateResult } from '@cossackframework/renderer';
import type { EntryView, ThemeHelpers } from '@cossackframework/cms';

export default function wide(entry: EntryView, helpers: ThemeHelpers): TemplateResult {
    const latest = (helpers.data.page.latest as string[] | undefined) ?? [];
    return html\`<article data-template="entry-wide"><h1>\${entry.title}</h1>\${helpers.content(entry.body)}
        <ul data-latest>\${latest.map(title => html\`<li>\${title}</li>\`)}</ul></article>\`;
}
`,
  'templates/head.ts': `import type { HeadValue } from '@cossackframework/core';
import type { SiteView, ThemeHelpers } from '@cossackframework/cms';

export default function head(_site: SiteView, helpers: ThemeHelpers): HeadValue {
    return {
        links: [{ tag: 'link', attributes: { rel: 'stylesheet', href: helpers.asset('assets/portfolio.css') } }],
        meta: [{ tag: 'meta', attributes: { name: 'theme-color', content: '#123456' } }],
    };
}
`,
  'assets/portfolio.css': PORTFOLIO_CSS,
};

/** Render the theme into an application's src/plugins/portfolio. */
export async function writePortfolioTheme(root) {
  const directory = path.join(root, 'src/plugins/portfolio');
  for (const [name, source] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(directory, name)), { recursive: true });
    await fs.writeFile(path.join(directory, name), source);
  }
}
