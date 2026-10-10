import fs from 'node:fs/promises';
import path from 'node:path';

/** Writes test-only server modules into an already generated minimal Cloudflare app.
 * The runner owns DB/WORKFLOWS resource configuration and the ACCEPTANCE_KEY secret.
 * No credentials, resource IDs, configuration, client modules, or deployments are written here.
 */
export async function writeHostedWorkflowAcceptance(root) {
  const write = async (name, source) => {
    const file = path.join(root, name);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, source);
  };
  await write('src/workflows/approval.ts', `
import { defineWorkflow, type WorkflowContext } from '@cossackframework/core/workflows';
import { input as schema } from '@cossackframework/core/input';
const events = { approved: schema.object({ approved: schema.boolean() }) };
type WorkflowEnv = { DB: D1Database };
export const approvalWorkflow = defineWorkflow({
  name: 'approval', version: 1,
  schema: schema.object({ reference: schema.string(), mode: schema.enum(['approval', 'failure']) }),
  events,
  async run(input, { step, env, identity }: WorkflowContext<typeof events, WorkflowEnv>) {
    const effect = async (kind: string) => (await env.DB.prepare(
      'INSERT INTO effects(id,kind,n) VALUES (?,?,1) ON CONFLICT(id,kind) DO UPDATE SET n=n+1 RETURNING n'
    ).bind(identity.id, kind).first<{ n: number }>())!.n;
    await step.do('first', async () => effect('first'));
    if (input.mode === 'failure') {
      await step.do('permanent-failure', async () => {
        await effect('failure');
        throw new Error('PRIVATE_HOSTED_WORKFLOW_FAILURE');
      }, { retries: { limit: 0, delay: 1 } });
      return null;
    }
    await step.do('retried-step', async () => {
      const attempts = await effect('attempt');
      if (attempts === 1) throw new Error('PRIVATE_HOSTED_WORKFLOW_RETRY');
      return attempts;
    }, { retries: { limit: 1, delay: 10, backoff: 'constant' } });
    const decision = await step.waitForEvent('approval', 'approved', { timeout: 300000 });
    await step.do('last', async () => {
      await effect('last');
      await effect(decision.approved ? 'approved' : 'rejected');
      return decision.approved;
    });
    return { approved: decision.approved, reference: input.reference };
  },
});
`);
  await write('src/pages/api/workflow.ts', `
import { createApproval } from '../../workflows/index';
export const POST = async (c: any) => {
  if (typeof c.env.ACCEPTANCE_KEY !== 'string' || !c.env.ACCEPTANCE_KEY ||
      c.req.header('X-Cossack-Acceptance-Key') !== c.env.ACCEPTANCE_KEY) {
    return c.json({ code: 'ACCEPTANCE_UNAUTHORIZED' }, 401);
  }
  const scope = { tenantId: 'trusted-hosted-fixture', actorId: 'acceptance-runner' };
  const client = createApproval(c.env);
  try {
    const body = await c.req.json();
    if (body.op === 'invoke') {
      await c.env.DB.exec('CREATE TABLE IF NOT EXISTS effects(id TEXT,kind TEXT,n INTEGER,PRIMARY KEY(id,kind))');
      return c.json(await client.invoke({ reference: 'hosted-fixture', mode: body.mode ?? 'approval' }, { key: body.key, scope }));
    }
    const identity = body.identity;
    if (!identity || identity.name !== 'approval' || identity.version !== 1 ||
        identity.scope?.tenantId !== scope.tenantId || identity.scope?.actorId !== scope.actorId) {
      return c.json({ code: 'ACCEPTANCE_IDENTITY_INVALID' }, 400);
    }
    if (body.op === 'inspect') return c.json(await client.inspect(identity));
    if (body.op === 'nativeStatus') return c.json({ status: (await (await c.env.WORKFLOWS.get(identity.id)).status()).status });
    if (body.op === 'event') await client.sendEvent(identity, 'approved', body.payload);
    else if (body.op === 'pause') await client.pause(identity);
    else if (body.op === 'resume') await client.resume(identity);
    else if (body.op === 'terminate') await client.terminate(identity);
    else if (body.op === 'audit') return c.json((await c.env.DB.prepare('SELECT kind,n FROM effects WHERE id=? ORDER BY kind').bind(identity.id).all()).results);
    else return c.json({ code: 'WORKFLOW_FIXTURE_OPERATION_INVALID' }, 400);
    return c.json({ ok: true });
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    return c.json({ code: typeof code === 'string' && /^WORKFLOW_[A-Z_]+$/.test(code) ? code : 'WORKFLOW_FIXTURE_FAILED' }, 400);
  }
};
`);
  // Throw into the framework's standard request error boundary. No custom logging or catch.
  await write('src/pages/api/acceptance-exception.ts', `
export const POST = async (c: any) => {
  if (typeof c.env.ACCEPTANCE_KEY !== 'string' || !c.env.ACCEPTANCE_KEY ||
      c.req.header('X-Cossack-Acceptance-Key') !== c.env.ACCEPTANCE_KEY) {
    return c.json({ code: 'ACCEPTANCE_UNAUTHORIZED' }, 401);
  }
  throw new Error('PRIVATE_HOSTED_API_EXCEPTION');
};
`);
}
