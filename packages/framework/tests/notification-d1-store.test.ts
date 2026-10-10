import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createD1NotificationStore, notificationStateSchema, NotificationPersistenceError, type NotificationStateDatabase } from '../src/notifications/d1-store';
import type { NotificationRecord } from '@cossackframework/core/notifications';
function binding(db: DatabaseSync): NotificationStateDatabase {
  return { prepare(sql) { return { bind(...values) { const statement = db.prepare(sql); return {
    async first<T>() { return (statement.get(...values) ?? null) as T | null; },
    async all<T>() { return { results: statement.all(...values) as T[] }; },
    async run() { return { meta: { changes: Number(statement.run(...values).changes) } }; },
  }; } }; } };
}
function initial(id = 'notification-one', channel: NotificationRecord['channel'] = 'email', tenantId = 'tenant', userId = 'user'): NotificationRecord {
  return { id, key: (id === 'notification-one' ? 'a' : id === 'notification-two' ? 'b' : 'c').repeat(64), template: 'receipt', channel,
    recipient: { tenantId, userId, email: 'PRIVATE_EMAIL' }, content: { subject: 'Subject', text: 'PRIVATE_BODY', html: 'PRIVATE_HTML' as NotificationRecord['content']['html'] },
    data: { value: 'PRIVATE_DATA' }, status: 'queued', createdAt: 1000, updatedAt: 1000, attempt: 0, read: false };
}
async function fixture(run: (store: ReturnType<typeof createD1NotificationStore>, db: DatabaseSync) => Promise<void>) {
  const db = new DatabaseSync(':memory:'); db.exec(notificationStateSchema);
  try { await run(createD1NotificationStore(binding(db)), db); } finally { db.close(); }
}
it('deduplicates inserts, admits one concurrent claimant and fences stale ownership', async () => {
  await fixture(async store => {
    expect((await store.insert(initial())).created).toBe(true);
    expect((await store.insert({ ...initial(), id: 'another-id' })).created).toBe(false);
    const claims = await Promise.all([store.claim('notification-one', { now: 1000, leaseMs: 1000 }), store.claim('notification-one', { now: 1000, leaseMs: 1000 })]);
    expect(claims.map(claim => claim.status)).toEqual(['acquired','busy']);
    const first = claims[0]; if (first.status !== 'acquired') throw Error('Missing claim');
    const second = await store.claim('notification-one', { now: 2001, leaseMs: 1000 }); if (second.status !== 'acquired') throw Error('Missing reclaim');
    expect(second.record.attempt).toBe(2);
    expect(await store.beginSend('notification-one', first.token, { now: 2002, idempotency: 'none' })).toBe(false);
    expect(await store.finish('notification-one', first.token, { now: 2002, status: 'failed' })).toBe(false);
    expect(await store.beginSend('notification-one', second.token, { now: 2002, idempotency: 'none' })).toBe(true);
    expect(await store.finish('notification-one', second.token, { now: 2003, status: 'provider-accepted', messageId: 'provider-id' })).toBe(true);
    expect((await store.claim('notification-one', { now: 3000, leaseMs: 1000 })).status).toBe('terminal');
  });
});
it.each(['none','provider'] as const)('persists %s send uncertainty across real connection restart', async idempotency => {
  const directory = await mkdtemp(join(tmpdir(), 'cossack-notification-state-')); const file = join(directory, 'state.sqlite'); let db = new DatabaseSync(file);
  try {
    db.exec(notificationStateSchema); let store = createD1NotificationStore(binding(db)); await store.insert(initial());
    const first = await store.claim('notification-one', { now: 1000, leaseMs: 1000 }); if (first.status !== 'acquired') throw Error('Missing claim');
    expect(await store.beginSend('notification-one', first.token, { now: 1001, idempotency })).toBe(true);
    db.close(); db = new DatabaseSync(file); store = createD1NotificationStore(binding(db));
    const reclaimed = await store.claim('notification-one', { now: 2001, leaseMs: 1000 });
    if (idempotency === 'none') {
      expect(reclaimed).toMatchObject({ status: 'terminal', record: { status: 'unknown', code: 'NOTIFICATION_DELIVERY_UNKNOWN', attempt: 1 } });
      expect(await store.finish('notification-one', first.token, { now: 2002, status: 'provider-accepted' })).toBe(false);
    } else {
      expect(reclaimed).toMatchObject({ status: 'acquired', record: { attempt: 2 } });
      if (reclaimed.status !== 'acquired') throw Error('Missing reclaim');
      expect(await store.beginSend('notification-one', reclaimed.token, { now: 2002, idempotency: 'none' })).toBe(false);
      expect(await store.beginSend('notification-one', reclaimed.token, { now: 2002, idempotency: 'provider' })).toBe(true);
    }
  } finally { db.close(); await rm(directory, { recursive: true, force: true }); }
});
it('allows explicit rejected retry but blocks blind retry after unknown non-idempotent send', async () => {
  await fixture(async store => {
    await store.insert(initial()); let claim = await store.claim('notification-one', { now: 1000, leaseMs: 1000 }); if (claim.status !== 'acquired') throw Error('Missing claim');
    await store.beginSend('notification-one', claim.token, { now: 1001, idempotency: 'none' });
    expect(await store.finish('notification-one', claim.token, { now: 1002, status: 'queued', code: 'NOTIFICATION_DELIVERY_UNKNOWN' })).toBe(false);
    expect(await store.finish('notification-one', claim.token, { now: 1002, status: 'queued', code: 'NOTIFICATION_PROVIDER_REJECTED' })).toBe(true);
    claim = await store.claim('notification-one', { now: 1003, leaseMs: 1000 }); if (claim.status !== 'acquired') throw Error('Missing retry');
    await store.beginSend('notification-one', claim.token, { now: 1004, idempotency: 'provider' });
    expect(await store.finish('notification-one', claim.token, { now: 1005, status: 'queued', code: 'NOTIFICATION_DELIVERY_UNKNOWN' })).toBe(true);
    const recovered = await store.claim('notification-one', { now: 1006, leaseMs: 1000 });
    expect(recovered).toMatchObject({ status: 'acquired', sending: 'provider' });
    if (recovered.status !== 'acquired') throw Error('Missing recovery');
    expect(await store.beginSend('notification-one', recovered.token, { now: 1007, idempotency: 'none' })).toBe(false);
  });
});
it('requires matching trusted provider evidence and retains terminal acceptance after restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cossack-notification-terminal-')); const file = join(directory, 'state.sqlite'); let db = new DatabaseSync(file);
  try {
    db.exec(notificationStateSchema); let store = createD1NotificationStore(binding(db)); await store.insert(initial());
    const claim = await store.claim('notification-one', { now: 1000, leaseMs: 1000 }); if (claim.status !== 'acquired') throw Error('Missing claim');
    expect(await store.finish('notification-one', claim.token, { now: 1001, status: 'delivered' })).toBe(false);
    await store.beginSend('notification-one', claim.token, { now: 1001, idempotency: 'none' });
    await store.finish('notification-one', claim.token, { now: 1002, status: 'provider-accepted', messageId: 'provider-id' });
    db.close(); db = new DatabaseSync(file); store = createD1NotificationStore(binding(db));
    expect((await store.get('notification-one'))?.status).toBe('provider-accepted');
    expect(await store.recordDelivered('notification-one', 'wrong-id', 1003)).toBe(false);
    expect(await store.recordDelivered('notification-one', 'provider-id', 1003)).toBe(true);
    expect((await store.get('notification-one'))?.status).toBe('delivered');
  } finally { db.close(); await rm(directory, { recursive: true, force: true }); }
});
it('isolates delivered in-app notifications and read state by tenant and user', async () => {
  await fixture(async store => {
    for (const value of [initial('notification-one','in-app'), initial('notification-two','in-app','tenant','other-user'), initial('notification-three','in-app','other-tenant','user')]) {
      await store.insert(value); const claim = await store.claim(value.id, { now: 1000, leaseMs: 1000 }); if (claim.status !== 'acquired') throw Error('Missing claim');
      expect(await store.finish(value.id, claim.token, { now: 1001, status: 'delivered' })).toBe(true);
    }
    const owner = { tenantId: 'tenant', userId: 'user' };
    expect((await store.list(owner, { limit: 10 })).map(item => item.id)).toEqual(['notification-one']);
    expect(await store.setRead('notification-two', owner, true)).toBe(false);
    expect(await store.setRead('notification-three', owner, true)).toBe(false);
    expect(await store.setRead('notification-one', owner, true)).toBe(true);
    expect((await store.list(owner, { limit: 10 }))[0]?.read).toBe(true);
    expect(await store.setRead('notification-one', owner, false)).toBe(true);
    expect((await store.list(owner, { limit: 10 }))[0]?.read).toBe(false);
  });
});
it('never creates schema from reads and redacts persistence errors', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    const store = createD1NotificationStore(binding(db));
    await expect(store.list({ tenantId: 'PRIVATE_TENANT', userId: 'PRIVATE_USER' }, { limit: 10 })).rejects.toBeInstanceOf(NotificationPersistenceError);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name='cossack_notifications'").get()).toBeUndefined();
  } finally { db.close(); }
  const store = createD1NotificationStore({ prepare() { throw Error('PRIVATE_DRIVER_SECRET'); } });
  const error = await store.get('id').catch(error => error);
  expect(error.message).toBe('Notification persistence failed.'); expect(JSON.stringify(error)).not.toContain('PRIVATE_');
});

