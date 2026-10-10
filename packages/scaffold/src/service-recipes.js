export function turnstileRecipeFiles() {
  return {
    'src/turnstile-input.ts': `import { input } from '@cossackframework/core';
export const contactInput = input.object({ message: input.string({ required: true, maxLength: 1000 }), token: input.string({ maxLength: 2048 }) });
`,
    'src/config/turnstile.ts': `import type { EnvFunction } from '@cossackframework/framework/config';
export const requirements = { variables: {
  TURNSTILE_SITE_KEY: { type: 'string', required: true },
  TURNSTILE_SECRET_KEY: { type: 'string', required: true, secret: true },
  TURNSTILE_HOSTNAME: { type: 'string', required: true },
} } as const;
export default ({ env }: { env: EnvFunction }) => ({ siteKey: env('TURNSTILE_SITE_KEY'), secret: env('TURNSTILE_SECRET_KEY'), hostname: env('TURNSTILE_HOSTNAME') });
`,
    'src/pages/contact/index.ts': `import { Cossack, Page, Client, ClientState, State, Server, ActionValidationError, createFormController, createFormBindings } from '@cossackframework/core';
import { html, component } from '@cossackframework/renderer';
import { Turnstile } from '@cossackframework/ui';
import { createTurnstileVerifier } from '@cossackframework/auth/turnstile';
import { config } from '@cossackframework/framework/config';
import { contactInput } from '../../turnstile-input';
@Page({ transport: 'http' })
export default class ContactPage extends Cossack {
  form = createFormController(contactInput, { message: '', token: '' });
  bindings = createFormBindings(this.form, { id: 'contact-form' });
  unsubscribe?: () => void;
  @State() siteKey = '';
  @Server() async init() { this.siteKey = config<string>('turnstile.siteKey'); }
  @ClientState() resetKey = 0;
  @ClientState() outcome = '';
  @Client() onMount() { this.unsubscribe = this.form.subscribe(() => { void this.requestUpdate(); }); }
  onCleanup() { this.unsubscribe?.(); this.bindings.dispose(); }
  @Server({ input: contactInput }) async send(data: { message: string; token: string }) {
    const verifier = createTurnstileVerifier({ secret: config<string>('turnstile.secret'), expectedHostname: config<string>('turnstile.hostname'), expectedAction: 'contact' });
    const result = await verifier.verify({ token: data.token });
    if (!result.success) throw new ActionValidationError({ token: 'Complete a fresh verification before sending.' });
    // Send/store the message here, after authoritative server verification.
    return { accepted: true };
  }
  @Client() result(value: { status: string }) { this.outcome = value.status; this.resetKey++; }
  render() {
    const message = this.bindings.field('message');
    return html\`<main><h1>Contact</h1><form ...=\${this.bindings.form(data => this.send(data), { onResult: result => this.result(result) })}>
      <label ...=\${message.label}>Message</label><textarea ...=\${message.input}></textarea><span ...=\${message.error}>\${message.errorMessage ?? ''}</span>
      \${component(Turnstile, { id: 'contact-verification', siteKey: this.siteKey, action: 'contact', resetKey: this.resetKey,
        onTokenChange: token => this.form.setFieldValue('token', token) })}
      <p id="verification-error" role="alert">\${this.form.fieldError('token') ?? ''}</p>
      <button type="submit">Send</button><output>\${this.outcome}</output>
    </form></main>\`;
  }
}
`,
  };
}
export function jobsRecipeFiles(options = {}) {
  return {
    'src/jobs/index.ts': `${options.notifications ? "import { createNotifications } from '../notifications';\n" : ''}import { input } from '@cossackframework/core/input';
import { defineJob, createJobRuntime, createCloudflareJobAdapter } from '@cossackframework/core/jobs';
import { createD1JobStore } from '@cossackframework/framework/jobs';
export function createJobs(env: CloudflareBindings) {
  return createJobRuntime({ namespace: env.JOB_NAMESPACE, adapter: createCloudflareJobAdapter(env.JOBS), store: createD1JobStore(env.JOB_STATE),
    jobs: { ${options.notifications ? `deliverNotification: defineJob({ schema: input.object({ id: input.string({ required: true, maxLength: 512 }) }), maxAttempts: 5,
      async handle(payload) { await createNotifications(env).deliver(payload.id); } }),` : ''} record: defineJob({ schema: input.object({ value: input.string({ required: true, maxLength: 1000 }) }), maxAttempts: 3,
      async handle(payload, context) {
        // One receipt per logical key, even if a handler crashes before queue acknowledgement.
        await env.JOB_STATE.prepare('INSERT OR IGNORE INTO cossack_job_receipts (key,tenant,actor,value) VALUES (?,?,?,?)')
          .bind(context.key, context.scope.tenantId ?? '', context.scope.actorId ?? '', payload.value).run();
      } }) },
  });
}
`,
    'src/jobs/migrations/0001_job_state.sql': `CREATE TABLE cossack_jobs (
 key TEXT PRIMARY KEY, job TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('running','retrying','completed','failed')),
 attempt INTEGER NOT NULL, updated_at INTEGER NOT NULL, lease_until INTEGER NOT NULL, token TEXT NOT NULL, code TEXT, action TEXT
);
CREATE INDEX cossack_jobs_status ON cossack_jobs(status,updated_at);
CREATE TABLE cossack_job_receipts (key TEXT PRIMARY KEY,tenant TEXT NOT NULL,actor TEXT NOT NULL,value TEXT NOT NULL);
`,
    'src/config/jobs.ts': `export const requirements = { variables: { JOB_NAMESPACE: { type: 'string', required: true } }, bindings: { JOBS: { kind: 'object', required: true, runtimes: ['cloudflare'] }, JOB_STATE: { kind: 'd1', required: true, runtimes: ['cloudflare'] } } } as const;
export default () => ({ provider: 'cloudflare-queues' });
`,
  };
}

