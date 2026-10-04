// @vitest-environment node
import { expect, it } from 'vitest';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';

it('captures and inspects in Chromium without invoking an application action or opening the editor', async () => {
    const entry = fileURLToPath(new URL('../src/client/devtools.ts', import.meta.url));
    const server = await createServer({
        configFile: false, logLevel: 'error', mode: 'development',
        server: { host: '127.0.0.1', port: 0 },
        plugins: [{
            name: 'devtools-browser-fixture',
            resolveId(id) { if (id === 'virtual:inspector-fixture') return '\0' + id; },
            load(id) {
                if (id !== '\0virtual:inspector-fixture') return;
                return `
                    import { Cossack, State } from '@cossackframework/core';
                    import { enableDevTools, registerDevToolsInstance } from ${JSON.stringify(entry)};
                    class Page extends Cossack {}
                    State()(Page.prototype, 'count');
                    State()(Page.prototype, 'password');
                    const page = new Page(); page.count = 7; page.password = 'browser-fixture-secret';
                    page.connectedCallback();
                    const button = document.createElement('button'); button.id = 'action'; button.textContent = 'Application action';
                    let calls = 0; button.addEventListener('click', () => calls++);
                    const marker = JSON.stringify({ file: '/fixture/page.ts' });
                    document.body.append(document.createComment('cossack-start:' + marker), button, document.createComment('cossack-end:' + marker));
                    registerDevToolsInstance('/fixture/page.ts', page);
                    const tools = enableDevTools();
                    window.fixture = { tools, calls: () => calls, destroy: () => page.destroyAsync() };
                `;
            },
            configureServer(vite) {
                vite.middlewares.use(async (req, res, next) => {
                    if (req.url !== '/') return next();
                    try {
                        const html = await vite.transformIndexHtml('/', '<!doctype html><html><body><script type="module" src="/@id/virtual:inspector-fixture"></script></body></html>');
                        res.setHeader('Content-Type', 'text/html'); res.end(html);
                    } catch (error) { next(error); }
                });
            },
        }],
    });
    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
    try {
        await server.listen();
        browser = await chromium.launch({ headless: true });
        const page = await browser.newPage();
        const errors: string[] = [], editorRequests: string[] = [], logs: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('request', request => { if (request.url().includes('localhost:3333')) editorRequests.push(request.url()); });
        page.on('console', message => { if (message.type() === 'info') logs.push(message.text()); });
        await page.goto(server.resolvedUrls!.local[0]);
        await page.waitForFunction(() => !!(window as any).fixture);
        expect(await page.evaluate(() => (window as any).fixture.tools.snapshot())).toBeNull();
        await page.locator('#action').click({ modifiers: ['Control', 'Shift'] });
        const result = await page.evaluate(() => ({
            snapshot: (window as any).fixture.tools.snapshot(),
            selected: (window as any).fixture.tools.inspect('/fixture/page.ts', { state: ['count', 'password'] }),
            calls: (window as any).fixture.calls(),
        }));
        expect(result.calls).toBe(0);
        expect(result.snapshot.collecting).toBe(true);
        expect(result.selected).toMatchObject({ status: 'available', details: { state: { fields: expect.arrayContaining([
            { name: 'count', visibility: 'public', value: { type: 'number', value: 7 } },
            { name: 'password', visibility: 'public', value: { type: 'redacted' } },
        ]) } } });
        expect(JSON.stringify(result)).not.toContain('browser-fixture-secret');
        expect(logs.some(log => log.includes('Component snapshot'))).toBe(true);
        expect(editorRequests).toEqual([]);
        await page.getByRole('button', { name: 'Stop trace', exact: true }).click();
        expect(await page.evaluate(() => (window as any).fixture.tools.snapshot().collecting)).toBe(false);
        await page.evaluate(async () => { (window as any).fixture.tools.dispose(); await (window as any).fixture.destroy(); });
        expect(await page.locator('[data-cossack-devtools]').count()).toBe(0);
        await page.locator('#action').click();
        expect(await page.evaluate(() => (window as any).fixture.calls())).toBe(1);
        expect(errors).toEqual([]);
    } finally {
        await browser?.close();
        await server.close();
    }
}, 60000);
