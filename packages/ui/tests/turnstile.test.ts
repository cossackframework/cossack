// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { renderToString } from '@cossackframework/renderer';
import { Turnstile, type TurnstileProps, type TurnstileRenderOptions, type TurnstileClient } from '../src/components/Turnstile';
import { loadTurnstileClient } from '../src/internal/turnstile-loader';
function fixture() {
    const options: TurnstileRenderOptions[] = [];
    const client: TurnstileClient = { render: vi.fn((_host, option) => { options.push(option); return String(options.length); }), remove: vi.fn() };
    const control = new Turnstile();
    control.props = { id: 'verify', siteKey: 'public', loadClient: async () => client, onTokenChange: vi.fn(), onSuccess: vi.fn(), onExpired: vi.fn(), onError: vi.fn() };
    vi.spyOn(control, 'requestUpdate').mockResolvedValue(true);
    const parent = document.createElement('div'); parent.innerHTML = '<div></div><input type="hidden">'; document.body.append(parent);
    control.connect(parent.firstElementChild as HTMLElement);
    return { control, options, client, input: parent.querySelector('input')! };
}
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };
describe('Turnstile component lifetime', () => {
    it('SSR is inert and exposes an empty named response field and accessible status', () => {
        const control = new Turnstile(); const loader = vi.fn(); control.props = { id: 'verify', siteKey: 'public', loadClient: loader };
        const output = renderToString(control.render());
        expect(output).toContain('cf-turnstile-response'); expect(output).toContain('role="status"'); expect(output).toContain('aria-describedby="verify-status"'); expect(loader).not.toHaveBeenCalled(); expect(output).not.toContain('<script');
        control.onDispose(); expect(loader).not.toHaveBeenCalled();
    });
    it('loads from the live document after template-container adoption', async () => {
        const inertDocument = document.implementation.createHTMLDocument();
        const host = inertDocument.createElement('div');
        expect(host.ownerDocument).toBe(inertDocument);
        const control = new Turnstile();
        const loader = vi.fn(async (owner: Document) => { expect(owner).toBe(document); return { render: vi.fn(() => 'adopted'), remove: vi.fn() }; });
        control.props = { id: 'adopted', siteKey: 'public', loadClient: loader };
        vi.spyOn(control, 'requestUpdate').mockResolvedValue(true);
        control.connect(host); expect(loader).not.toHaveBeenCalled();
        document.body.append(document.adoptNode(host));
        await tick(); expect(loader).toHaveBeenCalledOnce(); control.onDispose();
    });
    it('clears the token on expiry/error/reset and ignores callbacks from previous challenges', async () => {
        const { control, options, client, input } = fixture(); await tick();
        options[0].callback('first'); expect(input.value).toBe('first'); expect(control.props.onSuccess).toHaveBeenCalledWith('first');
        options[0]['expired-callback'](); expect(input.value).toBe(''); expect(control.props.onExpired).toHaveBeenCalledOnce();
        expect(renderToString(control.render())).toContain('Retry verification');
        await control.reset(); expect(client.remove).toHaveBeenCalledWith('1');
        options[0].callback('stale'); expect(input.value).toBe('');
        options[1].callback('second'); expect(input.value).toBe('second');
        options[1]['error-callback']('secret-like-string'); expect(input.value).toBe(''); expect(control.props.onError).toHaveBeenLastCalledWith({ code: 'widget-error' });
        options[1]['error-callback']('110200'); expect(control.props.onError).toHaveBeenLastCalledWith({ code: 'widget-error', providerCode: '110200' });
        control.onDispose(); options[1].callback('late'); expect(input.value).toBe(''); expect(client.remove).toHaveBeenCalledWith('2');
        const count = options.length; await control.reset(); expect(options).toHaveLength(count);
    });
    it('ignores asynchronous loads after disposal and permits failed-loader retry', async () => {
        const { control, client, options } = fixture(); await tick();
        let resolve!: (client: TurnstileClient) => void;
        control.props.loadClient = () => new Promise(done => { resolve = done; });
        const loading = control.reset(); await tick(); control.onDispose(); resolve(client); await loading;
        expect(options).toHaveLength(1);
        const retry = fixture(); await tick(); retry.control.props.loadClient = vi.fn().mockRejectedValueOnce(new Error('secret')).mockResolvedValue(retry.client);
        await retry.control.reset(); expect(retry.control.props.onError).toHaveBeenLastCalledWith({ code: 'script-load' });
        await retry.control.reset(); expect(retry.options).toHaveLength(2); retry.control.onDispose();
    });
    it('does not restart unchanged renders and declarative reset supports resubmission', async () => {
        const { control, options } = fixture(); await tick(); const host = document.body.lastElementChild!.firstElementChild as HTMLElement;
        control.connect(host); await tick(); expect(options).toHaveLength(1);
        control.props.resetKey = 1; control.connect(host); await tick(); expect(options).toHaveLength(2); control.onDispose();
    });
    it('clears timeout/unsupported/invalid tokens and safely reports render failure', async () => {
        const { control, options, client } = fixture(); await tick();
        options[0]['timeout-callback'](); expect(control.props.onError).toHaveBeenLastCalledWith({ code: 'timeout' });
        options[0]['unsupported-callback'](); expect(control.props.onError).toHaveBeenLastCalledWith({ code: 'unsupported' });
        options[0].callback('x'.repeat(2049)); expect(control.props.onError).toHaveBeenLastCalledWith({ code: 'invalid-token' });
        vi.mocked(client.render).mockImplementationOnce(() => { throw new Error('secret'); }); await control.reset();
        expect(control.props.onError).toHaveBeenLastCalledWith({ code: 'render-failed' }); control.onDispose();
    });
});
it('shares official script loading, cancellation is local, and script failures permit retry', async () => {
    const doc = document.implementation.createHTMLDocument();
    const scripts: HTMLScriptElement[] = [];
    vi.spyOn(doc.head, 'append').mockImplementation((...nodes) => { scripts.push(nodes[0] as HTMLScriptElement); });
    const a = new AbortController(); const first = loadTurnstileClient(doc, a.signal); const firstFailure = expect(first).rejects.toThrow('cancelled');
    const second = loadTurnstileClient(doc, new AbortController().signal); const secondFailure = expect(second).rejects.toThrow('unavailable');
    expect(scripts).toHaveLength(1); expect(scripts[0].src).toContain('challenges.cloudflare.com/turnstile/v0/api.js?render=explicit');
    a.abort(); await firstFailure; scripts[0].dispatchEvent(new Event('error')); await secondFailure;
    const retry = loadTurnstileClient(doc, new AbortController().signal); const retryFailure = expect(retry).rejects.toThrow('unavailable');
    expect(scripts).toHaveLength(2); scripts[1].dispatchEvent(new Event('error')); await retryFailure;
});
it('keeps public props typed without any client secret', () => {
    const valid: TurnstileProps = { id: 'test', siteKey: 'public', theme: 'dark', onSuccess: token => { const value: string = token; void value; } }; void valid;
    // @ts-expect-error Secret keys belong only to server verification.
    const secret: TurnstileProps = { id: 'test', siteKey: 'public', secretKey: 'secret' }; void secret;
    // @ts-expect-error Theme is a bounded provider option.
    const theme: TurnstileProps = { id: 'test', siteKey: 'public', theme: 'unknown' }; void theme;
});