export function schedulesRecipeFiles() {
  return {
    'src/schedules.json': JSON.stringify([{ name: 'hourly-record', cron: '0 * * * *', job: 'record', payload: { value: 'scheduled-record' }, scope: { tenantId: 'system', actorId: 'scheduler' } }], null, 2) + '\n',
    'src/schedules/index.ts': `import { createScheduleRuntime, validateScheduleDefinitions } from '@cossackframework/core/schedules';
import definitions from '../schedules.json';
import { createJobs } from '../jobs';
export function createSchedules(env: CloudflareBindings) {
  return createScheduleRuntime({ schedules: validateScheduleDefinitions(definitions), dispatcher: createJobs(env) });
}
`,
  };
}

export function notificationsRecipeFiles() {
  return {
    'src/jobs/migrations/0002_notifications.sql': "CREATE TABLE IF NOT EXISTS cossack_notifications (\n id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE, tenant_id TEXT NOT NULL, user_id TEXT NOT NULL,\n channel TEXT NOT NULL CHECK(channel IN ('email','in-app')), record_json TEXT NOT NULL,\n status TEXT NOT NULL CHECK(status IN ('queued','provider-accepted','failed','unknown','delivered')),\n created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, attempt INTEGER NOT NULL DEFAULT 0,\n is_read INTEGER NOT NULL DEFAULT 0 CHECK(is_read IN (0,1)), code TEXT, message_id TEXT,\n token TEXT, lease_until INTEGER NOT NULL DEFAULT 0, sending TEXT CHECK(sending IN ('none','provider'))\n);\nCREATE INDEX IF NOT EXISTS cossack_notifications_inbox ON cossack_notifications(tenant_id,user_id,channel,status,created_at,id);\nCREATE TABLE cossack_notification_preferences (tenant_id TEXT NOT NULL,user_id TEXT NOT NULL,template TEXT NOT NULL,channel TEXT NOT NULL CHECK(channel IN ('email','in-app')),enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),PRIMARY KEY(tenant_id,user_id,template,channel));\n",
    'src/notifications/index.ts': `import { input } from '@cossackframework/core/input';
import { createNotificationRuntime, defineNotificationTemplate, notificationHtml } from '@cossackframework/core/notifications';
import { createD1NotificationStore, createCloudflareNotificationEmailProvider } from '@cossackframework/framework/notifications';
import { createJobs } from '../jobs';
export function createNotifications(env: CloudflareBindings) {
  return createNotificationRuntime({ namespace: env.JOB_NAMESPACE,
    templates: { notice: defineNotificationTemplate({ schema: input.object({ title: input.string({ required: true, maxLength: 200 }), body: input.string({ required: true, maxLength: 2000 }) }),
      render(data) { return { subject: data.title, text: data.body, html: notificationHtml\`<h1>\${data.title}</h1><p>\${data.body}</p>\` }; } }) },
    store: createD1NotificationStore(env.JOB_STATE),
    email: { provider: createCloudflareNotificationEmailProvider(env.EMAIL), from: env.MAIL_FROM },
    // Preferences are application-owned. This example requires explicit opt-in.
    async preferences({ recipient, template, channel }) {
      const row = await env.JOB_STATE.prepare('SELECT enabled FROM cossack_notification_preferences WHERE tenant_id=? AND user_id=? AND template=? AND channel=?')
        .bind(recipient.tenantId, recipient.userId, template, channel).first<{ enabled: number }>();
      return row?.enabled === 1;
    },
    async dispatch(id, recipient) { await createJobs(env).dispatch('deliverNotification', { id }, {
      scope: { tenantId: recipient.tenantId, actorId: recipient.userId }, idempotencyKey: id,
    }); },
  });
}
`,
    'src/config/notifications.ts': `export const requirements = { variables: { MAIL_FROM: { type: 'string', required: true } }, bindings: {
  EMAIL: { kind: 'object', required: true, runtimes: ['cloudflare'] }, JOB_STATE: { kind: 'd1', required: true, runtimes: ['cloudflare'] },
} } as const;
export default () => ({ channels: ['email', 'in-app'] });
`,
  };
}
