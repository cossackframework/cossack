import { expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const repository = fileURLToPath(new URL('../../../', import.meta.url));
const source = String.raw`
import assert from 'node:assert/strict';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createNodeEmailSender } from '@cossackframework/node-adapter';
import { createSmtpNotificationEmailProvider } from '@cossackframework/node-adapter/notifications';
import { createNotificationRuntime, defineNotificationTemplate, notificationHtml } from '@cossackframework/core/notifications';
import { input } from '@cossackframework/core/input';
import { createD1NotificationStore, notificationStateSchema } from '@cossackframework/framework/notifications';
let connections = 0, accepted = 0, dataCommands = 0, rejectOnce = true, ambiguous = false;
const sockets = new Set();
const server = net.createServer(socket => {
  connections++; sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {});
  socket.setTimeout(2000, () => socket.destroy());
  socket.write('220 loopback.smtp.test ESMTP\r\n');
  let buffer = '', receivingData = false;
  socket.on('data', chunk => {
    buffer += chunk.toString('utf8');
    while (buffer.includes('\r\n')) {
      const end = buffer.indexOf('\r\n'); const line = buffer.slice(0, end); buffer = buffer.slice(end + 2);
      if (receivingData) {
        if (line === '.') { receivingData = false; accepted++; if (ambiguous) socket.destroy(); else socket.write('250 2.0.0 accepted\r\n'); }
        continue;
      }
      const command = line.toUpperCase();
      if (command.startsWith('EHLO') || command.startsWith('HELO')) socket.write('250-loopback.smtp.test\r\n250 AUTH PLAIN\r\n');
      else if (command.startsWith('AUTH PLAIN')) socket.write('235 2.7.0 authenticated\r\n');
      else if (command.startsWith('MAIL FROM')) socket.write('250 2.1.0 sender accepted\r\n');
      else if (command.startsWith('RCPT TO')) {
        if (rejectOnce) { rejectOnce = false; socket.write('450 4.2.0 temporary recipient rejection\r\n'); }
        else socket.write('250 2.1.5 recipient accepted\r\n');
      } else if (command === 'DATA') { dataCommands++; receivingData = true; socket.write('354 end with dot\r\n'); }
      else if (command === 'QUIT') socket.end('221 goodbye\r\n');
      else socket.write('250 OK\r\n');
    }
  });
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const databaseFile = fileURLToPath(new URL('./notification-state.sqlite', import.meta.url));
let database = new DatabaseSync(databaseFile); database.exec(notificationStateSchema);
function binding() {
  return { prepare(sql) { return { bind(...values) { const statement = database.prepare(sql); return {
    async first() { return statement.get(...values) ?? null; }, async all() { return { results: statement.all(...values) }; },
    async run() { return { meta: { changes: Number(statement.run(...values).changes) } }; },
  }; } }; } };
}
const provider = createSmtpNotificationEmailProvider(createNodeEmailSender({
  host: '127.0.0.1', port: server.address().port, secure: false, auth: { user: 'fixture-user', pass: 'fixture-password' },
}));
const templates = { receipt: defineNotificationTemplate({ schema: input.object({ name: input.string({ required: true }) }),
  render(data) { return { subject: 'Receipt', text: data.name, html: notificationHtml(['<p>', '</p>'], data.name) }; },
}) };
function runtime() {
  return createNotificationRuntime({ namespace: 'smtp-acceptance', templates, store: createD1NotificationStore(binding()),
    preferences: () => true, dispatch: async () => {}, email: { provider, from: 'sender@example.test' },
  });
}
const recipient = { tenantId: 'tenant', userId: 'user', email: 'recipient@example.test' };
try {
  let service = runtime();
  assert.equal(provider.idempotency, 'none');
  const preview = await service.preview('receipt', { name: '<private-content>' });
  assert.equal(preview.html, '<p>&lt;private-content&gt;</p>');
  assert.equal(connections, 0); assert.equal(accepted, 0);
  const first = await service.enqueue('receipt', { name: 'first' }, { recipient, channel: 'email', idempotencyKey: 'first' });
  await assert.rejects(service.deliver(first.id), /another attempt/);
  assert.equal((await service.inspect(first.id)).code, 'NOTIFICATION_PROVIDER_REJECTED');
  assert.equal(dataCommands, 0); assert.equal(accepted, 0);
  assert.equal((await service.deliver(first.id)).status, 'provider-accepted');
  assert.equal(accepted, 1); assert.equal(dataCommands, 1);
  assert.equal((await service.deliver(first.id)).status, 'provider-accepted');
  const duplicate = await service.enqueue('receipt', { name: 'first' }, { recipient, channel: 'email', idempotencyKey: 'first' });
  assert.equal(duplicate.id, first.id); assert.equal(accepted, 1);
  ambiguous = true;
  const second = await service.enqueue('receipt', { name: 'second' }, { recipient, channel: 'email', idempotencyKey: 'second' });
  assert.equal((await service.deliver(second.id)).status, 'unknown');
  assert.equal(accepted, 2); assert.equal(dataCommands, 2);
  database.close(); database = new DatabaseSync(databaseFile); service = runtime();
  assert.equal((await service.deliver(second.id)).status, 'unknown');
  assert.equal((await service.deliver(first.id)).status, 'provider-accepted');
  assert.equal(accepted, 2); assert.equal(dataCommands, 2);
  const inspection = await service.inspect(second.id);
  assert.equal(inspection.code, 'NOTIFICATION_DELIVERY_UNKNOWN');
  assert.equal(JSON.stringify(inspection).includes('recipient@example.test'), false);
  console.log(JSON.stringify({ passed: true, accepted, dataCommands, rejectedBeforeData: true, restartNoResend: true }));
} finally {
  database.close(); for (const socket of sockets) socket.destroy();
  await new Promise(resolve => server.close(resolve));
}
`;
it('uses real loopback SMTP for rejection, acceptance, duplicate suppression and uncertain restart', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cossack-smtp-notification-acceptance-'));
  try {
    await fs.writeFile(path.join(root, 'package.json'), '{"type":"module"}');
    const modules = path.join(root, 'node_modules', '@cossackframework'); await fs.mkdir(modules, { recursive: true });
    for (const name of ['core','renderer','node-adapter','framework']) {
      const target = process.env.COSSACK_NOTIFICATIONS_INSTALLED_ROOT
        ? path.join(path.resolve(process.env.COSSACK_NOTIFICATIONS_INSTALLED_ROOT), 'node_modules', '@cossackframework', name)
        : path.join(repository, 'packages', name);
      await fs.access(path.join(target, 'package.json'));
      await fs.symlink(target, path.join(modules, name), 'junction');
    }
    const runner = path.join(root, 'acceptance.mjs'); await fs.writeFile(runner, source);
    const result = await promisify(execFile)(process.execPath, [runner], { cwd: root, timeout: 15000, maxBuffer: 64 * 1024 });
    expect(JSON.parse(result.stdout.trim())).toEqual({ passed: true, accepted: 2, dataCommands: 2, rejectedBeforeData: true, restartNoResend: true });
  } finally { await fs.rm(root, { recursive: true, force: true }); }
}, 20000);
