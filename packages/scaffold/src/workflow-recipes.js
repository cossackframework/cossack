/** Cloudflare owns durable steps; generated modules live outside the route tree. */
export function workflowsRecipeFiles() {
  return {
    'src/workflows.json': JSON.stringify([{ name: 'approval', version: 1, binding: 'WORKFLOWS', className: 'ApprovalWorkflow' }], null, 2) + '\n',
    'src/workflows/approval.ts': `import { defineWorkflow } from '@cossackframework/core/workflows';
import { input as schema } from '@cossackframework/core/input';

export const approvalWorkflow = defineWorkflow({
  name: 'approval', version: 1,
  schema: schema.object({ reference: schema.string() }),
  events: { approved: schema.object({ approved: schema.boolean() }) },
  async run(input, { step, identity }) {
    const reference = await step.do('prepare', () => input.reference);
    const approval = await step.waitForEvent('approval', 'approved', { timeout: 86400000 });
    return step.do('complete', () => ({ reference, approved: approval.approved, id: identity.id }));
  },
});
`,
    'src/workflows/entry.ts': `import { createCloudflareWorkflow } from '@cossackframework/framework/workflows';
import { approvalWorkflow } from './approval';
export class ApprovalWorkflow extends createCloudflareWorkflow(approvalWorkflow) {}
`,
    'src/workflows/index.ts': `import { createWorkflowClient } from '@cossackframework/core/workflows';
import { createCloudflareWorkflowProvider, type CloudflareWorkflowBinding } from '@cossackframework/framework/workflows/provider';
import { approvalWorkflow } from './approval';

/** Only call from an authorized server handler. Derive scope from trusted identity.
 * Scope separates IDs; it does not authorize access. Enforce ownership for events,
 * inspection and administrative operations as well as invocation.
 */
export function createApproval(env: { WORKFLOWS: CloudflareWorkflowBinding }) {
  return createWorkflowClient(approvalWorkflow, createCloudflareWorkflowProvider(env.WORKFLOWS), { namespace: 'approval-v1' });
}
`,
  };
}
