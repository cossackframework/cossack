import { expect, it } from 'vitest';
import { html, renderToString } from '@cossackframework/renderer';
import { linkButton, notice, pageHeader } from '../src/blocks/DashboardPage/index';

it('renders a screen heading with its description and actions', () => {
    const out = renderToString(pageHeader('Bookmarks', { description: 'Saved for later.', actions: html`<button>Export</button>`, titleActions: linkButton('Add new', '/dashboard/bookmarks/new', 'outline', { size: 'sm' }) }));
    expect(out).toMatch(/<h1[^>]*>Bookmarks<\/h1>/);
    expect(out).toContain('Saved for later.');
    expect(out).toContain('<button>Export</button>');
    expect(out).toContain('href="/dashboard/bookmarks/new"');
    expect(out).toContain('Add new');
});

it('leaves out the description and actions a heading does not have', () => {
    const out = renderToString(pageHeader('Bookmarks'));
    expect(out).not.toContain('<p');
    expect(out).not.toContain('flex-wrap items-center gap-2');
});

it('announces errors at once and other messages politely', () => {
    const error = renderToString(notice('Could not save.', 'error'));
    expect(error).toContain('data-notice="error"');
    expect(error).toContain('role="alert"');
    expect(error).toContain('text-destructive');
    const saved = renderToString(notice('Saved.', 'success'));
    expect(saved).toContain('data-notice="success"');
    expect(saved).toContain('role="status"');
});
