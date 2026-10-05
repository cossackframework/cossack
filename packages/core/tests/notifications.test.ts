// @vitest-environment node
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { input } from '../src/input';
import { createJobRuntime, defineJob, LocalJobAdapter, MemoryJobStore, TransientJobError } from '../src/jobs';
import { createNotificationRuntime, defineNotificationTemplate, escapeNotificationHtml, notificationHtml, MemoryNotificationStore, NotificationDeliveryError, type EmailDeliveryProvider, type NotificationRecord, type NotificationFinish } from '../src/notifications';
const recipient = { tenantId: 'tenant-a', userId: 'user-a', email: 'ada@example.com' };
const template = defineNotificationTemplate({ schema: input.object({ name: input.string() }), render: data => ({ subject: 'Welcome', text: `Hello ${data.name}`, html: notificationHtml`<p>Hello ${data.name}</p>` }) });
function fixture(config: { provider?: EmailDeliveryProvider; store?: MemoryNotificationStore; maxAttempts?: number } = {}) {
    let time = 0, enabled = true;
    const provider: EmailDeliveryProvider = config.provider ?? { idempotency: 'none', send: vi.fn<EmailDeliveryProvider['send']>(async () => ({ status: 'provider-accepted', messageId: 'receipt-a' })) };
    const store = config.store ?? new MemoryNotificationStore(), dispatch = vi.fn(async () => {}), preferences = vi.fn(async () => enabled);
    const runtime = createNotificationRuntime({ namespace: 'test', templates: { welcome: template }, store, dispatch, preferences, email: { from: 'sender@example.com', provider }, now: () => time, leaseMs: 1000, maxAttempts: config.maxAttempts });
    const enqueue = (channel: 'email' | 'in-app' = 'email', key = 'first', target = recipient) => runtime.enqueue('welcome', { name: 'Ada' }, { recipient: target, channel, idempotencyKey: key });
    return { runtime, store, provider, preferences, dispatch, enqueue, disable: () => { enabled = false; }, advance: (milliseconds: number) => { time += milliseconds; } };
}
describe('notification rendering and preferences', () => {
    it('escapes interpolations and previews without provider, jobs, or persistence writes', async () => {
        const app = fixture(); const content = await app.runtime.preview('welcome', { name: '<img src=x onerror="alert(1)">&\'' });
        expect(content.html).toBe('<p>Hello &lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;&#39;</p>');
        expect(escapeNotificationHtml('<>&"\'')).toBe('&lt;&gt;&amp;&quot;&#39;'); expect(app.dispatch).not.toHaveBeenCalled(); expect(app.provider.send).not.toHaveBeenCalled(); expect(app.store.snapshot()).toEqual([]);
    });
    it('rejects array accessors, custom map, holes and hidden keys without side effects or publication', async () => {
        const app = fixture(), getter = vi.fn(() => 'PRIVATE_GETTER_VALUE'), map = vi.fn(() => []);
        const parse = vi.fn(async (value: unknown) => value);
        const service = createNotificationRuntime({ namespace: 'validation', templates: { raw: defineNotificationTemplate({ schema: { parse }, render: () => ({ subject: 'Safe', text: 'Safe', html: notificationHtml`<p>Safe</p>` }) }) }, store: app.store, dispatch: app.dispatch, preferences: app.preferences, email: { from: 'sender@example.com', provider: app.provider } });
        const accessor: unknown[] = ['safe']; Object.defineProperty(accessor, '0', { get: getter, enumerable: true });
        const overridden: unknown[] = ['safe']; Object.defineProperty(overridden, 'map', { value: map, enumerable: true });
        const sparse = new Array(1);
        const extra: unknown[] = ['safe']; Object.defineProperty(extra, 'extra', { value: 'PRIVATE_EXTRA', enumerable: true });
        const symbol: unknown[] = ['safe']; Object.defineProperty(symbol, Symbol('hidden'), { value: 'PRIVATE_SYMBOL' });
        const hidden = { name: 'Ada' }; Object.defineProperty(hidden, 'private', { value: 'PRIVATE_HIDDEN', enumerable: false });
        for (const data of [accessor, overridden, sparse, extra, symbol, hidden]) {
            await expect(service.preview('raw', data)).rejects.toThrow('Notification configuration or input is invalid.');
            await expect(service.enqueue('raw', data, { recipient, channel: 'email' })).rejects.toThrow('Notification configuration or input is invalid.');
        }
        expect(parse).not.toHaveBeenCalled(); expect(getter).not.toHaveBeenCalled(); expect(map).not.toHaveBeenCalled(); expect(app.dispatch).not.toHaveBeenCalled(); expect(app.provider.send).not.toHaveBeenCalled(); expect(app.store.snapshot()).toEqual([]);
    });
    it('accepts dense plain arrays and omits enumerable undefined object fields', async () => {
        const schema = input.object({ names: input.array(input.string()), note: input.string().optional() });
        const service = createNotificationRuntime({ namespace: 'arrays', templates: { names: defineNotificationTemplate({ schema, render: data => ({ subject: 'Names', text: data.names.join(', '), html: notificationHtml`<p>${data.names.join(', ')}</p>` }) }) }, store: new MemoryNotificationStore(), dispatch: async () => {}, preferences: () => true });
        expect(await service.preview('names', { names: ['Ada', '<Grace>'], note: undefined })).toMatchObject({ text: 'Ada, <Grace>', html: '<p>Ada, &lt;Grace&gt;</p>' });
    });
    it('respects opt-out both before enqueue and while queued', async () => {
        const disabled = fixture(); disabled.disable(); expect(await disabled.enqueue()).toEqual({ status: 'suppressed' }); expect(disabled.dispatch).not.toHaveBeenCalled(); expect(disabled.store.snapshot()).toEqual([]);
        const app = fixture(); const queued = await app.enqueue(); app.disable();
        expect(await app.runtime.deliver(queued.id!)).toMatchObject({ status: 'failed', code: 'NOTIFICATION_PREFERENCE_DISABLED' });
        expect(app.preferences).toHaveBeenCalledTimes(2); expect(app.provider.send).not.toHaveBeenCalled();
    });
    it('redacts schema/render failures and preserves precise template data types', async () => {
        const app = fixture();
        if (false) {
            // @ts-expect-error unknown template
            await app.runtime.preview('missing', { name: 'Ada' });
            // @ts-expect-error wrong template payload
            await app.runtime.enqueue('welcome', { name: 1 }, { recipient, channel: 'email' });
        }
        expectTypeOf(await app.runtime.preview('welcome', { name: 'Ada' })).toEqualTypeOf<{ subject: string; text: string; html: ReturnType<typeof notificationHtml> }>();
        await expect(app.runtime.preview('welcome', { name: 123 } as never)).rejects.toThrow('Notification configuration or input is invalid.');
    });
});
describe('notification delivery state and jobs', () => {
    it('distinguishes provider acceptance from actual trusted delivery evidence', async () => {
        const app = fixture(); const queued = await app.enqueue(); expect(queued.status).toBe('queued');
        expect(await app.runtime.deliver(queued.id!)).toMatchObject({ status: 'provider-accepted', attempt: 1 });
        expect(await app.runtime.deliver(queued.id!)).toMatchObject({ status: 'provider-accepted' }); expect(app.provider.send).toHaveBeenCalledOnce();
        expect(await app.runtime.recordDelivered(queued.id!, { messageId: 'wrong' })).toBe(false);
        expect(await app.runtime.recordDelivered(queued.id!, { messageId: 'receipt-a' })).toBe(true);
        expect(await app.runtime.inspect(queued.id!)).toMatchObject({ status: 'delivered' });
        const inspected = JSON.stringify(await app.runtime.inspect(queued.id!)); expect(inspected).not.toContain('Ada'); expect(inspected).not.toContain('example.com'); expect(inspected).not.toContain('receipt-a');
    });
    it('retries known pre-accept rejection but never blind retries uncertain non-idempotent mail', async () => {
        const send = vi.fn().mockRejectedValueOnce(new NotificationDeliveryError('rejected', { retryable: true })).mockResolvedValue({ status: 'provider-accepted' });
        const app = fixture({ provider: { idempotency: 'none', send } }); const queued = await app.enqueue();
        await expect(app.runtime.deliver(queued.id!)).rejects.toBeInstanceOf(TransientJobError); expect(await app.runtime.inspect(queued.id!)).toMatchObject({ status: 'queued', code: 'NOTIFICATION_PROVIDER_REJECTED' });
        expect(await app.runtime.deliver(queued.id!)).toMatchObject({ status: 'provider-accepted' }); expect(send).toHaveBeenCalledTimes(2);
        expect(send.mock.calls[0][1].idempotencyKey).toBe(send.mock.calls[1][1].idempotencyKey);
        const uncertain = fixture({ provider: { idempotency: 'none', send: vi.fn(async () => { throw new Error('PRIVATE_PROVIDER_VALUE'); }) } }); const unknown = await uncertain.enqueue();
        expect(await uncertain.runtime.deliver(unknown.id!)).toMatchObject({ status: 'unknown', code: 'NOTIFICATION_DELIVERY_UNKNOWN' });
        await uncertain.runtime.deliver(unknown.id!); expect(uncertain.provider.send).toHaveBeenCalledOnce(); expect(JSON.stringify(await uncertain.runtime.inspect(unknown.id!))).not.toContain('PRIVATE_PROVIDER_VALUE');
    });
    it('allows provider-enforced idempotency to recover an uncertain reply without duplicating acceptance', async () => {
        const accepted = new Set<string>(); let calls = 0;
        const provider: EmailDeliveryProvider = { idempotency: 'provider', send: vi.fn<EmailDeliveryProvider['send']>(async (_message, context) => { accepted.add(context.idempotencyKey); if (++calls === 1) throw new NotificationDeliveryError('unknown'); return { status: 'provider-accepted' }; }) };
        const app = fixture({ provider }); const queued = await app.enqueue(); await expect(app.runtime.deliver(queued.id!)).rejects.toBeInstanceOf(TransientJobError);
        expect(await app.runtime.deliver(queued.id!)).toMatchObject({ status: 'provider-accepted' }); expect(provider.send).toHaveBeenCalledTimes(2); expect(accepted.size).toBe(1);
    });
    it('keeps prior uncertainty truthful when preferences change and cannot downgrade provider capabilities', async () => {
        const provider: EmailDeliveryProvider = { idempotency: 'provider', send: vi.fn(async () => { throw new NotificationDeliveryError('unknown'); }) };
        const app = fixture({ provider }); const queued = await app.enqueue();
        await expect(app.runtime.deliver(queued.id!)).rejects.toBeInstanceOf(TransientJobError);
        const disabled = fixture({ store: new MemoryNotificationStore(app.store.snapshot()), provider }); disabled.disable();
        expect(await disabled.runtime.deliver(queued.id!)).toMatchObject({ status: 'unknown' }); expect(provider.send).toHaveBeenCalledOnce();
        const downgradedProvider: EmailDeliveryProvider = { idempotency: 'none', send: vi.fn<EmailDeliveryProvider['send']>(async () => ({ status: 'provider-accepted' })) };
        const downgraded = fixture({ store: new MemoryNotificationStore(app.store.snapshot()), provider: downgradedProvider });
        expect(await downgraded.runtime.deliver(queued.id!)).toMatchObject({ status: 'unknown' }); expect(downgradedProvider.send).not.toHaveBeenCalled();
    });
    it('retains uncertainty when a recovery provider or email address is removed', async () => {
        const provider: EmailDeliveryProvider = { idempotency: 'provider', send: vi.fn(async () => { throw new NotificationDeliveryError('unknown'); }) };
        const app = fixture({ provider }); const queued = await app.enqueue(); await expect(app.runtime.deliver(queued.id!)).rejects.toBeInstanceOf(TransientJobError);
        const removed = createNotificationRuntime({ namespace: 'test', templates: { welcome: template }, store: new MemoryNotificationStore(app.store.snapshot()), dispatch: async () => {}, preferences: () => true });
        expect(await removed.deliver(queued.id!)).toMatchObject({ status: 'unknown', code: 'NOTIFICATION_DELIVERY_UNKNOWN' });
        const snapshot = structuredClone(app.store.snapshot()); delete snapshot[0][1].record.recipient.email;
        const noAddress = fixture({ store: new MemoryNotificationStore(snapshot), provider });
        expect(await noAddress.runtime.deliver(queued.id!)).toMatchObject({ status: 'unknown', code: 'NOTIFICATION_DELIVERY_UNKNOWN' }); expect(provider.send).toHaveBeenCalledOnce();
    });
    it('a later rejection preserves prior uncertainty and safe retry eligibility through the attempt limit', async () => {
        const original: EmailDeliveryProvider = { idempotency: 'provider', send: vi.fn(async () => { throw new NotificationDeliveryError('unknown'); }) };
        const app = fixture({ provider: original }); const queued = await app.enqueue(); await expect(app.runtime.deliver(queued.id!)).rejects.toBeInstanceOf(TransientJobError);
        const terminalProvider: EmailDeliveryProvider = { idempotency: 'provider', send: vi.fn(async () => { throw new NotificationDeliveryError('rejected'); }) };
        const terminal = fixture({ store: new MemoryNotificationStore(app.store.snapshot()), provider: terminalProvider });
        expect(await terminal.runtime.deliver(queued.id!)).toMatchObject({ status: 'unknown', code: 'NOTIFICATION_DELIVERY_UNKNOWN' }); await terminal.runtime.deliver(queued.id!); expect(terminalProvider.send).toHaveBeenCalledOnce();
        const retryProvider: EmailDeliveryProvider = { idempotency: 'provider', send: vi.fn(async () => { throw new NotificationDeliveryError('rejected', { retryable: true }); }) };
        const retry = fixture({ store: new MemoryNotificationStore(app.store.snapshot()), provider: retryProvider, maxAttempts: 3 });
        await expect(retry.runtime.deliver(queued.id!)).rejects.toBeInstanceOf(TransientJobError); expect(await retry.runtime.inspect(queued.id!)).toMatchObject({ status: 'queued', code: 'NOTIFICATION_DELIVERY_UNKNOWN', attempt: 2 });
        expect(await retry.runtime.deliver(queued.id!)).toMatchObject({ status: 'unknown', code: 'NOTIFICATION_DELIVERY_UNKNOWN', attempt: 3 }); expect(retryProvider.send).toHaveBeenCalledTimes(2);
        const calls = vi.mocked(retryProvider.send).mock.calls; expect(calls[0][1].idempotencyKey).toBe(calls[1][1].idempotencyKey);
    });
    it('survives crash after provider acceptance without sending non-idempotent mail twice', async () => {
        class CrashStore extends MemoryNotificationStore { override async finish(_id: string, _token: string, _result: NotificationFinish): Promise<boolean> { throw new Error('Simulated commit failure'); } }
        const original = fixture({ store: new CrashStore() }); const queued = await original.enqueue(); await expect(original.runtime.deliver(queued.id!)).rejects.toThrow('Simulated commit failure'); expect(original.provider.send).toHaveBeenCalledOnce();
        const restarted = fixture({ store: new MemoryNotificationStore(original.store.snapshot()), provider: original.provider }); restarted.advance(1001);
        expect(await restarted.runtime.deliver(queued.id!)).toMatchObject({ status: 'unknown' }); expect(original.provider.send).toHaveBeenCalledOnce();
    });
    it('fences concurrent delivery and expired ownership before any provider effect', async () => {
        let resolve!: (value: { status: 'provider-accepted' }) => void;
        const app = fixture({ provider: { idempotency: 'none', send: vi.fn(() => new Promise<{ status: 'provider-accepted' }>(done => { resolve = done; })) } }); const queued = await app.enqueue();
        const first = app.runtime.deliver(queued.id!); await vi.waitFor(() => expect(app.provider.send).toHaveBeenCalledOnce());
        await expect(app.runtime.deliver(queued.id!)).rejects.toBeInstanceOf(TransientJobError);
        app.advance(1001); expect(await app.runtime.deliver(queued.id!)).toMatchObject({ status: 'unknown' }); resolve({ status: 'provider-accepted' }); await expect(first).rejects.toBeInstanceOf(TransientJobError); expect(app.provider.send).toHaveBeenCalledOnce();
        const fresh = fixture(); const record = await fresh.enqueue(); const a = await fresh.store.claim(record.id!, { now: 0, leaseMs: 1000 }); expect(a.status).toBe('acquired');
        const b = await fresh.store.claim(record.id!, { now: 1001, leaseMs: 1000 }); expect(b.status).toBe('acquired');
        if (a.status === 'acquired') { expect(await fresh.store.beginSend(record.id!, a.token, { now: 1001, idempotency: 'none' })).toBe(false); expect(await fresh.store.finish(record.id!, a.token, { now: 1001, status: 'delivered' })).toBe(false); }
    });
    it('uses existing jobs for retry and suppresses duplicate logical enqueue identities', async () => {
        const queue = new LocalJobAdapter(); const jobStore = new MemoryJobStore(); const notifications = new MemoryNotificationStore();
        const send = vi.fn().mockRejectedValueOnce(new NotificationDeliveryError('rejected', { retryable: true })).mockResolvedValue({ status: 'provider-accepted' });
        const service = createNotificationRuntime({ namespace: 'jobs', templates: { welcome: template }, store: notifications, preferences: () => true,
            email: { from: 'sender@example.com', provider: { idempotency: 'none', send } }, now: queue.now,
            dispatch: (id, recipient) => jobs.dispatch('notify', { id }, { scope: { tenantId: recipient.tenantId, actorId: recipient.userId }, idempotencyKey: id }) });
        const jobs = createJobRuntime({ namespace: 'notification-jobs', adapter: queue, store: jobStore, now: queue.now,
            jobs: { notify: defineJob({ schema: input.object({ id: input.string() }), handle: async payload => { await service.deliver(payload.id); }, retryDelaySeconds: 1 }) } });
        const a = await service.enqueue('welcome', { name: 'Ada' }, { recipient, channel: 'email', idempotencyKey: 'welcome-event' });
        const b = await service.enqueue('welcome', { name: 'Ada' }, { recipient, channel: 'email', idempotencyKey: 'welcome-event' }); expect(a.id).toBe(b.id);
        const first = await queue.drain(jobs); expect(first.some(result => result.status === 'retry')).toBe(true); queue.advance(1); await queue.drain(jobs);
        expect(await service.inspect(a.id!)).toMatchObject({ status: 'provider-accepted' }); expect(send).toHaveBeenCalledTimes(2);
    });
    it('recovers failed publication by republishing the same immutable intent', async () => {
        const app = fixture(); app.dispatch.mockRejectedValueOnce(new Error('Publish unavailable'));
        await expect(app.enqueue()).rejects.toThrow('Publish unavailable');
        const persisted = app.store.snapshot()[0][1].record; const retry = await app.enqueue();
        expect(retry.id).toBe(persisted.id); expect(app.store.snapshot()).toHaveLength(1); expect(app.dispatch).toHaveBeenCalledTimes(2);
        await expect(app.runtime.enqueue('welcome', { name: 'Changed' }, { recipient, channel: 'email', idempotencyKey: 'first' })).rejects.toThrow('idempotency identity conflicts');
    });
    it('rejects untrusted receipt accessors and handles optional missing message IDs', async () => {
        const getter = vi.fn(() => { throw new Error('PRIVATE_RECEIPT_VALUE'); });
        const response = Object.defineProperty({}, 'status', { get: getter });
        const bad = fixture({ provider: { idempotency: 'none', send: vi.fn(async () => response as never) } }); const pending = await bad.enqueue();
        expect(await bad.runtime.deliver(pending.id!)).toMatchObject({ status: 'unknown' }); expect(getter).not.toHaveBeenCalled();
        const good = fixture({ provider: { idempotency: 'none', send: vi.fn<EmailDeliveryProvider['send']>(async () => ({ status: 'provider-accepted', messageId: undefined })) } });
        const queued = await good.enqueue(); expect(await good.runtime.deliver(queued.id!)).toMatchObject({ status: 'provider-accepted' });
    });
    it('keeps tenant, user, channel, and namespace in logical identities', async () => {
        const app = fixture(); const email = await app.enqueue('email'); const inbox = await app.enqueue('in-app'); expect(email.id).not.toBe(inbox.id);
        const other = createNotificationRuntime({ namespace: 'another', templates: { welcome: template }, store: app.store, dispatch: async () => {}, preferences: () => true });
        const separate = await other.enqueue('welcome', { name: 'Ada' }, { recipient, channel: 'in-app', idempotencyKey: 'first' });
        expect(separate.id).not.toBe(inbox.id);
    });
    it('caps safe retries and records permanent provider rejection', async () => {
        const app = fixture({ maxAttempts: 1, provider: { idempotency: 'none', send: vi.fn(async () => { throw new NotificationDeliveryError('rejected', { retryable: true }); }) } });
        const queued = await app.enqueue(); expect(await app.runtime.deliver(queued.id!)).toMatchObject({ status: 'failed', code: 'NOTIFICATION_PROVIDER_REJECTED' });
        await app.runtime.deliver(queued.id!); expect(app.provider.send).toHaveBeenCalledOnce();
    });
});
describe('tenant and user inbox ownership', () => {
    it('isolates in-app notifications and read/unread transitions by exact server recipient', async () => {
        const app = fixture(); const own = await app.enqueue('in-app'); const otherUser = await app.enqueue('in-app', 'first', { ...recipient, userId: 'user-b' }); const otherTenant = await app.enqueue('in-app', 'first', { ...recipient, tenantId: 'tenant-b' });
        expect(new Set([own.id, otherUser.id, otherTenant.id]).size).toBe(3);
        expect(await app.runtime.list(recipient)).toEqual([]);
        await app.runtime.deliver(own.id!); await app.runtime.deliver(otherUser.id!); await app.runtime.deliver(otherTenant.id!);
        expect((await app.runtime.list(recipient)).map(item => item.id)).toEqual([own.id]);
        expect(await app.runtime.setRead(own.id!, { tenantId: recipient.tenantId, userId: 'user-b' }, true)).toBe(false);
        expect(await app.runtime.setRead(own.id!, { tenantId: 'tenant-b', userId: recipient.userId }, true)).toBe(false);
        expect(await app.runtime.setRead(own.id!, recipient, true)).toBe(true); expect((await app.runtime.list(recipient))[0].read).toBe(true);
        expect(await app.runtime.setRead(own.id!, recipient, false)).toBe(true); expect((await app.runtime.list(recipient))[0].read).toBe(false);
        expect(app.provider.send).not.toHaveBeenCalled();
        const restored = fixture({ store: new MemoryNotificationStore(app.store.snapshot()) }); expect((await restored.runtime.list(recipient))[0].read).toBe(false);
    });
});