it('integrates safe rejected retries and unknown no-resend behavior with the durable runtime', async () => {
  const { createNotificationRuntime, defineNotificationTemplate, NotificationDeliveryError } = await import('@cossackframework/core/notifications');
  await fixture(async store => {
    let sends = 0; let uncertain = false;
    const runtime = createNotificationRuntime({ namespace: 'integration', store, dispatch: async () => {}, preferences: () => true, now: () => 1000,
      templates: { receipt: defineNotificationTemplate({ schema: { async parse(value: unknown) { return value as { value: string }; } },
        render(data) { return { subject: 'Receipt', text: data.value, html: data.value as NotificationRecord['content']['html'] }; } }) },
      email: { from: 'sender@example.test', provider: { idempotency: 'none', async send() {
        sends++; if (uncertain) throw Error('PRIVATE_TRANSPORT_ERROR');
        if (sends === 1) throw new NotificationDeliveryError('rejected', { retryable: true });
        return { status: 'provider-accepted', messageId: 'provider-id' };
      } } },
    });
    const first = await runtime.enqueue('receipt', { value: 'PRIVATE_BODY' }, { channel: 'email', recipient: { tenantId: 'tenant', userId: 'user', email: 'user@example.test' }, idempotencyKey: 'receipt-1' });
    await expect(runtime.deliver(first.id!)).rejects.toThrow('another attempt');
    expect(await runtime.deliver(first.id!)).toMatchObject({ status: 'provider-accepted', attempt: 2 });
    expect(await runtime.deliver(first.id!)).toMatchObject({ status: 'provider-accepted' }); expect(sends).toBe(2);
    uncertain = true;
    const second = await runtime.enqueue('receipt', { value: 'PRIVATE_BODY' }, { channel: 'email', recipient: { tenantId: 'tenant', userId: 'user', email: 'user@example.test' }, idempotencyKey: 'receipt-2' });
    expect(await runtime.deliver(second.id!)).toMatchObject({ status: 'unknown', code: 'NOTIFICATION_DELIVERY_UNKNOWN' });
    expect(await runtime.deliver(second.id!)).toMatchObject({ status: 'unknown' }); expect(sends).toBe(3);
    expect(JSON.stringify(await runtime.inspect(second.id!))).not.toContain('PRIVATE_');
  });
});

