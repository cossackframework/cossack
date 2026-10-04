// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { Cossack, State } from '@cossackframework/core';
import { enableDevTools, registerDevToolsInstance, type BrowserDevTools } from '../src/client/devtools';
import { startDevelopmentTrace } from '@cossackframework/core/devtools';

let tools: BrowserDevTools | undefined;
const hosts: Cossack[] = [];
const restores: Array<() => void> = [];
function mockProperty(target: object, key: string, value: unknown) {
    const original = Object.getOwnPropertyDescriptor(target, key);
    Object.defineProperty(target, key, { configurable: true, value });
    restores.push(() => { if (original) Object.defineProperty(target, key, original); else Reflect.deleteProperty(target, key); });
}
afterEach(async () => { tools?.dispose(); tools = undefined; await Promise.all(hosts.splice(0).map(host => host.destroyAsync())); document.body.innerHTML = ''; document.body.style.cursor = ''; restores.splice(0).reverse().forEach(restore => restore()); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
function component(file = '/project/page.ts') {
    class Page extends Cossack { @State() password = 'private-password'; @State() count = 2; }
    const page = new Page(); hosts.push(page); page.connectedCallback();
    const button = document.createElement('button'); button.textContent = 'Application action';
    const marker = JSON.stringify({ file });
    for (const node of [document.createComment('cossack-start:' + marker), button, document.createComment('cossack-end:' + marker)]) document.body.appendChild(node);
    return { page, button, unregister: registerDevToolsInstance(file, page) };
}
it('installs once, opts in through controls, and inspects with the shared passive snapshot API', () => {
    const { button } = component(); tools = enableDevTools(); expect(enableDevTools()).toBe(tools);
    expect(document.querySelectorAll('[role=toolbar]')).toHaveLength(1); expect(tools!.snapshot()).toBeNull();
    const log = vi.spyOn(console, 'info').mockImplementation(() => {}), fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true, shiftKey: true }));
    expect(fetcher).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith('[Cossack DevTools] Component snapshot', expect.objectContaining({ status: 'available' }));
    expect(JSON.stringify(log.mock.calls)).not.toContain('private-password');
    const selected = tools!.inspect('/project/page.ts', { state: ['count', 'password'] });
    expect(selected).toMatchObject({ status: 'available', details: { state: { fields: expect.arrayContaining([
        { name: 'count', visibility: 'public', value: { type: 'number', value: 2 } },
        { name: 'password', visibility: 'public', value: { type: 'redacted' } },
    ]) } } });
    const record = document.querySelector('[aria-pressed]') as HTMLButtonElement;
    expect(record.textContent).toBe('Stop trace'); record.click(); expect(tools!.snapshot()?.collecting).toBe(false);
    expect(record.textContent).toBe('Record trace');
});
it('does not select a completed sibling range and opens source only on the source gesture', () => {
    const { button } = component(); tools = enableDevTools();
    const outside = document.createElement('button'); document.body.appendChild(outside);
    const fetcher = vi.fn().mockResolvedValue(new Response()); vi.stubGlobal('fetch', fetcher);
    outside.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true })); expect(fetcher).not.toHaveBeenCalled();
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
    expect(fetcher).toHaveBeenCalledExactlyOnceWith('http://localhost:3333/open?file=%2Fproject%2Fpage.ts');
});
it('unregisters by identity without deleting a newer committed instance', () => {
    const first = component(); const second = component(); first.unregister(); tools = enableDevTools(); tools!.startCapture();
    expect(tools!.inspect('/project/page.ts')).toMatchObject({ status: 'available' });
    second.unregister(); expect(tools!.inspect('/project/page.ts')).toBeNull();
});
it('disposes listeners, overlays and its capture without stopping a newer external capture', () => {
    const { button } = component(); tools = enableDevTools(); const owned = tools!.startCapture();
    const external = startDevelopmentTrace(); const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    tools!.dispose(); tools!.dispose();
    expect(document.querySelectorAll('[data-cossack-devtools]')).toHaveLength(0);
    expect(owned.snapshot().collecting).toBe(false); expect(external.snapshot().collecting).toBe(true);
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true })); expect(fetcher).not.toHaveBeenCalled();
    expect(tools!.snapshot()).toBeNull(); expect(() => tools!.startCapture()).toThrow(/disposed/); external.stop();
});
it('uses viewport coordinates and the actual Control key, restoring the cursor on blur', () => {
    const { button } = component(); tools = enableDevTools(); document.body.style.cursor = 'help';
    mockProperty(document, 'elementFromPoint', vi.fn(() => button));
    mockProperty(Range.prototype, 'getBoundingClientRect', vi.fn(() => ({ top: 20, left: 30, width: 100, height: 40 })));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control' }));
    const overlay = document.querySelector('[data-cossack-devtools=highlight]') as HTMLElement;
    expect(overlay.style.top).toBe('20px'); expect(overlay.style.left).toBe('30px'); expect(document.body.style.cursor).toBe('crosshair');
    window.dispatchEvent(new Event('blur')); expect(document.body.style.cursor).toBe('help'); expect(overlay.style.display).toBe('none');
});
it('bounds registrations and does not install production tools', () => {
    const first = component('/first.ts');
    for (let i = 0; i < 128; i++) registerDevToolsInstance('/file' + i + '.ts', first.page);
    tools = enableDevTools(); tools!.startCapture(); expect(tools!.inspect('/first.ts')).toBeNull();
    tools!.dispose(); vi.stubEnv('DEV', false); expect(enableDevTools()).toBeUndefined();
    expect(document.querySelectorAll('[data-cossack-devtools]')).toHaveLength(0);
});

it('retains capture across bfcache suspension and tears down on a final page exit', () => {
    component(); tools = enableDevTools(); const session = tools!.startCapture();
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    expect(session.snapshot().collecting).toBe(true);
    expect(document.querySelector('[role=toolbar]')).not.toBeNull();
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
    expect(session.snapshot().collecting).toBe(false);
    expect(document.querySelector('[role=toolbar]')).toBeNull();
});
