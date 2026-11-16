import { expect, it } from 'vitest';
import { renderToString } from '@cossackframework/renderer';
import { bulkBar, countBadge, listFilters, listFooter, listTable, rowActions, tabFromQuery, toggleSelected } from '../src/blocks/index';

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

it('renders a list table with English defaults and no global __()', () => {
    expect('__' in globalThis).toBe(false);
    const rows = [{ id: 'a', name: 'Ada' }, { id: 'b', name: 'Bob' }];
    const output = renderToString(listTable({ rows, key: row => row.id, rowAttribute: 'data-user',
        columns: [{ label: 'Name', cell: row => row.name, sort: 'ascending' }, false],
        selection: { selected: ['a'], label: row => `Select ${row.name}`, change: () => {} } }));
    expect(output).toContain('data-user="a"');
    expect(output).toContain('aria-sort="ascending"');
    expect(output).toContain('aria-label="Select all"');
    expect(output).toContain('aria-label="Select Ada"');
    expect(output).toContain('bg-primary/5');
    expect(renderToString(listTable({ rows: [], key: () => '', columns: [] }))).toContain('Nothing found.');
    expect(renderToString(listTable({ rows: [], key: () => '', columns: [], empty: 'Rien.' }))).toContain('Rien.');
});

it('takes translated labels for the filter bar, the footer and the bulk bar', () => {
    const filters = renderToString(listFilters({ action: '/users', hidden: { sort: 'name', empty: '' }, search: { name: 'q', value: 'ad', placeholder: 'Suchen' }, filterLabel: 'Filtern' }));
    expect(filters).toContain('name="sort" value="name"');
    expect(filters).not.toContain('name="empty"');
    expect(text(filters)).toContain('Filtern');
    expect(text(renderToString(listFooter({ total: 1, page: 1, totalPages: 1, href: page => `?page=${page}` })))).toContain('1 item');
    const footer = renderToString(listFooter({ total: 40, page: 2, totalPages: 2, more: true, href: page => `?page=${page}`, labels: { items: 'Einträge', page: page => `Seite ${page}` } }));
    expect(text(footer)).toContain('40+ Einträge');
    expect(footer).toContain('Seite 1');
    const bulk = renderToString(bulkBar({ id: 'bulk-top', choices: [{ key: 'delete', label: 'Delete' }], value: 'delete', count: 2, choose: () => {}, apply: () => {}, labels: { apply: 'Anwenden' } }));
    expect(text(bulk)).toContain('Anwenden');
    expect(text(bulk)).toContain('2 selected');
});

it('keeps row actions, counts and tabs as before', () => {
    const actions = renderToString(rowActions([{ id: 'edit', label: 'Edit', href: '/edit' }, { id: 'delete', label: 'Delete', danger: true, run: () => {} }]));
    expect(actions).toContain('href="/edit"');
    expect(actions).toContain('text-destructive');
    expect(renderToString(countBadge(0))).toBe('');
    expect(text(renderToString(countBadge(3)))).toContain('3');
    expect(tabFromQuery('drafts', ['all', 'drafts'] as const)).toBe('drafts');
    expect(tabFromQuery('nope', ['all', 'drafts'] as const)).toBe('all');
    expect(toggleSelected(['a'], 'b', true)).toEqual(['a', 'b']);
    expect(toggleSelected(['a', 'b'], 'a', false)).toEqual(['b']);
});
