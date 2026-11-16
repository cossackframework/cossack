// An isolated plugin for tests/isolate-worker.test.ts: a filter, an action and a command.
import { beforeWrite, afterCommit } from '@cossackframework/cms';
import type { PluginContext } from '@cossackframework/cms/server';

export function register(context: PluginContext) {
    let greeting = '';
    context.hooks.addFilter(beforeWrite, async draft => {
        greeting ||= String(await context.settings.get('greeting'));
        return { ...draft, title: greeting + ' ' + draft.title };
    });
    context.hooks.addAction(afterCommit, async event => { await context.cms.resource('desk/tickets').get(event.id, { principal: { kind: 'anonymous' } }); });
    context.commands.add('ping', async (input, { principal }) => {
        const response = await context.fetch('https://api.example.com/ping', { method: 'POST', body: JSON.stringify(input) });
        return { principal: principal.kind, status: response.status, body: await response.text(), site: await context.settings.get('site') };
    });
}
