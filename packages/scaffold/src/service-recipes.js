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
export function jobsRecipeFiles() {
  return {
    'src/jobs/index.ts': `import { input } from '@cossackframework/core/input';
import { defineJob, createJobRuntime, createCloudflareJobAdapter } from '@cossackframework/core/jobs';
import { createD1JobStore } from '@cossackframework/framework/jobs';
export function createJobs(env: CloudflareBindings) {
  return createJobRuntime({ namespace: env.JOB_NAMESPACE, adapter: createCloudflareJobAdapter(env.JOBS), store: createD1JobStore(env.JOB_STATE),
    jobs: { record: defineJob({ schema: input.object({ value: input.string({ required: true, maxLength: 1000 }) }), maxAttempts: 3,
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
