import { Cossack, Page, State, flash, flashed, type HeadValue } from '@cossackframework/core';
import { Card, CardBody } from '@cossackframework/ui';
import { html, component } from '@cossackframework/renderer';
import { isSameOriginPost, PERMISSIONS } from '@cossackframework/cms';
import { requireAny } from '../../../../../cms/guards';
import { notice, pageHeader } from '../../../../../cms/ui';

interface StepView { id: string; description: string; rql: string[] }

/** The schema plan: additive DDL and explicit steps, applied one atomic batch at a time. */
@Page({ transport: 'http', middlewares: [requireAny(PERMISSIONS.manageSchema)] })
export default class SchemaPage extends Cossack {
    @State() steps: StepView[] = [];
    @State() blocked: string[] = [];
    @State() warnings: string[] = [];
    @State() engine = '';
    @State() message = '';

    head(): HeadValue {
        return { title: 'Schema' };
    }

    async init() {
        const plan = await this.c.get('cms').plan();
        this.engine = plan.engineVersion;
        this.steps = plan.steps.map(step => ({ id: step.id, description: step.description, rql: step.statements.map(statement => statement.rql) }));
        this.blocked = plan.blocked.map(problem => `${problem.resource}: ${problem.message}`);
        this.warnings = plan.warnings.map(problem => `${problem.resource}: ${problem.message}`);
        this.message = flashed<string>('cms.message') ?? '';
    }

    async post() {
        if (!isSameOriginPost(this.c.req.raw)) return this.c.text('Forbidden', 403);
        const report = await this.c.get('cms').migrate();
        flash('cms.message', report.failed
            ? `Step "${report.failed.step.description}" failed and was rolled back: ${report.failed.message}`
            : `Applied ${report.applied.length} step(s).`);
        return this.redirect('/dashboard/tools/schema');
    }

    render() {
        return html`<div class="max-w-4xl space-y-6">
            ${pageHeader(__('Schema'), { description: `RomeDB engine ${this.engine}. ${__('Collections apply their own changes when saved; code-declared resources and plugins migrate here.')}` })}
            ${this.message ? notice(this.message) : null}
            ${this.blocked.map(problem => notice(problem, 'error'))}
            ${this.warnings.map(problem => notice(problem))}
            ${this.steps.length ? html`<ol class="space-y-3">${this.steps.map(step => html`<li>${component(Card, {}, component(CardBody, { class: 'space-y-2' }, html`
                    <p class="text-sm font-medium text-foreground">${step.description}</p>
                    <pre class="overflow-x-auto rounded-md bg-muted p-3 text-xs">${step.rql.join(';\n')}</pre>`))}</li>`)}</ol>
                <form method="post"><button type="submit" class="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground border-none cursor-pointer">${__('Apply the plan')}</button></form>`
                : notice(__('The database matches every declaration.'))}
        </div>`;
    }
}
