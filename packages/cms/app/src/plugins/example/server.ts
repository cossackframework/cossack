/**
 * The example plugin's server code: hooks, a command, and the counts it caches. The host calls
 * `register()` once at startup; nothing here runs until an administrator grants the plugin
 * under Plugins, and every handler stops when it is disabled.
 */
import { beforeWrite, dashboardNotices, dashboardTaskbar, entryActions, siteMarkdown, systemPrincipal } from '@cossackframework/cms';
import type { PluginContext } from '@cossackframework/cms/server';

const STATUSES = ['draft', 'pending', 'scheduled', 'published'] as const;

export function register(context: PluginContext) {
    /** The plugin acting as itself, for work no user started, such as the taskbar's count. */
    const own = { principal: systemPrincipal('plugin:example') };
    const bookmarks = context.cms.resource('example/bookmarks');

    // Data rules: every write to the plugin's own records passes through here first. Throwing refuses the write with a validation error.
    context.hooks.addFilter(beforeWrite, (draft, { input }) => {
        if (input.resource !== 'example/bookmarks') return draft;
        const url = typeof draft.url === 'string' ? draft.url.trim() : draft.url;
        if (typeof url === 'string' && !/^(?:https?:\/\/|\/(?!\/))/.test(url)) throw new Error('The address must start with https://, http:// or /.');
        return { ...draft, ...(typeof draft.title === 'string' ? { title: draft.title.trim() } : {}), ...(url !== undefined ? { url } : {}) };
    });

    // A quick action under every entry of a collection: add it to the reading list.
    context.hooks.addFilter(entryActions, (actions, { input: { resource, record } }) => {
        if (!resource.startsWith('cms/') || resource === 'cms/forms' || resource === 'cms/patterns') return actions;
        const query = new URLSearchParams({ title: String(record.title ?? record.id), url: `/dashboard/content/${resource.slice('cms/'.length)}/${record.id}` });
        return [...actions, { id: 'example.bookmark', label: 'Add to reading list', href: `/dashboard/example?${query}` }];
    });

    // A notice above every dashboard screen, until an administrator turns it off under Settings → Plugins.
    context.hooks.addFilter(dashboardNotices, async notices => await context.settings.get('welcome') === false ? notices
        : [...notices, { id: 'example.welcome', tone: 'info' as const, message: 'The example plugin is active: open Example to see what a plugin adds.', href: '/dashboard/example' }]);

    // A count on the taskbar: unread reading-list items. It runs on every dashboard navigation, so the count is cached for half a minute.
    context.hooks.addFilter(dashboardTaskbar, async items => {
        const unread = await context.cache.remember('unread', 30_000, () => bookmarks.count({ where: { done: false } }, own));
        return unread ? [...items, { id: 'example.unread', label: 'Reading list', href: '/dashboard/example', count: unread }] : items;
    });

    // Every entry as machines read it (Accept: text/markdown, ?format=md) ends with the note from the plugin's settings.
    context.hooks.addFilter(siteMarkdown, async markdown => {
        const note = String(await context.settings.get('markdownNote') ?? '').trim();
        return note ? `${markdown.trimEnd()}\n\n---\n\n${note}\n` : markdown;
    });

    // `cossack example:stats`: runs in the application as the signed-in user, so their read access applies.
    context.commands.add('stats', async (_input, { principal }) => {
        const posts = context.cms.resource('cms/posts');
        const counts = await Promise.all(STATUSES.map(status => posts.count({ where: { status } }, { principal })));
        return { posts: Object.fromEntries(STATUSES.map((status, index) => [status, counts[index]])), unread: await bookmarks.count({ where: { done: false } }, { principal }) };
    });
}
