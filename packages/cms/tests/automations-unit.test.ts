import { describe, expect, it } from 'vitest';
import { automationMatches, automationProblems, renderAutomationTemplate } from '../src/automations';

describe('automations', () => {
    it('checks the shape', () => {
        expect(automationProblems({ name: 'Tell the team', event: 'entry.published', conditions: { collection: 'posts' }, action: { kind: 'email', to: 'team@example.com, {{ customerEmail }}', subject: 'New: {{ title }}', text: '{{ url }}' } })).toEqual([]);
        expect(automationProblems({ name: 'Hook', event: 'form.submitted', conditions: { form: 'contact' }, action: { kind: 'webhook', url: 'https://hooks.example/x', secret: 'longenough' } })).toEqual([]);
        expect(automationProblems({ name: '', event: 'nope', action: { kind: 'email', to: 'bad', subject: '', text: '' } })).toEqual([
            'Name the automation in 1 to 120 characters.', 'Choose an event: entry.published, entry.created, entry.updated, entry.deleted, form.submitted, payment.completed.',
            'Email: up to ten addresses, or a {{ variable }} such as {{ customerEmail }}.', 'Email: a subject of 1 to 200 characters.', 'Email: a text of up to 20,000 characters.']);
        expect(automationProblems({ name: 'x', event: 'entry.created', action: { kind: 'webhook', url: 'http://plain.example/' } })).toEqual(['Webhook: an https URL.']);
    });

    it('fills templates and matches conditions', () => {
        expect(renderAutomationTemplate('{{ title }} at {{ url }} by {{ values.email }} {{ missing }}', { title: 'Hi', url: '/hi', values: { email: 'a@b.co' } })).toBe('Hi at /hi by a@b.co ');
        const rule = { event: 'entry.published' as const, conditions: { collection: 'posts' } };
        expect(automationMatches(rule, 'entry.published', { collection: 'posts' })).toBe(true);
        expect(automationMatches(rule, 'entry.published', { collection: 'pages' })).toBe(false);
        expect(automationMatches(rule, 'entry.updated', { collection: 'posts' })).toBe(false);
        expect(automationMatches({ event: 'form.submitted', conditions: {} }, 'form.submitted', { form: 'contact' })).toBe(true);
    });
});