it('keeps previous send uncertainty truthful when preferences disable delivery after recovery', async () => {
  const { createNotificationRuntime } = await import('@cossackframework/core/notifications');
  await fixture(async store => {
    await store.insert(initial());
    const claim = await store.claim('notification-one', { now: 1000, leaseMs: 1000 }); if (claim.status !== 'acquired') throw Error('Missing claim');
    await store.beginSend('notification-one', claim.token, { now: 1001, idempotency: 'provider' });
    let sends = 0;
    const runtime = createNotificationRuntime({ namespace: 'integration', store, dispatch: async () => {}, preferences: () => false, now: () => 2001,
      templates: { receipt: { schema: { async parse(value: unknown) { return value; } }, render() { return initial().content; } } },
      email: { from: 'sender@example.test', provider: { idempotency: 'provider', async send() { sends++; return { status: 'provider-accepted', messageId: 'id' }; } } },
    });
    expect(await runtime.deliver('notification-one')).toMatchObject({ status: 'unknown', code: 'NOTIFICATION_DELIVERY_UNKNOWN' });
    expect(sends).toBe(0);
  });
});

it.each([false, true])('does not erase earlier provider uncertainty after a current rejection, retryable=%s', async retryable => {
  const { createNotificationRuntime, NotificationDeliveryError } = await import('@cossackframework/core/notifications');
  await fixture(async store => {
    await store.insert({ ...initial(), recipient: { tenantId: 'tenant', userId: 'user', email: 'user@example.test' } });
    const first = await store.claim('notification-one', { now: 1000, leaseMs: 1000 }); if (first.status !== 'acquired') throw Error('Missing first claim');
    await store.beginSend('notification-one', first.token, { now: 1001, idempotency: 'provider' });
    const runtime = createNotificationRuntime({ namespace: 'integration', store, dispatch: async () => {}, preferences: () => true, now: () => 2001,
      templates: { receipt: { schema: { async parse(value: unknown) { return value; } }, render() { return initial().content; } } },
      email: { from: 'sender@example.test', provider: { idempotency: 'provider', async send() { throw new NotificationDeliveryError('rejected', { retryable }); } } },
    });
    if (retryable) await expect(runtime.deliver('notification-one')).rejects.toThrow('another attempt');
    else expect(await runtime.deliver('notification-one')).toMatchObject({ status: 'unknown', code: 'NOTIFICATION_DELIVERY_UNKNOWN' });
    expect(await store.get('notification-one')).toMatchObject({ status: retryable ? 'queued' : 'unknown', code: 'NOTIFICATION_DELIVERY_UNKNOWN' });
    if (retryable) expect(await store.claim('notification-one', { now: 2002, leaseMs: 1000 })).toMatchObject({ status: 'acquired', sending: 'provider' });
  });
});
