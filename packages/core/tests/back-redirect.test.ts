// @vitest-environment node
import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
vi.mock('../src/shared/environment', () => ({ isServer: true }));
const { Cossack } = await import('../src/shared/cossack');

async function back(referer?: string) {
    const app = new Hono();
    app.post('/forms', c => Cossack.prototype.back.call({ isServer: true, c } as any, '/fallback') as Response);
    const response = await app.request('http://app.example/forms', { method: 'POST', headers: referer ? { referer } : {} });
    expect(response.status).toBe(302);
    return response.headers.get('Location');
}

describe('back()', () => {
    it('redirects to a same-origin referer', async () => {
        expect(await back('http://app.example/forms?step=2#top')).toBe('http://app.example/forms?step=2#top');
    });

    it.each(['https://evil.example/phish', '//evil.example/phish', 'http://app.example.evil.example/', 'https://app.example/forms', 'javascript:alert(1)', 'not a url'])
        ('uses the fallback for an off-origin or invalid referer %s', async referer => {
            expect(await back(referer)).toBe('/fallback');
        });

    it('uses the fallback without a referer', async () => {
        expect(await back()).toBe('/fallback');
    });
});
