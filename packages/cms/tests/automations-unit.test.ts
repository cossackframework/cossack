import { describe, expect, it } from 'vitest';
import { automationMatches, automationProblems, renderAutomationTemplate } from '../src/automations';

describe('automations', () => {
    it('checks the shape', () => {
        expect(automationProblems({ name: 'Tell the team', event: 'entry.published', conditions: { collection: 'posts' }, action: { kind: 'email', to: 'team@example.com, {{ $.customerEmail }}', subject: 'New: {{ $.title }}', text: '{{ $.url }}' } })).toEqual([]);
        expect(automationProblems({ name: 'Thanks', event: 'form.submitted', conditions: { form: 'contact' }, action: { kind: 'email', to: '{{ $.values.email }}', subject: 'Thanks', text: 'We got your message.' } })).toEqual([]);
        expect(automationProblems({ name: '', event: 'nope', action: { kind: 'email', to: 'bad', subject: '', text: '' } })).toEqual([
            'Name the automation in 1 to 120 characters.', 'Choose an event: entry.published, entry.created, entry.updated, entry.deleted, form.submitted, payment.completed.',
            'Email: up to ten addresses, or a binding such as {{ $.customerEmail }}.', 'Email: a subject of 1 to 200 characters.', 'Email: a text of up to 20,000 characters.']);
        // Posting to a URL is a webhook's job, so the action kind is refused.
        expect(automationProblems({ name: 'x', event: 'entry.created', action: { kind: 'webhook', url: 'https://hooks.example/' } })).toEqual(['The action is an email; to post events to a URL, add a webhook.']);
    });

    it('fills templates and matches conditions', () => {
        expect(renderAutomationTemplate('{{ $.title }} at {{ $.url }} by {{ $.values.email }} {{ $.missing }}', { title: 'Hi', url: '/hi', values: { email: 'a@b.co' } })).toBe('Hi at /hi by a@b.co ');
        // The same bindings as content: the site and the actor are scopes; a bare name is not a variable.
        expect(renderAutomationTemplate('{{ $site.title }}: {{ $user.name }} {{ title }}', { title: 'Hi' }, { site: { title: 'Blog' }, user: { name: 'Ann' } })).toBe('Blog: Ann {{ title }}');
        expect(renderAutomationTemplate('{{ $site.title }}|{{ $user.name }}', {})).toBe('|');
        // A bare {{ name }} recipient is no longer a binding, so it is refused.
        expect(automationProblems({ name: 'x', event: 'form.submitted', action: { kind: 'email', to: '{{ values.email }}', subject: 's', text: 't' } })).toEqual(['Email: up to ten addresses, or a binding such as {{ $.customerEmail }}.']);
        const rule = { event: 'entry.published' as const, conditions: { collection: 'posts' } };
        expect(automationMatches(rule, 'entry.published', { collection: 'posts' })).toBe(true);
        expect(automationMatches(rule, 'entry.published', { collection: 'pages' })).toBe(false);
        expect(automationMatches(rule, 'entry.updated', { collection: 'posts' })).toBe(false);
        expect(automationMatches({ event: 'form.submitted', conditions: {} }, 'form.submitted', { form: 'contact' })).toBe(true);
    });
});
