// @vitest-environment jsdom
import 'reflect-metadata';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Cossack } from '../src/shared/cossack';
import { ClientState, ClientStore, Page, State } from '../src/shared/decorators';
import { defineUrlState, url } from '../src/shared/url-state';

const filters = defineUrlState({ page: url.integer({ default: 1, min: 1 }) });
@Page({ transport: 'http' }) class Draft extends Cossack {
    @ClientState() file: File | undefined = undefined;
    @ClientStore() draft = { text: '', nested: { count: 0 } };
    @State() result = 'server';
}
class Inherited extends Draft {}
const state = (page = 1) => ({ public: { result: 'SSR' }, metadata: { componentId: 'list', pathname: '/list', url: `/list?page=${page}` } });
beforeEach(() => window.history.replaceState({}, '', '/list?page=1'));
afterEach(() => { vi.restoreAllMocks(); Cossack._onUpdateUrlState = undefined; });

it('transfers inherited browser drafts and File identity without reading serialized internal values', async () => {
    const previous = new Inherited();
    await previous.bootstrap({ initialState: state(), skipInit: true, deferMount: true });
    const file = new File(['draft'], 'draft.txt');
    previous.file = file; previous.draft.text = 'unsaved'; previous.draft.nested.count = 3;
    const oldProxy = previous.draft;
    const token = previous._frameworkCaptureClientDraft()!;
    previous.destroy();
    const next = new Inherited();
    expect(next._frameworkRestoreClientDraft(JSON.parse(JSON.stringify(token)))).toBe(false);
    const wrongClass = new Draft(); expect(wrongClass._frameworkRestoreClientDraft(token)).toBe(false); wrongClass.destroy();
    expect(next._frameworkRestoreClientDraft(token)).toBe(true);
    expect(new Inherited()._frameworkRestoreClientDraft(token)).toBe(false);
    await next.bootstrap({ initialState: { ...state(2), internal: { file: 'forged', draft: { text: 'forged' } } }, skipInit: true, deferMount: true });
    expect(next.file).toBe(file); expect(next.draft).toEqual({ text: 'unsaved', nested: { count: 3 } });
    expect(next.draft).not.toBe(oldProxy); expect(next.result).toBe('SSR');
    const update = vi.spyOn(next, 'requestUpdate').mockResolvedValue(true);
    next.draft.nested.count = 4; expect(update).toHaveBeenCalled();
    expect(next._frameworkRestoreClientDraft({})).toBe(false);
    next.destroy(); expect(next._frameworkCaptureClientDraft()).toBeUndefined();
});

it('adopts edits made while preparing without sharing the outgoing store before publication', async () => {
    const previous = new Inherited();
    await previous.bootstrap({ initialState: state(), deferMount: true });
    const next = new Inherited();
    await next.bootstrap({ initialState: state(2), stageNavigation: true });
    next.draft.text = 'prepared initializer';
    expect(previous.draft.text).not.toBe('prepared initializer');
    const file = new File(['new edit'], 'new.txt');
    previous.file = file;
    previous.draft.text = 'edited while preparing';
    const token = previous._frameworkCaptureClientDraft()!;
    expect(next._frameworkAdoptClientDraft(token)).toBe(true);
    expect(next._frameworkAdoptClientDraft(token)).toBe(false);
    expect(next.file).toBe(file);
    expect(next.draft.text).toBe('edited while preparing');
    expect(next.draft).not.toBe(previous.draft);
    const oldProxy = previous.draft;
    const oldNested = previous.draft.nested;
    previous.destroy();
    oldProxy.text = 'late old write';
    oldNested.count = 99;
    expect(next.draft).toEqual({ text: 'edited while preparing', nested: { count: 0 } });
    next.draft.text = 'new owner edit';
    expect(oldProxy.text).toBe('late old write');
    next.destroy();
});

