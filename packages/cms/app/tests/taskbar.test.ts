import { describe, expect, it, vi } from 'vitest';

vi.stubGlobal('__', (value: string) => value);
const { taskbar } = await import('../src/cms/taskbar');
const { renderToString } = await import('@cossackframework/renderer/server');

const view = (overrides: Partial<Parameters<typeof taskbar>[0]> = {}) => ({
    site: { title: 'Blog', logo: '/logo.svg' }, start: [{ label: 'Dashboard', href: '/dashboard' }],
    context: { status: 'draft', edit: '/hello?edit', links: [{ label: 'Edit', href: '/dashboard/content/posts/1' }] },
    create: [], plugins: [], seo: null,
    user: { name: 'Ann Lee', email: 'ann@example.com', avatar: null, links: [] },
    ...overrides,
});
const render = async (input = view()) => (await renderToString(taskbar(input, { logout: () => undefined }))).replace(/\s*\n\s*/g, '');

describe('site taskbar', () => {
    it('shows the status as underlined text in its color, not a badge', async () => {
        const markup = await render();
        expect(markup).toMatch(/<span data-taskbar-status="draft" class="[^"]*underline[^"]*decoration-muted-foreground\/60[^"]*">Draft<\/span>/);
        expect(markup).not.toContain('cs-badge');
        expect(await render(view({ context: { status: 'published', edit: null, links: [] } }))).toContain('decoration-emerald-500');
        expect(await render(view({ context: { status: 'odd', edit: null, links: [] } }))).not.toContain('data-taskbar-status');
    });

    it('styles Live Edit as the other bar links, with an icon', async () => {
        const markup = await render();
        const liveEdit = markup.match(/<a href="\/hello\?edit" class="([^"]*)">(.*?)<\/a>/);
        const edit = markup.match(/<a href="\/dashboard\/content\/posts\/1" class="([^"]*)">/);
        expect(liveEdit?.[1]).toBe(edit?.[1]);
        expect(liveEdit?.[2]).toContain('<svg');
        expect(markup).not.toContain('bg-primary px-3');
    });

    it('shows initials when the user has no picture, and the picture when they have one', async () => {
        expect(await render()).toContain('<span aria-hidden="true" class="cs-avatar__fallback">AL</span>');
        expect(await render(view({ user: { name: 'Ann Lee', email: 'ann@example.com', avatar: '/media/ann.png', links: [] } }))).toContain('src="/media/ann.png"');
    });
});
