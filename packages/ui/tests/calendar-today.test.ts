// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { component, render, renderToString } from '@cossackframework/renderer';
import { Calendar } from '../src/components/Calendar';

afterEach(() => { vi.useRealTimers(); document.body.replaceChildren(); });

it('renders the same markup when the server and the hydrating client see different days', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2024-02-10T12:00:00Z'));
    const server = renderToString(component(Calendar, { id: 'calendar' }));
    vi.setSystemTime(new Date('2024-02-20T12:00:00Z'));
    const client = renderToString(component(Calendar, { id: 'calendar' }));
    expect(client).toBe(server);
    expect(server).not.toContain('aria-current="date"');
});

it('marks and focuses the viewer\'s today once mounted when today is omitted', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2024-02-20T12:00:00Z'));
    const container = document.createElement('div');
    document.body.append(container);
    render(component(Calendar, { id: 'calendar' }), container);
    await vi.waitFor(() => expect(container.querySelector('[aria-current="date"]')?.getAttribute('data-date')).toBe('2024-02-20'));
    expect(container.querySelector('button[data-date][tabindex="0"]')?.getAttribute('data-date')).toBe('2024-02-20');
});

it('uses an explicit today during SSR', () => {
    const output = renderToString(component(Calendar, { id: 'calendar', today: '2024-02-29' }));
    expect(output).toMatch(/data-date="2024-02-29" tabindex="0"[^>]*aria-current="date"/);
});