it('snapshots before outgoing cleanup can change the transferred draft', async () => {
    @Page({ transport: 'http' }) class PageWithCleanup extends Draft {
        onCleanup() { this.draft.text = 'cleanup mutation'; }
    }
    const previous = new PageWithCleanup();
    await previous.bootstrap({ initialState: state(), deferMount: true });
    previous.draft.text = 'saved edit';
    const token = previous._frameworkCaptureClientDraft()!;
    previous.destroy();
    const next = new PageWithCleanup();
    expect(next._frameworkRestoreClientDraft(token)).toBe(true);
    await next.bootstrap({ initialState: state(2), stageNavigation: true });
    expect(next.draft.text).toBe('saved edit');
    next.destroy();
});

it.each(['resolve', 'reject'] as const)('retained resource handoff discards a late %s and hydrates the new query without RPC', async settlement => {
    let resolve!: (value: string) => void; let reject!: (error: Error) => void;
    const pending = new Promise<string>((yes, no) => { resolve = yes; reject = no; });
    const loader = vi.fn((_page: number) => pending);
    @Page({ transport: 'http' }) class Layout extends Cossack {
        static readonly __cossackResourceFields = ['item'];
        get request() { return this.c.req; }
        get item() { return this.__serverResource('item', loader, { deps: () => [this.urlState(filters).page] as const, initial: '' }); }
    }
    const layout = new Layout(); vi.spyOn(layout, 'requestUpdate').mockResolvedValue(true);
    await layout.bootstrap({ initialState: { ...state(), serverResources: { item: { argsKey: '[1]', value: 'one' } } }, skipInit: true, deferMount: true });
    expect(layout.item).toBe('one'); expect(loader).not.toHaveBeenCalled();
    const refresh = layout.refresh$('item'); await vi.waitFor(() => expect(loader).toHaveBeenCalledOnce());
    layout._frameworkHydrateNavigationResources({ ...state(2), metadata: { ...state(2).metadata, params: { id: 'next' } },
        serverResources: { item: { argsKey: '[2]', value: 'two' } } }, '/list', '/list?page=2');
    expect(layout.item).toBe('two'); expect(layout.request.param('id')).toBe('next');
    expect(layout.resourceStatus$('item')).toMatchObject({ state: 'ready', value: 'two' });
    if (settlement === 'resolve') resolve('obsolete'); else reject(new Error('obsolete'));
    await refresh;
    expect(layout.item).toBe('two'); expect(loader).toHaveBeenCalledOnce();
    expect(layout.resourceStatus$('item')).toMatchObject({ state: 'ready', value: 'two' });
    layout.destroy();
});

it('does not partially hand off URL or resources if SSR values are invalid', async () => {
    const component = new Draft();
    await component.bootstrap({ initialState: state(), skipInit: true, deferMount: true });
    expect(() => component._frameworkHydrateNavigationResources({ public: {}, serverResources: {
        invalid: { argsKey: '[]', value: new Map() },
    } }, '/list', '/list?page=2')).toThrow();
    expect(component.urlState(filters).page).toBe(1); component.destroy();
});

it('delegates typed patches with the source URL and a live component ownership check', async () => {
    const component = new Draft();
    await component.bootstrap({ initialState: state(), skipInit: true, deferMount: true });
    expect(await component.updateUrlState(filters, { page: 2 })).toMatchObject({ outcome: 'failed' });
    const owner = vi.fn(async (_source: string, build: (current: string) => string, live: () => boolean) => {
        expect(live()).toBe(true); expect(build('/list?other=keep&page=2')).toBe('/list?other=keep&page=3');
        return { outcome: 'completed' as const, url: '/list?other=keep&page=3' };
    });
    Cossack._onUpdateUrlState = owner;
    expect(await component.updateUrlState(filters, { page: 3 }, { history: 'replace' })).toMatchObject({ outcome: 'completed' });
    expect(owner.mock.calls[0][0]).toBe(new URL('/list?page=1', window.location.href).href);
    const live = owner.mock.calls[0][2]; component.destroy(); expect(live()).toBe(false);
    expect(await component.updateUrlState(filters, { page: 4 })).toMatchObject({ outcome: 'failed' }); expect(owner).toHaveBeenCalledOnce();
});
